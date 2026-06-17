import prisma from '@/lib/db'

export interface FeatureFlags {
  gantt:         boolean
  recurring:     boolean
  incidents:     boolean
  webPush:       boolean
  pdf:           boolean
  apiDocs:       boolean
  weather:       boolean
  delayScoring:  boolean
  anomalyDetect: boolean
  tracking:      boolean
  customForms:   boolean
  benchmarking:  boolean
}

const PLAN_DEFAULTS: Record<string, FeatureFlags> = {
  FREE: {
    gantt: false, recurring: false, incidents: false, webPush: false, pdf: false,
    apiDocs: false, weather: false, delayScoring: false, anomalyDetect: false,
    tracking: true, customForms: false, benchmarking: false,
  },
  PRO: {
    gantt: true, recurring: true, incidents: true, webPush: true, pdf: true,
    apiDocs: true, weather: true, delayScoring: false, anomalyDetect: false,
    tracking: true, customForms: true, benchmarking: false,
  },
  ENTERPRISE: {
    gantt: true, recurring: true, incidents: true, webPush: true, pdf: true,
    apiDocs: true, weather: true, delayScoring: true, anomalyDetect: true,
    tracking: true, customForms: true, benchmarking: true,
  },
}

const _cache = new Map<string, { flags: FeatureFlags; expiresAt: number }>()
const TTL_MS = 60_000

export async function getFeatureFlags(tenantId: string): Promise<FeatureFlags> {
  const cached = _cache.get(tenantId)
  if (cached && Date.now() < cached.expiresAt) return cached.flags

  try {
    const [settings, tenant] = await Promise.all([
      prisma.tenantSettings.findUnique({ where: { tenantId }, select: { features: true } }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } }),
    ])

    const planDefaults = PLAN_DEFAULTS[tenant?.plan ?? 'FREE'] ?? PLAN_DEFAULTS.FREE
    const overrides    = (settings?.features ?? {}) as Partial<FeatureFlags>

    const flags: FeatureFlags = { ...planDefaults, ...overrides }
    _cache.set(tenantId, { flags, expiresAt: Date.now() + TTL_MS })
    return flags
  } catch {
    return PLAN_DEFAULTS.FREE
  }
}

export function invalidateFlagsCache(tenantId: string): void {
  _cache.delete(tenantId)
}

export async function hasFeature(tenantId: string, flag: keyof FeatureFlags): Promise<boolean> {
  const flags = await getFeatureFlags(tenantId)
  return flags[flag]
}
