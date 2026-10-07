import { createLogger } from '@/lib/logger'
import { buildTrafficTar, writeTrafficTar, type EdgeSpeed } from '@/lib/traffic/trafficTarBuilder'

const log = createLogger('trafficAggregator')

const VALHALLA_URL            = process.env.VALHALLA_URL || ''

const DATEX_II_URL            = process.env.DATEX_II_URL || ''
const AGGREGATION_INTERVAL_MS = 120_000
const GPS_FRESHNESS_MS        = 300_000
const MAX_GPS_OBSERVATIONS    = 5_000

export interface TrafficObservation {
  lat:       number
  lng:       number
  speedKmh:  number
  timestamp: number
  source:    'gps' | 'datex'
}

interface LocateEdge {
  id:              string
  correlated_lat?: number
  correlated_lon?: number
}

interface LocateResult {
  edges?: LocateEdge[]
}

async function locateEdgesNearPoint(lat: number, lng: number): Promise<string[]> {
  if (!VALHALLA_URL) return []

  try {
    const res = await fetch(`${VALHALLA_URL}/locate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations:           [{ lat, lon: lng }],
        costing:             'truck',
        radius:              100,
        node_snap_tolerance: 5,
      }),
      signal: AbortSignal.timeout(3_000),
    })

    if (!res.ok) return []

    const data = await res.json() as LocateResult[]
    if (!Array.isArray(data) || !data[0]?.edges) return []

    return data[0].edges.slice(0, 2).map(e => e.id).filter(Boolean)
  } catch {
    return []
  }
}

export async function collectGpsSpeeds(): Promise<TrafficObservation[]> {
  try {
    // Cross-tenant on purpose: road speeds are anonymous (no driver or tenant leaves this
    // function) and the aggregator runs in the VRP worker, which never saw the web process's
    // memory. Latest reading of each truck over the last 5 minutes.
    const { unscopedPrisma } = await import('@/lib/tenantDb')
    const rows = await unscopedPrisma.driverPosition.findMany({
      where:    { recordedAt: { gte: new Date(Date.now() - GPS_FRESHNESS_MS) }, speedKmh: { gt: 2 } },
      orderBy:  { recordedAt: 'desc' },
      distinct: ['driverId'],
      select:   { latitude: true, longitude: true, speedKmh: true, recordedAt: true },
      take:     MAX_GPS_OBSERVATIONS,
    })
    const result: TrafficObservation[] = rows.map(r => ({
      lat: r.latitude, lng: r.longitude, speedKmh: r.speedKmh ?? 0, timestamp: r.recordedAt.getTime(), source: 'gps',
    }))

    log.debug('GPS speeds collected', { count: result.length })
    return result
  } catch (err) {
    log.warn('GPS speed collection failed', { err: err instanceof Error ? err.message : String(err) })
    return []
  }
}

export async function collectDatexEvents(): Promise<TrafficObservation[]> {
  if (!DATEX_II_URL) return []

  try {
    const res = await fetch(DATEX_II_URL, {
      signal:  AbortSignal.timeout(10_000),
      headers: { Accept: 'application/xml' },
    })

    if (!res.ok) {
      log.warn('DATEX II fetch failed', { status: res.status })
      return []
    }

    const xml = await res.text()
    return parseDatexXml(xml)
  } catch (err) {
    log.warn('DATEX II collection failed', { err: err instanceof Error ? err.message : String(err) })
    return []
  }
}

function parseDatexXml(xml: string): TrafficObservation[] {
  const observations: TrafficObservation[] = []
  const now = Date.now()

  const situationRe = /<situationRecord[^>]*>([\s\S]*?)<\/situationRecord>/g
  let m: RegExpExecArray | null

  // eslint-disable-next-line no-cond-assign
  while ((m = situationRe.exec(xml)) !== null) {
    const record = m[1]
    const latM = /<latitude>([\d.]+)<\/latitude>/i.exec(record)
    const lngM = /<longitude>([\d.]+)<\/longitude>/i.exec(record)
    if (!latM || !lngM) continue

    const lat = parseFloat(latM[1])
    const lng = parseFloat(lngM[1])
    if (!isFinite(lat) || !isFinite(lng)) continue
    if (lat < 41 || lat > 51.5 || lng < -5.5 || lng > 10) continue

    let speedKmh = 30
    if (/<roadClosed/i.test(record) || /fermeture/i.test(record))               speedKmh = 0
    else if (/<accident/i.test(record))                                          speedKmh = 10
    else if (/<roadworks/i.test(record) || /travaux/i.test(record))             speedKmh = 30
    else if (/<abnormalTraffic/i.test(record) || /ralentissement/i.test(record)) speedKmh = 20

    observations.push({ lat, lng, speedKmh, timestamp: now, source: 'datex' })
  }

  log.debug('DATEX II events parsed', { count: observations.length })
  return observations
}

async function resolveEdgeSpeeds(observations: TrafficObservation[]): Promise<EdgeSpeed[]> {
  if (!VALHALLA_URL || observations.length === 0) return []

  const edgeSpeeds: EdgeSpeed[] = []
  const datexObs = observations.filter(o => o.source === 'datex')
  const gpsObs   = observations.filter(o => o.source === 'gps')

  const CHUNK = 10
  for (let i = 0; i < datexObs.length; i += CHUNK) {
    const chunk = datexObs.slice(i, i + CHUNK)
    const results = await Promise.all(
      chunk.map(async obs => {
        const ids = await locateEdgesNearPoint(obs.lat, obs.lng)
        return ids.map(id => ({ edgeId: id, speedKmh: obs.speedKmh }))
      })
    )
    for (const r of results) edgeSpeeds.push(...r)
  }

  if (gpsObs.length > 0) {
    const BATCH = 50
    for (let i = 0; i < gpsObs.length; i += BATCH) {
      const batch = gpsObs.slice(i, i + BATCH)
      const shape = batch.map(o => ({ lat: o.lat, lon: o.lng, time: Math.floor(o.timestamp / 1000) }))

      try {
        const res = await fetch(`${VALHALLA_URL}/trace_attributes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shape,
            costing:     'truck',
            shape_match: 'map_snap',
            filters:     { attributes: ['edge.id', 'edge.speed'], action: 'include' },
          }),
          signal: AbortSignal.timeout(5_000),
        })

        if (!res.ok) continue

        const data = await res.json() as { edges?: Array<{ id?: string }> }
        if (!data.edges) continue

        for (let j = 0; j < data.edges.length && j < batch.length; j++) {
          const id = data.edges[j].id
          if (id) edgeSpeeds.push({ edgeId: String(id), speedKmh: batch[j].speedKmh })
        }
      } catch {  }
    }
  }

  return edgeSpeeds
}

