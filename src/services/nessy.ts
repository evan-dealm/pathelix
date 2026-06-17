import type { Mission }          from '@/lib/types'
import { fetchProtected }        from '@/lib/httpClient'
import { getCircuitBreaker }     from '@/lib/circuitBreaker'
import { createLogger }          from '@/lib/logger'
import { metrics, METRIC }       from '@/lib/metrics'

const log = createLogger('services/nessy')

const NESSY_BASE_URL    = process.env.NESSY_BASE_URL ?? ''
const NESSY_API_KEY     = process.env.NESSY_API_KEY  ?? ''
const NESSY_BREAKER     = 'nessy'

const DEFAULT_NESSY_SECRET = 'dev-secret-change-me-in-production'

export const NESSY_WEBHOOK_SECRET =
  process.env.NESSY_WEBHOOK_SECRET ?? DEFAULT_NESSY_SECRET

export const IS_DEV_SECRET =
  NESSY_WEBHOOK_SECRET === DEFAULT_NESSY_SECRET

if (process.env.NODE_ENV === 'production' && IS_DEV_SECRET) {
  log.error(
    'NESSY_WEBHOOK_SECRET est le secret par défaut en production ! ' +
    'Le webhook Nessy sera désactivé (HTTP 503). ' +
    'Définissez NESSY_WEBHOOK_SECRET dans vos variables d\'environnement.',
  )
}

export interface NessyMissionPayload {
  id?:                  string
  type:                 string
  date:                 string
  clientName?:          string
  outletName?:          string
  address:              string
  latitude:             number
  longitude:            number
  estimatedDurationMin: number
  maneuverTimeMin?:     number
  wasteTypeLabel?:      string
  binSize?:             string
  binSizeM3?:           number
  accessNotes?:         string
  priority?:            number
  timeWindowOpenMin?:   number
  timeWindowCloseMin?:  number
  linkedExutoireId?:    string
}

export interface NessyWebhookBody {
  missions: NessyMissionPayload[]
  source?:  string
  sentAt?:  string
}

export function nessyPayloadToMission(p: NessyMissionPayload): Omit<Mission, 'id'> {
  const validTypes = ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR'] as const
  type MType = (typeof validTypes)[number]
  const type: MType = validTypes.includes(p.type as MType) ? (p.type as MType) : 'POSER'

  const priority = (p.priority === 1 || p.priority === 2 || p.priority === 3)
    ? p.priority
    : undefined

  const latitude  = Number(p.latitude)
  const longitude = Number(p.longitude)
  if (!Number.isFinite(latitude)  || Math.abs(latitude)  > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new Error(`Coordonnées GPS invalides: lat=${p.latitude}, lng=${p.longitude}`)
  }

  return {
    type,
    date:                 p.date,
    clientName:           p.clientName,
    outletName:           p.outletName,
    address:              p.address,
    latitude,
    longitude,
    estimatedDurationMin: p.estimatedDurationMin,
    maneuverTimeMin:      p.maneuverTimeMin ?? 0,
    wasteTypeLabel:       p.wasteTypeLabel,
    binSize:              p.binSize,
    binSizeM3:            p.binSizeM3,
    accessNotes:          p.accessNotes,
    priority,
    timeWindow: (p.timeWindowOpenMin !== null && p.timeWindowOpenMin !== undefined && p.timeWindowCloseMin !== null && p.timeWindowCloseMin !== undefined)
      ? { openMin: p.timeWindowOpenMin, closeMin: p.timeWindowCloseMin }
      : undefined,
    linkedExutoireId: p.linkedExutoireId,
  }
}

export async function verifyNessySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const expectedPrefix = 'sha256='
  if (!signatureHeader.startsWith(expectedPrefix)) return false

  const receivedHex = signatureHeader.slice(expectedPrefix.length)

  try {
    const enc       = new TextEncoder()
    const keyData   = enc.encode(secret)
    const msgData   = enc.encode(rawBody)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sigBuffer  = await crypto.subtle.sign('HMAC', cryptoKey, msgData)
    const sigArray   = Array.from(new Uint8Array(sigBuffer))
    const computedHex = sigArray.map(b => b.toString(16).padStart(2, '0')).join('')

    return timingSafeEqual(computedHex, receivedHex)
  } catch {
    return false
  }
}

function timingSafeEqual(a: string, b: string): boolean {

  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

const CB_SUCCESS_COUNT = 'nessy.import.success'

export async function importMissionsFromNessy(date: string): Promise<Mission[]> {
  if (!NESSY_BASE_URL || !NESSY_API_KEY) {
    log.debug('Nessy non configuré — skip import')
    return []
  }

  const cb = getCircuitBreaker(NESSY_BREAKER, {
    failureThreshold: 3,
    recoveryTimeMs:   30_000,
  })

  try {
    const res = await fetchProtected(
      `${NESSY_BASE_URL}/api/missions?date=${date}`,
      { headers: { 'X-Api-Key': NESSY_API_KEY, 'Accept': 'application/json' } },
      { maxRetries: 2, timeoutMs: 6_000 },
      NESSY_BREAKER,
    )

    if (!res.ok) {
      log.warn('Nessy import HTTP error', { status: res.status, date })
      return []
    }

    const data = await res.json() as { missions?: NessyMissionPayload[] }
    const missions = (data.missions ?? []).map(p => ({
      ...nessyPayloadToMission(p),
      id: p.id ?? `nessy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    })) as Mission[]

    log.info('Nessy import success', { date, count: missions.length })
    metrics.increment(CB_SUCCESS_COUNT, { service: 'nessy' })
    return missions
  } catch (err) {
    const isOpen = cb.getState() === 'OPEN'
    log.warn('Nessy import failed', {
      err: err instanceof Error ? err.message : String(err),
      circuitOpen: isOpen,
    })
    metrics.increment(METRIC.CB_FAILURE, { name: NESSY_BREAKER })
    return []
  }
}

export async function exportStatusesToNessy(
  statuses: Record<string, string>,
): Promise<void> {
  if (!NESSY_BASE_URL || !NESSY_API_KEY) {
    if (process.env.NODE_ENV !== 'production') {
      log.debug('exportStatusesToNessy (stub)', { statuses })
    }
    return
  }

  try {
    const res = await fetchProtected(
      `${NESSY_BASE_URL}/api/statuses`,
      {
        method:  'POST',
        headers: { 'X-Api-Key': NESSY_API_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ statuses }),
      },
      { maxRetries: 1, timeoutMs: 4_000 },
      NESSY_BREAKER,
    )

    if (!res.ok) {
      log.warn('Nessy export HTTP error', { status: res.status })
    }
  } catch (err) {
    log.warn('Nessy export failed', { err: err instanceof Error ? err.message : String(err) })
  }
}
