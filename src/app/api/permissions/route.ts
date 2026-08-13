import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { getRequestContext } from '@/lib/data/context'
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, invalidatePermCache } from '@/lib/permissions'
import { auditAsync } from '@/lib/audit'

const UpdatePermsSchema = z.object({
  userId:      z.string().min(1),
  permissions: z.array(z.enum(ALL_PERMISSIONS as unknown as [string, ...string[]])),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)
  const targetUserId = req.nextUrl.searchParams.get('userId')

  if (!targetUserId) {

    return NextResponse.json({ allPermissions: ALL_PERMISSIONS, defaults: DEFAULT_PERMISSIONS })
  }

  const [user, customPerms] = await Promise.all([
    prisma.user.findFirst({
      where: { id: targetUserId, tenantId },
      select: { id: true, role: true },
    }),
    prisma.userPermission.findMany({
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

  const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
  if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  await prisma.$transaction([
    prisma.userPermission.deleteMany({ where: { userId } }),
    ...permissions.map(p =>
      prisma.userPermission.create({ data: { tenantId, userId, permission: p } }),
    ),
  ])

  invalidatePermCache(userId)
  auditAsync(req, 'user.permissions_update', 'User', userId, { permissions })

  return NextResponse.json({ ok: true, userId, permissions })
}
