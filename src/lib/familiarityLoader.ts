import { TtlCache } from '@/lib/cache'
import { createLogger } from '@/lib/logger'
import type { FamiliarityMap } from '@/lib/vrp/types'

const log = createLogger('familiarityLoader')

const _cache = new TtlCache<string, FamiliarityMap>(10 * 60_000)

export async function loadFamiliarity(tenantId: string): Promise<FamiliarityMap> {
  return _cache.getOrSet(`fam:${tenantId}`, async () => {
    const prisma = (await import('@/lib/db')).default

    const since = new Date()
    since.setDate(since.getDate() - 30)
    const sinceStr = since.toISOString().slice(0, 10)

    const rows = await prisma.interventionMetric.groupBy({
      by: ['driverId', 'siteId'],
      where: {
        tenantId,
        isReliable: true,
        date: { gte: sinceStr },
        siteId: { not: null },
      },
      _count: true,
    })

    const map: FamiliarityMap = new Map()
    for (const row of rows) {
      if (row.siteId) {
        map.set(`${row.driverId}:${row.siteId}`, row._count)
      }
    }

    if (map.size > 0) {
      log.info('Familiarity loaded', { tenantId, pairs: map.size })
    }

    return map
  })
}

export function invalidateFamiliarityCache(tenantId: string): void {
  _cache.delete(`fam:${tenantId}`)
}

export function getFamiliarityBonus(
  familiarity: FamiliarityMap | undefined,
  driverId: string,
  siteId: string | undefined | null,
  stabilityWeight: number,
): number {
  if (!familiarity || !siteId || stabilityWeight <= 0) return 0

  const visits = familiarity.get(`${driverId}:${siteId}`) ?? 0
  if (visits < 5) return 0

  const rawBonus = Math.log2(visits) * 2.5
  const maxBonus = 15

  return -Math.min(maxBonus, rawBonus) * stabilityWeight
}
