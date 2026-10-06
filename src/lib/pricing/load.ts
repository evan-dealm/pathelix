import type { TenantDb } from '@/lib/tenantDb'
import { RULE_CODES, type PriceRuleData, type RuleCode, type RuleConditions, type RuleUnit } from './engine'

const UNITS: readonly RuleUnit[] = ['UNIT', 'KM', 'DAY', 'TON', 'PCT', 'FLAT']

function validOn(date: string | undefined, from: string | null, to: string | null): boolean {
  if (!date) return true
  return (!from || from <= date) && (!to || to >= date)
}

function conditionsOf(raw: unknown): RuleConditions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const c = raw as Record<string, unknown>
  const str = (k: string) => (typeof c[k] === 'string' && c[k] ? String(c[k]) : undefined)
  const num = (k: string) => (typeof c[k] === 'number' && Number.isFinite(c[k]) ? Number(c[k]) : undefined)
  return {
    containerTypeId: str('containerTypeId'), materialId: str('materialId'), missionType: str('missionType'),
    zipPrefix: str('zipPrefix'), freeDays: num('freeDays'), minQty: num('minQty'),
  }
}

/**
 * Rules that apply to a customer on a date: the grid of their contract (if given), their own
 * grids, then the default grid. Customer/contract grids win over the default one in the engine.
 */
export async function loadRules(db: TenantDb, opts: { clientId?: string | null; contractId?: string | null; date?: string }): Promise<PriceRuleData[]> {
  let contractListId: string | null = null
  if (opts.contractId) {
    const c = await db.contract.findFirst({ where: { id: opts.contractId }, select: { priceListId: true } })
    contractListId = c?.priceListId ?? null
  }
  const lists = await db.priceList.findMany({
    where: {
      archived: false,
      OR: [
        { isDefault: true },
        ...(opts.clientId ? [{ clientId: opts.clientId }] : []),
        ...(contractListId ? [{ id: contractListId }] : []),
      ],
    },
    select: { id: true, name: true, isDefault: true, clientId: true, validFrom: true, validTo: true, rules: { where: { active: true } } },
  })
  const out: PriceRuleData[] = []
  for (const l of lists) {
    if (!validOn(opts.date, l.validFrom, l.validTo)) continue
    const customerGrid = l.id === contractListId || (!!opts.clientId && l.clientId === opts.clientId)
    for (const r of l.rules) {
      if (!(RULE_CODES as readonly string[]).includes(r.code)) continue
      out.push({
        id: r.id, code: r.code as RuleCode, label: r.label,
        unit: (UNITS as readonly string[]).includes(r.unit) ? r.unit as RuleUnit : 'UNIT',
        amount: r.amount, vatRate: r.vatRate, conditions: conditionsOf(r.conditions), priority: r.priority,
        priceListName: l.name, customerGrid,
      })
    }
  }
  return out
}
