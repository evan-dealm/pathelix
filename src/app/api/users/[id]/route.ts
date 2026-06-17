import { NextRequest, NextResponse } from 'next/server'
import bcrypt                        from 'bcryptjs'
import { UserUpdateSchema }          from '@/lib/schemas'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import prisma                        from '@/lib/db'

const log = createLogger('/api/users/[id]')
type Params = { params: Promise<{ id: string }> }

const selectWithoutPassword = {
  id: true, tenantId: true, email: true, role: true,
  firstName: true, lastName: true, driverRef: true,
  createdAt: true, updatedAt: true,
}

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const tenantId = getTenantId(req)

  try {
    const user = await prisma.user.findFirst({
      where: { id, tenantId },
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
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = UserUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const existing = await prisma.user.findFirst({ where: { id, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

    const { password, ...rest } = parsed.data
    const data: Record<string, unknown> = { ...rest }
    if (password) {
      data.passwordHash = await bcrypt.hash(password, 12)
    }

    const user = await prisma.user.update({
      where: { id, tenantId },
      data,
      select: selectWithoutPassword,
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
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }

  try {
    const existing = await prisma.user.findFirst({ where: { id, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

    await prisma.user.delete({ where: { id, tenantId } })
    log.warn('User deleted', { deletedUserId: id, deletedEmail: existing.email, deletedBy: getRequestContext(req).userId, tenantId })

    metrics.increment(METRIC.API_REQUESTS, { route: '/api/users/[id]', method: 'DELETE', status: '200' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/users/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
