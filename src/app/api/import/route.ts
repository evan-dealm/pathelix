import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenantDb } from '@/lib/tenantDb'
import { Prisma } from '@/generated/prisma'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { redisCache } from '@/lib/redisCache'
import { createTenantRateLimiter } from '@/lib/rateLimit'

const log = createLogger('/api/import')

const _importRl = createTenantRateLimiter(10, 3_600_000, 'import')

const IMPORT_TYPES = ['missions', 'drivers', 'exutoires', 'clients', 'sites'] as const
const ImportSchema = z.object({
  type: z.enum(IMPORT_TYPES),
  data: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),

  columnMapping: z.record(z.string(), z.string()).optional(),
})

function parseCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === 'null' || value === 'undefined') return null
  const str = String(value).replace(',', '.')
  const num = Number(str)
  if (!isFinite(num) || isNaN(num)) return null
  return num
}

function hasValidCoords(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false
  if (lat < -90 || lat > 90) return false
  if (lng < -180 || lng > 180) return false
  if (lat === 0 && lng === 0) return false
  return true
}

const isBlank = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === ''

/**
 * Normalises a day to YYYY-MM-DD. Accepts ISO and the DD/MM/YYYY of French spreadsheet exports;
 * null when the value is not a real calendar day (30 February, free text…). Mission.date is a
 * plain string compared with the planning day: anything else is stored but shown on no day.
 */
function parseDay(value: unknown): string | null {
  const s = String(value).trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  const fr  = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  let y: number, m: number, d: number
  if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]) }
  else if (fr) { y = Number(fr[3]); m = Number(fr[2]); d = Number(fr[1]) }
  else return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Integer in [min, max] read from a cell; `fallback` when the cell is empty, null when invalid. */
