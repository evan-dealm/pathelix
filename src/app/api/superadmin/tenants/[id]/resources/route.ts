import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { logSuperadminAction } from '@/lib/superadminAudit'

const log = createLogger('/api/superadmin/tenants/[id]/resources')

type Params = { params: Promise<{ id: string }> }

const ENTITIES = ['driver', 'client', 'vehicle', 'exutoire', 'site', 'mission', 'missionTemplate'] as const
type EntityType = typeof ENTITIES[number]

type PrismaDelegate = {
  create(_args: { data: Record<string, unknown> }): Promise<{ id: string } & Record<string, unknown>>
  update(_args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>
  delete(_args: { where: { id: string } }): Promise<unknown>
  findUnique(_args: { where: { id: string }; select: Record<string, boolean> }): Promise<{ id: string; tenantId: string } | null>
}

const ResourceSchema = z.object({
  entity: z.enum(ENTITIES),
  action: z.enum(['create', 'update', 'delete'] as const),
  id: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})

// The console edits a row through a generic form whose values are all text: each field is
// converted to its column type here, and a key that is not listed is refused. Relations
// (driverId, clientId, siteId…) are deliberately absent — a superadmin edit cannot point a row
// at another organisation's data.
const text = (max = 500) => z.string().max(max)
const num = z.preprocess(
  v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
  z.number().finite(),
)
const optNum = z.preprocess(
  v => (v === '' ? null : typeof v === 'string' ? Number(v) : v),
  z.number().finite().nullable(),
)
const optInt = z.preprocess(
  v => (v === '' ? null : typeof v === 'string' ? Number(v) : v),
  z.number().int().nullable(),
)
const bool = z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
const optText = z.preprocess(v => (v === '' ? null : v), z.string().max(500).nullable())
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
const optDay = z.preprocess(v => (v === '' ? null : v), day.nullable())
const json = z.preprocess(v => {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) as unknown } catch { return undefined }
}, z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]))

const FIELD_SCHEMAS: Record<EntityType, z.ZodType<Record<string, unknown>>> = {
  driver: z.object({
    firstName: text(100), lastName: text(100), phone: text(50), email: text(254), sector: text(100),
    depotName: text(200), depotLat: num, depotLng: num, maxBinSizeM3: optNum, archived: bool,
  }).partial().strict(),
  client: z.object({
    name: text(200), contact: text(200), phone: text(50), email: text(254), sector: text(100),
    vip: bool, archived: bool,
  }).partial().strict(),
  vehicle: z.object({
    licensePlate: text(20), type: text(50), brand: text(100), capacityM3: optNum, status: text(50),
    archived: bool,
  }).partial().strict(),
  exutoire: z.object({
    name: text(200), address: text(), lat: num, lng: num, acceptedWasteTypes: json,
  }).partial().strict(),
  site: z.object({
    name: text(200), address: text(), latitude: num, longitude: num, sector: text(100), archived: bool,
  }).partial().strict(),
  mission: z.object({
    type: text(50), date: day, address: text(), latitude: num, longitude: num, clientName: optText,
    wasteTypeLabel: optText, priority: optInt, archived: bool,
  }).partial().strict(),
  missionTemplate: z.object({
    label: text(200), type: text(50), enabled: bool, address: text(), latitude: num, longitude: num,
    clientName: text(200), wasteTypeLabel: text(200), priority: optInt, recurrence: json,
    startDate: day, endDate: optDay,
  }).partial().strict(),
}

function getModel(entity: EntityType): PrismaDelegate {
  const map: Record<EntityType, PrismaDelegate> = {
    driver:          prisma.driver          as unknown as PrismaDelegate,
    client:          prisma.client          as unknown as PrismaDelegate,
    vehicle:         prisma.vehicle         as unknown as PrismaDelegate,
    exutoire:        prisma.exutoire        as unknown as PrismaDelegate,
    site:            prisma.site            as unknown as PrismaDelegate,
    mission:         prisma.mission         as unknown as PrismaDelegate,
    missionTemplate: prisma.missionTemplate as unknown as PrismaDelegate,
  }
  return map[entity]
}

/** Validates the fields of a create/update against the entity's columns. */
function parseFields(entity: EntityType, data: Record<string, unknown>) {
  const input: Record<string, unknown> = { ...data }
  delete input.id
  delete input.tenantId
  delete input.createdAt
  delete input.updatedAt
  return FIELD_SCHEMAS[entity].safeParse(input)
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {

  const { userId: superadminId, role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  const { id: tenantId } = await params

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = ResourceSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { entity, action, id, data } = parsed.data
  const model = getModel(entity)

  try {

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })

    let result: unknown

    if (action === 'create') {
      if (!data) return NextResponse.json({ error: 'data requis pour create' }, { status: 422 })

      const fields = parseFields(entity, data)
      if (!fields.success) return NextResponse.json({ error: fields.error.flatten() }, { status: 422 })
      result = await model.create({ data: { ...fields.data, tenantId } })
      const resourceId = (result as { id: string }).id
      log.info('SuperAdmin resource created', { tenantId, entity, resourceId })
      await logSuperadminAction({
        superadminId,
        targetTenantId: tenantId,
        isImpersonation: false,
        method: 'POST',
        path: `/api/superadmin/tenants/${tenantId}/resources`,
        action: 'resource_created',
        details: { entity, resourceId },
      })
    }

    else if (action === 'update') {
      if (!id || !data) return NextResponse.json({ error: 'id et data requis pour update' }, { status: 422 })

      const fields = parseFields(entity, data)
      if (!fields.success) return NextResponse.json({ error: fields.error.flatten() }, { status: 422 })

      const existing = await model.findUnique({ where: { id }, select: { tenantId: true } })
      if (!existing || existing.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Ressource introuvable dans ce tenant' }, { status: 404 })
      }
      result = await model.update({ where: { id }, data: fields.data })
      log.info('SuperAdmin resource updated', { tenantId, entity, resourceId: id })
      await logSuperadminAction({
        superadminId,
        targetTenantId: tenantId,
        isImpersonation: false,
        method: 'POST',
        path: `/api/superadmin/tenants/${tenantId}/resources`,
        action: 'resource_updated',
        details: { entity, resourceId: id, changedKeys: Object.keys(fields.data) },
      })
    }

    else if (action === 'delete') {
      if (!id) return NextResponse.json({ error: 'id requis pour delete' }, { status: 422 })

      const existing = await model.findUnique({ where: { id }, select: { tenantId: true } })
      if (!existing || existing.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Ressource introuvable dans ce tenant' }, { status: 404 })
      }
      result = await model.delete({ where: { id } })
      log.info('SuperAdmin resource deleted', { tenantId, entity, resourceId: id })
      await logSuperadminAction({
        superadminId,
        targetTenantId: tenantId,
        isImpersonation: false,
        method: 'POST',
        path: `/api/superadmin/tenants/${tenantId}/resources`,
        action: 'resource_deleted',
        details: { entity, resourceId: id },
      })
    }

    return NextResponse.json({ ok: true, result })
  } catch (err) {
    // A value Prisma refuses (unknown mission type, missing required column on create) is the
    // caller's mistake, not a server failure.
    if (err instanceof Error && err.name === 'PrismaClientValidationError') {
      return NextResponse.json({ error: 'Données refusées : champ manquant ou valeur invalide' }, { status: 422 })
    }
    log.error('Resource action failed', { tenantId, entity, action, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
