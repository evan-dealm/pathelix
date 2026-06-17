import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
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
    if (type === 'missions') {
      const VALID_TYPES = ['POSER','RETIRER','ECHANGER','VIDER','PAUSE','CHARGER_IMMEDIAT','DEPLACER','TASSER','EXPEDIER','ALLER_RETOUR'] as const
      type MType = (typeof VALID_TYPES)[number]
      const rows: Prisma.MissionCreateManyInput[] = []
      for (let i = 0; i < mapped.length; i++) {
        const m = mapped[i]
        const rawType = String(m.type ?? '')
        if (!VALID_TYPES.includes(rawType as MType)) {
          errors.push(`Ligne ${i + 1}: type de mission inconnu "${rawType}"`)
          continue
        }
        const lat = parseCoord(m.latitude)
        const lng = parseCoord(m.longitude)
        const coordsOk = hasValidCoords(lat, lng)
        if (coordsOk) withCoords++
        else needsGeocodeCount++
        rows.push({
          tenantId,
          type:                 rawType as MType,
          date:                 String(m.date ?? new Date().toISOString().slice(0, 10)),
          address:              String(m.address ?? ''),
          latitude:             coordsOk ? (lat as number) : 0,
          longitude:            coordsOk ? (lng as number) : 0,
          needsGeocode:         !coordsOk,
          estimatedDurationMin: Number(m.estimatedDurationMin ?? m.duration ?? 30)  || 30,
          maneuverTimeMin:      Number(m.maneuverTimeMin ?? m.maneuver ?? 15)        || 15,
          clientName:           m.clientName     ? String(m.clientName)     : undefined,
          wasteTypeLabel:       m.wasteTypeLabel ? String(m.wasteTypeLabel) : undefined,
          priority:             m.priority       ? (Number(m.priority) || undefined)  : undefined,
          accessNotes:          m.accessNotes    ? String(m.accessNotes)    : undefined,
          binSize:              m.binSize        ? String(m.binSize)        : undefined,
        })
      }
      if (rows.length > 0) {
        const result = await prisma.mission.createMany({ data: rows })
        imported = result.count
      }
    } else if (type === 'drivers') {
      const rows = mapped.map(d => ({
        tenantId,
        firstName: String(d.firstName ?? d.prenom ?? ''),
        lastName:  String(d.lastName  ?? d.nom    ?? ''),
        sector:    String(d.sector    ?? d.secteur ?? ''),
        depotName: String(d.depotName ?? d.depot  ?? ''),
        depotLat:  parseCoord(d.depotLat  ?? d.latitude)  ?? 0,
        depotLng:  parseCoord(d.depotLng  ?? d.longitude) ?? 0,
        phone:     d.phone ? String(d.phone) : undefined,
      }))
      const result = await prisma.driver.createMany({ data: rows })
      imported = result.count
    } else if (type === 'clients') {
      const rows = mapped.map(c => ({
        tenantId,
        name:    String(c.name    ?? c.nom       ?? ''),
        contact: String(c.contact ?? ''),
        phone:   String(c.phone   ?? c.telephone ?? ''),
        email:   String(c.email   ?? ''),
      }))
      const result = await prisma.client.createMany({ data: rows })
      imported = result.count
    } else if (type === 'sites') {
      const rows = mapped.map(s => ({
        tenantId,
        name:      String(s.name    ?? s.nom    ?? ''),
        address:   String(s.address ?? s.adresse ?? ''),
        latitude:  parseCoord(s.latitude)  ?? 0,
        longitude: parseCoord(s.longitude) ?? 0,
        sector:    s.sector ? String(s.sector) : undefined,
      }))
      const result = await prisma.site.createMany({ data: rows })
      imported = result.count
    } else if (type === 'exutoires') {
      const rows = mapped.map(e => ({
        tenantId,
        name:               String(e.name    ?? e.nom    ?? ''),
        address:            String(e.address ?? e.adresse ?? ''),
        lat:                parseCoord(e.lat ?? e.latitude)   ?? 0,
        lng:                parseCoord(e.lng ?? e.longitude)  ?? 0,
        openingHoursOpen:   Number(e.openingHoursOpen  ?? e.ouverture   ?? 420)  || 420,
        openingHoursClose:  Number(e.openingHoursClose ?? e.fermeture   ?? 1080) || 1080,
        serviceTimeMin:     Number(e.serviceTimeMin    ?? e.tempsService ?? 30)   || 30,
        closedDays:         Array.isArray(e.closedDays)         ? e.closedDays         : [],
        acceptedWasteTypes: Array.isArray(e.acceptedWasteTypes) ? e.acceptedWasteTypes : [],
      }))
      const result = await prisma.exutoire.createMany({ data: rows })
      imported = result.count
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
