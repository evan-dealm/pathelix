import { NextRequest, NextResponse } from 'next/server'
import bcrypt                        from 'bcryptjs'
import { UserUpdateSchema }          from '@/lib/schemas'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { hasPermission }             from '@/lib/permissions'
import { auditAsync }                from '@/lib/audit'
import { getTenantDb, type TenantDb } from '@/lib/tenantDb'
import { revokeUserSessions }        from '@/lib/sessionRevocation'

const log = createLogger('/api/users/[id]')
type Params = { params: Promise<{ id: string }> }

const selectWithoutPassword = {
  id: true, tenantId: true, email: true, role: true,
  firstName: true, lastName: true, driverRef: true,
  createdAt: true, updatedAt: true,
}

/**
 * Only an admin may manage admins: a dispatcher granted `manage_users` can manage drivers and
 * dispatchers, but can never create, edit or delete an ADMIN, nor promote anyone to ADMIN —
 * otherwise the permission is a direct path to taking over the tenant.
 */
function canManageTarget(callerRole: string, targetRole: string, newRole?: string): boolean {
  if (callerRole === 'admin' || callerRole === 'superadmin') return true
  return targetRole !== 'ADMIN' && newRole !== 'ADMIN'
}

async function isLastAdmin(db: TenantDb, userId: string): Promise<boolean> {
  const admins = await db.user.count({ where: { role: 'ADMIN' } })
  const target = await db.user.findFirst({ where: { id: userId }, select: { role: true } })
  return target?.role === 'ADMIN' && admins <= 1
}

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const tenantId = getTenantId(req)

  try {
    const user = await getTenantDb(tenantId).user.findFirst({
      where: { id },
      select: selectWithoutPassword,
    })
    if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

    metrics.increment(METRIC.API_REQUESTS, { route: '/api/users/[id]', method: 'GET', status: '200' })
    return NextResponse.json(user)
  } catch (err) {
    log.error('GET failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/users/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const { tenantId, userId, role } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_users'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = UserUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const db = getTenantDb(tenantId)
    const existing = await db.user.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

    const { password, ...rest } = parsed.data
    if (!canManageTarget(role, existing.role, rest.role)) {
      return NextResponse.json({ error: 'Seul un administrateur peut gérer les comptes administrateur' }, { status: 403 })
    }
    if (rest.role && rest.role !== 'ADMIN' && await isLastAdmin(db, id)) {
      return NextResponse.json({ error: 'Impossible de retirer le dernier administrateur du compte' }, { status: 409 })
    }
    if (rest.driverRef && !(await db.driver.findFirst({ where: { id: rest.driverRef }, select: { id: true } }))) {
      return NextResponse.json({ error: 'Chauffeur lié introuvable' }, { status: 422 })
    }
    const data: Record<string, unknown> = { ...rest }
    if (rest.email) data.email = rest.email.trim().toLowerCase()
    if (password) {
      data.passwordHash = await bcrypt.hash(password, 12)
    }

    const user = await db.user.update({
      where: { id },
      data,
      select: selectWithoutPassword,
    })

    // A new role or password must take effect now, not when the user's current token expires.
    if (password || (rest.role && rest.role !== existing.role)) await revokeUserSessions(id)

    auditAsync(req, 'user.update', 'User', id, {
      ...(rest.role && rest.role !== existing.role ? { roleBefore: existing.role, roleAfter: rest.role } : {}),
      fieldsChanged: Object.keys(rest),
      passwordChanged: Boolean(password),
    })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/users/[id]', method: 'PUT', status: '200' })
    return NextResponse.json(user)
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Un utilisateur avec cet email existe déjà' }, { status: 409 })
    }
    log.error('PUT failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/users/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const { tenantId, userId, role } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_users'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  try {
    const db = getTenantDb(tenantId)
    const existing = await db.user.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    if (id === userId) {
      return NextResponse.json({ error: 'Vous ne pouvez pas supprimer votre propre compte' }, { status: 409 })
    }
    if (!canManageTarget(role, existing.role)) {
      return NextResponse.json({ error: 'Seul un administrateur peut gérer les comptes administrateur' }, { status: 403 })
    }
    if (await isLastAdmin(db, id)) {
      return NextResponse.json({ error: 'Impossible de supprimer le dernier administrateur du compte' }, { status: 409 })
    }

    await revokeUserSessions(id)
    await db.user.delete({ where: { id } })
    log.warn('User deleted', { deletedUserId: id, deletedEmail: existing.email, deletedBy: userId, tenantId })
    auditAsync(req, 'user.delete', 'User', id, { email: existing.email, role: existing.role })

    metrics.increment(METRIC.API_REQUESTS, { route: '/api/users/[id]', method: 'DELETE', status: '200' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/users/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
