import type { TenantDb } from '@/lib/tenantDb'
import { ApiError } from '@/lib/api/route'
import { assertTenantRefs } from '@/lib/tenantRefs'
import { nextNumber } from './numbering'
import { buildLines } from './lines'
import type { SalesLineInput } from './schemas'

type LineLike = Pick<SalesLineInput, 'label' | 'quantity' | 'unitPrice'> & {
  description?: string | null; unit?: string | null; discountPct?: number | null; vatRate?: number | null; explanation?: string | null
  missionType?: string | null; containerTypeId?: string | null; materialId?: string | null; plannedDate?: string | null
}

const OPERATION_TYPES = new Set(['POSER', 'RETIRER', 'ECHANGER', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR'])

function toInput(l: LineLike): SalesLineInput {
  return {
    label: l.label, description: l.description ?? undefined, quantity: l.quantity, unit: (l.unit ?? 'UNIT') as SalesLineInput['unit'],
    unitPrice: l.unitPrice, discountPct: l.discountPct ?? undefined, vatRate: l.vatRate ?? undefined, explanation: l.explanation ?? undefined,
    missionType: (l.missionType && OPERATION_TYPES.has(l.missionType) ? l.missionType : null) as SalesLineInput['missionType'],
    containerTypeId: l.containerTypeId ?? null, materialId: l.materialId ?? null, plannedDate: l.plannedDate ?? null,
  }
}

export async function createOrderFromLines(db: TenantDb, tenantId: string, userId: string, input: {
  clientId: string; siteId?: string | null; contractId?: string | null; kind: string; title?: string
  startDate: string; endDate?: string | null; notes?: string; lines: LineLike[]; createMissions?: boolean
}) {
  await assertTenantRefs(db, { clientId: input.clientId, siteId: input.siteId ?? undefined, contractId: input.contractId ?? undefined })
  const lineInputs = input.lines.map(toInput)
  for (const l of lineInputs) await assertTenantRefs(db, { containerTypeId: l.containerTypeId ?? undefined, materialId: l.materialId ?? undefined })
  const settings = await db.tenantSettings.findUnique({ where: { tenantId }, select: { orderPrefix: true, defaultVatRate: true } })
  const { lines, totals } = buildLines(lineInputs, settings?.defaultVatRate ?? 20)
  const order = await db.$transaction(async tx => {
    const number = await nextNumber(tx, tenantId, 'ORDER', settings?.orderPrefix ?? 'CMD')
    return tx.order.create({
      data: {
        number, clientId: input.clientId, siteId: input.siteId ?? null, contractId: input.contractId ?? null,
        kind: input.kind, title: input.title ?? '', startDate: input.startDate, endDate: input.endDate ?? null,
        notes: input.notes ?? '', totalHT: totals.totalHT, createdBy: userId,
        lines: { create: lines.map(l => ({ ...l, tenantId })) },
      } as Parameters<typeof tx.order.create>[0]['data'],
    })
  })
  if (input.createMissions) await createMissionsForOrder(db, order.id)
  return db.order.findFirst({ where: { id: order.id }, include: { lines: { orderBy: { position: 'asc' } }, missions: { select: { id: true, type: true, date: true } } } }).then(o => o!)
}

/**
 * Missions of an order, from its operational lines: one per unit of quantity, on the line's planned
 * date (else the order start). A pose with a planned end (POSE_RETRAIT, LONG_RENTAL) also gets its
 * pickup on the end date. Idempotent: lines that already produced missions are skipped.
 */
export async function createMissionsForOrder(db: TenantDb, orderId: string): Promise<number> {
  const order = await db.order.findFirst({
    where: { id: orderId },
    include: { lines: { orderBy: { position: 'asc' } }, missions: { select: { type: true, date: true } }, client: { select: { name: true } } },
  })
  if (!order) throw new ApiError(404, 'Commande introuvable', 'NOT_FOUND')
  if (order.status === 'CANCELLED') throw new ApiError(422, 'Commande annulée', 'CANCELLED')
  const site = order.siteId
    ? await db.site.findFirst({ where: { id: order.siteId }, select: { id: true, name: true, address: true, latitude: true, longitude: true, accessNotes: true, defaultManeuverMin: true } })
    : null
  const typeIds = [...new Set(order.lines.map(l => l.containerTypeId).filter((x): x is string => !!x))]
  const materialIds = [...new Set(order.lines.map(l => l.materialId).filter((x): x is string => !!x))]
  const [types, materials] = await Promise.all([
    typeIds.length ? db.containerType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true, capacityM3: true, tareKg: true } }) : [],
    materialIds.length ? db.material.findMany({ where: { id: { in: materialIds } }, select: { id: true, name: true } }) : [],
  ])
  const typeById = new Map(types.map(t => [t.id, t]))
  const matById = new Map(materials.map(m => [m.id, m]))
  const existing = new Set(order.missions.map(m => `${m.type}|${m.date}`))

  const plan: Array<{ type: string; date: string; line: typeof order.lines[number] }> = []
  for (const l of order.lines) {
    if (!l.missionType || !OPERATION_TYPES.has(l.missionType)) continue
    const date = l.plannedDate ?? order.startDate
    const n = Math.max(1, Math.round(Math.abs(l.quantity)))
    for (let i = 0; i < Math.min(n, 50); i++) plan.push({ type: l.missionType, date, line: l })
    const withPickup = (order.kind === 'POSE_RETRAIT' || order.kind === 'LONG_RENTAL') && l.missionType === 'POSER' && order.endDate
    if (withPickup && !order.lines.some(x => x.missionType === 'RETIRER')) plan.push({ type: 'RETIRER', date: order.endDate!, line: l })
  }
  let created = 0
  for (const p of plan) {
    const key = `${p.type}|${p.date}`
    if (existing.has(key)) { existing.delete(key); continue }
    const t = p.line.containerTypeId ? typeById.get(p.line.containerTypeId) : undefined
    const mat = p.line.materialId ? matById.get(p.line.materialId) : undefined
    const hasCoords = !!site && (site.latitude !== 0 || site.longitude !== 0)
    await db.mission.create({
      data: {
        type: p.type as never, date: p.date,
        address: site?.address || site?.name || order.client.name, latitude: site?.latitude ?? 0, longitude: site?.longitude ?? 0,
        needsGeocode: !hasCoords, estimatedDurationMin: 20, maneuverTimeMin: site?.defaultManeuverMin ?? 15,
        clientId: order.clientId, clientName: order.client.name, siteId: order.siteId, accessNotes: site?.accessNotes || null,
        orderId: order.id, containerTypeId: t?.id ?? null, binSizeM3: t?.capacityM3 ?? null, binSize: t?.name ?? null,
        binTareKg: t?.tareKg ?? null, materialId: mat?.id ?? null, wasteTypeLabel: mat?.name ?? null,
        notes: `Commande ${order.number}${p.line.label ? ` — ${p.line.label}` : ''}`,
      } as Parameters<typeof db.mission.create>[0]['data'],
    })
    created++
  }
  if (created > 0 && order.status === 'CONFIRMED') await db.order.update({ where: { id: order.id }, data: { status: 'IN_PROGRESS' } })
  return created
}

/** Progress of an order from its missions (done / total). */
export function orderProgress(missions: Array<{ completedAt: Date | null; archived?: boolean }>): { done: number; total: number } {
  const live = missions.filter(m => !m.archived)
  return { done: live.filter(m => m.completedAt).length, total: live.length }
}
