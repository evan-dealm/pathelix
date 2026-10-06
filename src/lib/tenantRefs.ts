import type { TenantDb } from '@/lib/tenantDb'

/**
 * Foreign keys only prove that a row exists — not that it belongs to the caller's tenant. Any id
 * taken from a request body and stored as a reference (mission → client/site/product/exutoire/
 * dependency, plan → driver, …) must be checked against the tenant first, otherwise tenant A can
 * link its records to tenant B's and later read B's data back through the relation.
 */

export class ForeignTenantRefError extends Error {
  constructor(public readonly field: string) {
    super(`Référence invalide : ${field}`)
    this.name = 'ForeignTenantRefError'
  }
}

type RefModel = 'client' | 'site' | 'siteProduct' | 'exutoire' | 'mission' | 'driver' | 'vehicle' | 'missionTemplate' | 'material'

const FIELD_MODELS: Record<string, RefModel> = {
  clientId:                'client',
  siteId:                  'site',
  productId:               'siteProduct',
  defaultExutoireId:       'exutoire',
  linkedExutoireId:        'exutoire',
  startingExutoireId:      'exutoire',
  dependsOnId:             'mission',
  missionId:               'mission',
  driverId:                'driver',
  assignedDriverId:        'driver',
  vehicleId:               'vehicle',
  generatedFromTemplateId: 'missionTemplate',
  materialId:              'material',
}

interface FindFirstDelegate {
  findFirst(_args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>
}

/**
 * Throws ForeignTenantRefError for the first known reference field of `data` whose id doesn't
 * exist in the tenant. Null/undefined/empty values (unset or cleared references) are ignored.
 */
export async function assertTenantRefs(db: TenantDb, data: Record<string, unknown>): Promise<void> {
  for (const [field, model] of Object.entries(FIELD_MODELS)) {
    const id = data[field]
    if (typeof id !== 'string' || id === '') continue
    const delegate = (db as unknown as Record<RefModel, FindFirstDelegate>)[model]
    const row = await delegate.findFirst({ where: { id }, select: { id: true } })
    if (!row) throw new ForeignTenantRefError(field)
  }
}

/** Same check for a list of driver ids (plans, weekly plans, live optimisation…). */
export async function assertTenantDrivers(db: TenantDb, driverIds: Iterable<string>): Promise<void> {
  const unique = [...new Set(driverIds)].filter(Boolean)
  if (unique.length === 0) return
  const found = await db.driver.count({ where: { id: { in: unique } } })
  if (found !== unique.length) throw new ForeignTenantRefError('driverId')
}

/** Route-handler form: a 422 response when a reference is foreign/unknown, otherwise null. */
export async function tenantRefsError(db: TenantDb, data: Record<string, unknown>): Promise<import('next/server').NextResponse | null> {
  try {
    await assertTenantRefs(db, data)
    return null
  } catch (err) {
    if (!(err instanceof ForeignTenantRefError)) throw err
    const { NextResponse } = await import('next/server')
    return NextResponse.json({ error: err.message }, { status: 422 })
  }
}