let _running    = false
let _intervalId: ReturnType<typeof setInterval> | null = null

export function startTrafficAggregation(): void {
  if (_running || !VALHALLA_URL) return
  _running = true

  log.info('Traffic aggregation started', { intervalMs: AGGREGATION_INTERVAL_MS, datexConfigured: !!DATEX_II_URL })

  void runAggregationCycle()
  _intervalId = setInterval(() => void runAggregationCycle(), AGGREGATION_INTERVAL_MS)
}

export function stopTrafficAggregation(): void {
  _running = false
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null }
  log.info('Traffic aggregation stopped')
}

async function runAggregationCycle(): Promise<void> {
  try {
    const [gpsObs, datexObs] = await Promise.all([
      collectGpsSpeeds(),
      collectDatexEvents(),
    ])

    const all = [...gpsObs, ...datexObs]
    if (all.length === 0) return

    const edgeSpeeds = await resolveEdgeSpeeds(all)
    if (edgeSpeeds.length === 0) return

    const tar = buildTrafficTar(edgeSpeeds)
    if (!tar) return

    await writeTrafficTar(tar)

    log.info('Traffic cycle complete', {
      gps:   gpsObs.length,
      datex: datexObs.length,
      edges: edgeSpeeds.length,
      tarKb: Math.round(tar.length / 1024),
    })
  } catch (err) {
    log.error('Traffic aggregation cycle failed', { err: err instanceof Error ? err.message : String(err) })
  }
}
