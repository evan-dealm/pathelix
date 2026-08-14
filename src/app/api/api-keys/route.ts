import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createHash, randomBytes } from 'crypto'
import prisma from '@/lib/db'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { hasPermission } from '@/lib/permissions'

const log = createLogger('/api/api-keys')

const VALID_API_SCOPES = [
  'missions:read', 'missions:write',
  'drivers:read',  'drivers:write',
  'vehicles:read', 'vehicles:write',
  'clients:read',  'clients:write',
  'sites:read',    'sites:write',
  'plans:read',    'plans:write',
  'optimize',
  'reports:read',
  'webhooks',
] as const

const ScopeEnum = z.enum(VALID_API_SCOPES)

const CreateKeySchema = z.object({
  name:   z.string().min(1).max(100),
  scopes: z.array(ScopeEnum).min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  }

  const keys = await prisma.apiKey.findMany({
    where: { tenantId, revoked: false },
    select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(keys)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'api_access'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = CreateKeySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const rawToken = `ef_live_${randomBytes(32).toString('hex')}`
  const prefix = rawToken.slice(0, 16)
  const keyHash = createHash('sha256').update(rawToken).digest('hex')

  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86400000)
    : null

  const key = await prisma.apiKey.create({
    data: {
      tenantId,
      name: parsed.data.name,
      keyHash,
      prefix,
      scopes: parsed.data.scopes,
      expiresAt,
    },
    select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, createdAt: true },
  })

  log.info('API key created', { tenantId, keyId: key.id, name: key.name, by: userId })

  return NextResponse.json({
    ...key,
    token: rawToken,
    message: 'Copiez ce token maintenant. Il ne sera plus jamais affiché.',
  }, { status: 201 })
}
