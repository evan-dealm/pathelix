import { NextRequest, NextResponse } from 'next/server'
import { getRedisClient } from '@/lib/redisClient'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { logSuperadminAction } from '@/lib/superadminAudit'

const log = createLogger('/api/superadmin/tenants/[id]/purge-cache')

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: tenantId } = await params
  const { userId: superadminId, role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  try {
    const redis = await getRedisClient()
    if (!redis) {
      return NextResponse.json({ ok: true, purged: 0, message: 'Redis non disponible' })
    }

    const patterns = [
      `cache:*:${tenantId}*`,
      `rl:tenant:*:${tenantId}*`,
      `driver-status:${tenantId}:*`,
    ]

    let totalPurged = 0

    for (const pattern of patterns) {
      let cursor = '0'
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500)
        cursor = nextCursor
        if (keys.length > 0) {
          await redis.del(...keys)
          totalPurged += keys.length
        }
      } while (cursor !== '0')
    }

    logSuperadminAction({
      superadminId,
      targetTenantId: tenantId,
      isImpersonation: false,
      method: 'POST',
      path: `/api/superadmin/tenants/${tenantId}/purge-cache`,
      action: 'cache_purged',
      details: { keysPurged: totalPurged },
    })

    log.info('Cache purged for tenant', { tenantId, keysPurged: totalPurged, by: superadminId })
    return NextResponse.json({ ok: true, purged: totalPurged })
  } catch (err) {
    log.error('Purge failed', { tenantId, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
