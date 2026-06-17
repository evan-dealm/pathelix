import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { logSuperadminAction } from '@/lib/superadminAudit'

const log = createLogger('/api/superadmin/users/[id]')

type Params = { params: Promise<{ id: string }> }

const UpdateUserSchema = z.object({
  role:      z.enum(['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'DRIVER']).optional(),
  firstName: z.string().max(100).optional(),
  lastName:  z.string().max(100).optional(),
  email:     z.string().email().optional(),
  driverRef: z.string().nullable().optional(),
  password:  z.string().min(8).max(1000).optional(),
})

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  const { id } = await params
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, tenantId: true, email: true, role: true,
        firstName: true, lastName: true, driverRef: true,
        createdAt: true, updatedAt: true,
        tenant: { select: { id: true, name: true, slug: true, plan: true } },
      },
    })
    if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    return NextResponse.json(user)
  } catch (err) {
    log.error('GET failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  const { userId: superadminId, role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = UpdateUserSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    const data: Record<string, unknown> = {}
    if (parsed.data.role)      data.role = parsed.data.role
    if (parsed.data.firstName !== undefined) data.firstName = parsed.data.firstName
    if (parsed.data.lastName !== undefined)  data.lastName = parsed.data.lastName
    if (parsed.data.email)     data.email = parsed.data.email
    if (parsed.data.driverRef !== undefined) data.driverRef = parsed.data.driverRef

    if (parsed.data.password) {
      const { hash } = await import('bcryptjs')
      data.passwordHash = await hash(parsed.data.password, 12)
    }

    const user = await prisma.user.update({ where: { id }, data })

    logSuperadminAction({
      superadminId,
      targetTenantId: user.tenantId,
      isImpersonation: false,
      method: 'PUT',
      path: `/api/superadmin/users/${id}`,
      action: 'user_updated',
      details: { changedFields: Object.keys(data).filter(k => k !== 'passwordHash'), userId: id },
    })

    return NextResponse.json({ ok: true, id: user.id, role: user.role, email: user.email })
  } catch (err) {
    if (err instanceof Error && err.message.includes('Record to update not found')) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    }
    log.error('PUT failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  const { userId: superadminId, role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  try {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, tenantId: true, role: true } })
    if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

    if (user.id === superadminId) {
      return NextResponse.json({ error: 'Impossible de supprimer votre propre compte' }, { status: 400 })
    }

    await prisma.user.delete({ where: { id } })

    logSuperadminAction({
      superadminId,
      targetTenantId: user.tenantId,
      isImpersonation: false,
      method: 'DELETE',
      path: `/api/superadmin/users/${id}`,
      action: 'user_deleted',
      details: { email: user.email, role: user.role },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
