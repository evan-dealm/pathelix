import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenantDb } from '@/lib/tenantDb'
import { getRequestContext } from '@/lib/data/context'
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, invalidatePermCache, hasPermission } from '@/lib/permissions'
import { auditAsync } from '@/lib/audit'

const UpdatePermsSchema = z.object({
  userId:      z.string().min(1),
  permissions: z.array(z.enum(ALL_PERMISSIONS as unknown as [string, ...string[]])),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId, role } = getRequestContext(req)
  const targetUserId = req.nextUrl.searchParams.get('userId')

  // Anyone may read their own permissions (UI gating); reading someone else's is user management.
  if (targetUserId && targetUserId !== userId && !(await hasPermission(userId, role, 'manage_users'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  if (!targetUserId) {

    return NextResponse.json({ allPermissions: ALL_PERMISSIONS, defaults: DEFAULT_PERMISSIONS })
  }

  const db = getTenantDb(tenantId)
  const [user, customPerms] = await Promise.all([
    db.user.findFirst({
      where: { id: targetUserId },
      select: { id: true, role: true },
    }),
    db.userPermission.findMany({
      where: { userId: targetUserId },
      select: { permission: true },
    }),
  ])
  if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const roleKey = user.role.toLowerCase()
  const permissions = customPerms.length > 0
    ? customPerms.map(p => p.permission)
    : DEFAULT_PERMISSIONS[roleKey] ?? []

  return NextResponse.json({ userId: targetUserId, role: user.role, permissions, isCustom: customPerms.length > 0 })
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  }

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = UpdatePermsSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { userId, permissions } = parsed.data

  const db = getTenantDb(tenantId)
  const user = await db.user.findFirst({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  await db.$transaction([
    db.userPermission.deleteMany({ where: { userId } }),
    ...permissions.map(p =>
      db.userPermission.create({ data: { userId, permission: p } as Parameters<typeof db.userPermission.create>[0]['data'] }),
    ),
  ])

  invalidatePermCache(userId)
  auditAsync(req, 'user.permissions_update', 'User', userId, { permissions })

  return NextResponse.json({ ok: true, userId, permissions })
}
