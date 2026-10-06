import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { getTenantDb } from '@/lib/tenantDb'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { hasPermission } from '@/lib/permissions'
import { API_SCOPES, hashApiKey, invalidateApiKeyCache } from '@/lib/apiKeyAuth'

const log = createLogger('/api/api-keys')

const ScopeEnum = z.enum(API_SCOPES)

const CreateKeySchema = z.object({
  name:   z.string().min(1).max(100),
  scopes: z.array(ScopeEnum).min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  if (role === 'driver' || !(await hasPermission(userId, role, 'api_access'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  const keys = await getTenantDb(tenantId).apiKey.findMany({
    where: { revoked: false },
    select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(keys)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  if (role === 'driver' || !(await hasPermission(userId, role, 'api_access'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = CreateKeySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const rawToken = `ef_live_${randomBytes(32).toString('hex')}`
  const prefix = rawToken.slice(0, 16)
  const keyHash = hashApiKey(rawToken)

  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86400000)
    : null

  const apiKeyDb = getTenantDb(tenantId)
  const key = await apiKeyDb.apiKey.create({
    data: {
      name: parsed.data.name,
      keyHash,
      prefix,
      scopes: parsed.data.scopes,
      expiresAt,
    } as Parameters<typeof apiKeyDb.apiKey.create>[0]['data'],
    select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, createdAt: true },
  })

  log.info('API key created', { tenantId, keyId: key.id, name: key.name, by: userId })

  return NextResponse.json({
    ...key,
    token: rawToken,
    message: 'Copiez ce token maintenant. Il ne sera plus jamais affiché.',
  }, { status: 201 })
}

/** Revokes a key (?id=…). Effective immediately on this instance, within 30 s on the others. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  if (role === 'driver' || !(await hasPermission(userId, role, 'api_access'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const { count } = await getTenantDb(tenantId).apiKey.updateMany({
    where: { id, revoked: false },
    data:  { revoked: true },
  })
  if (count === 0) return NextResponse.json({ error: 'Clé introuvable' }, { status: 404 })

  invalidateApiKeyCache()
  log.info('API key revoked', { tenantId, keyId: id, by: userId })
  return NextResponse.json({ ok: true })
}