function parseIntIn(value: unknown, min: number, max: number, fallback: number): number | null {
  if (isBlank(value)) return fallback
  const n = Number(String(value).trim().replace(',', '.'))
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

const MAX_MINUTES = 1440

/**
 * Builds the rows to write: `build` returns the row, or the reason it is refused (recorded with
 * its line number). A list imported with nameless entries cannot be told apart afterwards.
 */
function named<T>(
  rows: Array<Record<string, unknown>>,
  errors: string[],
  build: (_row: Record<string, unknown>) => T | string,
): T[] {
  const out: T[] = []
  rows.forEach((row, i) => {
    const built = build(row)
    if (typeof built === 'string') errors.push(`Ligne ${i + 1}: ${built}`)
    else out.push(built)
  })
  return out
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  }

  const allowed = await _importRl.check(`${tenantId}`)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Trop de demandes d\'import. Limite : 10 imports/heure par tenant.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = ImportSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { type, data, columnMapping } = parsed.data
  const errors: string[] = []
  let imported = 0
  let withCoords = 0
  let needsGeocodeCount = 0

  const mapped: Array<Record<string, unknown>> = columnMapping
    ? data.map((row: Record<string, unknown>) => {
        const result: Record<string, unknown> = {}
        for (const [src, tgt] of Object.entries(columnMapping)) {
          if (row[src] !== undefined) result[tgt] = row[src]
        }
        for (const [k, v] of Object.entries(row)) {
          if (!(k in columnMapping) && v !== undefined) result[k] = v
        }
        return result
      })
    : data

  try {
    const db = getTenantDb(tenantId)
    if (type === 'missions') {
      const VALID_TYPES = ['POSER','RETIRER','ECHANGER','VIDER','PAUSE','CHARGER_IMMEDIAT','DEPLACER','TASSER','EXPEDIER','ALLER_RETOUR'] as const
      type MType = (typeof VALID_TYPES)[number]
      const rows: Omit<Prisma.MissionCreateManyInput, 'tenantId'>[] = []
      for (let i = 0; i < mapped.length; i++) {
        const m = mapped[i]
        const rawType = String(m.type ?? '')
        if (!VALID_TYPES.includes(rawType as MType)) {
          errors.push(`Ligne ${i + 1}: type de mission inconnu "${rawType}"`)
          continue
        }
        if (rawType === 'VIDER' || rawType === 'PAUSE') {
          errors.push(`Ligne ${i + 1}: type "${rawType}" réservé au moteur VRP, import manuel refusé`)
          continue
        }
        // Same rules as POST /api/missions: a row that the planning could not show, or that
        // would distort a route (negative duration), is refused with its line number.
        const date = isBlank(m.date) ? new Date().toISOString().slice(0, 10) : parseDay(m.date)
        if (!date) {
          errors.push(`Ligne ${i + 1}: date invalide "${String(m.date).slice(0, 40)}" (attendu AAAA-MM-JJ ou JJ/MM/AAAA)`)
          continue
        }
        const address = isBlank(m.address) ? '' : String(m.address).trim()
        if (!address) { errors.push(`Ligne ${i + 1}: adresse manquante`); continue }
        const duration = parseIntIn(m.estimatedDurationMin ?? m.duration, 0, MAX_MINUTES, 30)
        if (duration === null) { errors.push(`Ligne ${i + 1}: durée invalide (0 à ${MAX_MINUTES} minutes)`); continue }
        const maneuver = parseIntIn(m.maneuverTimeMin ?? m.maneuver, 0, MAX_MINUTES, 15)
        if (maneuver === null) { errors.push(`Ligne ${i + 1}: temps de manœuvre invalide (0 à ${MAX_MINUTES} minutes)`); continue }
        const priority = isBlank(m.priority) ? undefined : parseIntIn(m.priority, 1, 3, 0)
        if (priority === null) { errors.push(`Ligne ${i + 1}: priorité invalide (1, 2 ou 3)`); continue }

        const lat = parseCoord(m.latitude)
        const lng = parseCoord(m.longitude)
        const coordsOk = hasValidCoords(lat, lng)
        if (coordsOk) withCoords++
        else needsGeocodeCount++
        rows.push({
          type:                 rawType as MType,
          date,
          address,
          latitude:             coordsOk ? (lat as number) : 0,
          longitude:            coordsOk ? (lng as number) : 0,
          needsGeocode:         !coordsOk,
          estimatedDurationMin: duration,
          maneuverTimeMin:      maneuver,
          clientName:           m.clientName     ? String(m.clientName)     : undefined,
          wasteTypeLabel:       m.wasteTypeLabel ? String(m.wasteTypeLabel) : undefined,
          priority,
          accessNotes:          m.accessNotes    ? String(m.accessNotes)    : undefined,
          binSize:              m.binSize        ? String(m.binSize)        : undefined,
        })
      }
      if (rows.length > 0) {
        const result = await db.mission.createMany({ data: rows as Parameters<typeof db.mission.createMany>[0]['data'] })
        imported = result.count
      }
    } else if (type === 'drivers') {
      const rows = named(mapped, errors, d => {
        const firstName = String(d.firstName ?? d.prenom ?? '').trim()
        const lastName  = String(d.lastName  ?? d.nom    ?? '').trim()
        if (!firstName || !lastName) return 'prénom et nom requis'
        return {
          firstName,
          lastName,
          sector:    String(d.sector    ?? d.secteur ?? ''),
          depotName: String(d.depotName ?? d.depot  ?? ''),
          depotLat:  parseCoord(d.depotLat  ?? d.latitude)  ?? 0,
          depotLng:  parseCoord(d.depotLng  ?? d.longitude) ?? 0,
          phone:     d.phone ? String(d.phone) : undefined,
        }
      })
      if (rows.length > 0) {
        const result = await db.driver.createMany({ data: rows as Parameters<typeof db.driver.createMany>[0]['data'] })
        imported = result.count
      }
    } else if (type === 'clients') {
      const rows = named(mapped, errors, c => {
        const name = String(c.name ?? c.nom ?? '').trim()
        if (!name) return 'nom manquant'
        return {
          name,
          contact: String(c.contact ?? ''),
          phone:   String(c.phone   ?? c.telephone ?? ''),
          email:   String(c.email   ?? ''),
        }
      })
      if (rows.length > 0) {
        const result = await db.client.createMany({ data: rows as Parameters<typeof db.client.createMany>[0]['data'] })
        imported = result.count
      }
    } else if (type === 'sites') {
      const rows = named(mapped, errors, s => {
        const name = String(s.name ?? s.nom ?? '').trim()
        if (!name) return 'nom manquant'
        return {
          name,
          address:   String(s.address ?? s.adresse ?? ''),
          latitude:  parseCoord(s.latitude)  ?? 0,
          longitude: parseCoord(s.longitude) ?? 0,
          sector:    s.sector ? String(s.sector) : undefined,
        }
      })
      if (rows.length > 0) {
        const result = await db.site.createMany({ data: rows as Parameters<typeof db.site.createMany>[0]['data'] })
        imported = result.count
      }
    } else if (type === 'exutoires') {
      const rows = named(mapped, errors, e => {
        const name = String(e.name ?? e.nom ?? '').trim()
        if (!name) return 'nom manquant'
        return {
          name,
          address:            String(e.address ?? e.adresse ?? ''),
          lat:                parseCoord(e.lat ?? e.latitude)   ?? 0,
          lng:                parseCoord(e.lng ?? e.longitude)  ?? 0,
          openingHoursOpen:   Number(e.openingHoursOpen  ?? e.ouverture   ?? 420)  || 420,
          openingHoursClose:  Number(e.openingHoursClose ?? e.fermeture   ?? 1080) || 1080,
          serviceTimeMin:     Number(e.serviceTimeMin    ?? e.tempsService ?? 30)   || 30,
          closedDays:         Array.isArray(e.closedDays)         ? e.closedDays         : [],
          acceptedWasteTypes: Array.isArray(e.acceptedWasteTypes) ? e.acceptedWasteTypes : [],
        }
      })
      if (rows.length > 0) {
        const result = await db.exutoire.createMany({ data: rows as unknown as Parameters<typeof db.exutoire.createMany>[0]['data'] })
        imported = result.count
      }
    }

    if (imported > 0) {
      void redisCache.invalidateAll(type, tenantId)
    }

    log.info('Import completed', { tenantId, type, imported, needsGeocode: needsGeocodeCount, errors: errors.length })
    return NextResponse.json({ imported, withCoords, needsGeocode: needsGeocodeCount, errors: errors.slice(0, 50), totalErrors: errors.length })
  } catch (err) {
    log.error('Import failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
