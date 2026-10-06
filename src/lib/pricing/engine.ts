/**
 * Pricing engine: turns what is sold or done (operations, rental days, tonnes, kilometres) into
 * priced lines, from the tenant's grids — never hard-coded prices — and says, for every line,
 * where its price comes from. Pure: data loading is in load.ts.
 *
 * Rule choice for an item: rules of the matching code whose conditions all hold; the most
 * specific wins (customer grid before the default grid, then the number of matching conditions,
 * then the rule priority). Percent rules (fuel, urgency, week-end, customer discount) and the
 * minimum invoice are applied after the base lines.
 */

export const RULE_CODES = [
  'TRANSPORT', 'KM', 'ZONE', 'POSE', 'RETRAIT', 'ECHANGE', 'ROTATION', 'ALLER_RETOUR', 'RENTAL_DAY',
  'TREATMENT_TON', 'EXUTOIRE', 'FUEL_PCT', 'URGENCY_PCT', 'WEEKEND_PCT', 'DISCOUNT_PCT', 'MINIMUM', 'CUSTOM',
] as const
export type RuleCode = typeof RULE_CODES[number]

export const RULE_LABEL: Record<RuleCode, string> = {
  TRANSPORT: 'Transport (forfait par déplacement)', KM: 'Transport au kilomètre', ZONE: 'Forfait de zone',
  POSE: 'Pose', RETRAIT: 'Retrait', ECHANGE: 'Échange', ROTATION: 'Rotation (vidage)', ALLER_RETOUR: 'Aller-retour exutoire',
  RENTAL_DAY: 'Location par jour', TREATMENT_TON: 'Traitement à la tonne', EXUTOIRE: 'Frais d\'exutoire par passage',
  FUEL_PCT: 'Surcharge carburant (%)', URGENCY_PCT: 'Majoration urgence (%)', WEEKEND_PCT: 'Majoration week-end (%)',
  DISCOUNT_PCT: 'Remise client (%)', MINIMUM: 'Minimum de facturation', CUSTOM: 'Autre',
}

export type RuleUnit = 'UNIT' | 'KM' | 'DAY' | 'TON' | 'PCT' | 'FLAT'

export interface RuleConditions {
  containerTypeId?: string
  materialId?:      string
  missionType?:     string
  /** Postal code prefix(es) of the site ("38", "69,01"). */
  zipPrefix?:       string
  /** RENTAL_DAY: days included before rental is charged (franchise). */
  freeDays?:        number
  minQty?:          number
}

export interface PriceRuleData {
  id:            string
  code:          RuleCode
  label:         string
  unit:          RuleUnit
  amount:        number
  vatRate:       number
  conditions:    RuleConditions
  priority:      number
  priceListName: string
  /** Grid negotiated for this customer (wins over the default grid). */
  customerGrid:  boolean
}

export type BillableItem =
  | { kind: 'OPERATION'; missionType: string; containerTypeId?: string; materialId?: string; zip?: string; quantity?: number; label?: string; missionId?: string; containerId?: string }
  | { kind: 'RENTAL'; containerTypeId?: string; days: number; label?: string; containerId?: string; fallbackDailyPrice?: number | null; freeDays?: number }
  | { kind: 'TREATMENT'; materialId?: string; tons: number; label?: string; weighingId?: string; missionId?: string }
  | { kind: 'KM'; km: number; label?: string }

export interface PricingModifiers {
  /** YYYY-MM-DD of the operation (week-end surcharge). */
  date?:   string
  urgent?: boolean
  /** Default VAT rate (%) for lines whose rule does not say. */
  defaultVatRate?: number
}

export interface PricedLine {
  code:        RuleCode | 'UNPRICED'
  label:       string
  quantity:    number
  unit:        RuleUnit
  unitPrice:   number
  discountPct: number
  vatRate:     number
  amountHT:    number
  explanation: string
  missionId?:   string
  containerId?: string
  weighingId?:  string
  missionType?: string
  containerTypeId?: string
  materialId?:  string
}

export interface PricingResult {
  lines:    PricedLine[]
  totals:   Totals
  /** Items no rule could price — shown so nobody bills 0 € by mistake. */
  warnings: string[]
}

export interface Totals { totalHT: number; totalVAT: number; totalTTC: number; vatByRate: Array<{ rate: number; base: number; vat: number }> }

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const OPERATION_CODE: Record<string, RuleCode> = {
  POSER: 'POSE', RETIRER: 'RETRAIT', ECHANGER: 'ECHANGE', ALLER_RETOUR: 'ALLER_RETOUR',
  CHARGER_IMMEDIAT: 'RETRAIT', DEPLACER: 'CUSTOM', TASSER: 'CUSTOM', EXPEDIER: 'CUSTOM',
}

const fmtEur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function zipMatches(prefixes: string | undefined, zip: string | undefined): boolean {
  if (!prefixes) return true
  if (!zip) return false
  return prefixes.split(',').map(s => s.trim()).filter(Boolean).some(p => zip.startsWith(p))
}

/** Specificity score of a rule for an item, or null when one of its conditions does not hold. */
function score(r: PriceRuleData, item: { containerTypeId?: string; materialId?: string; missionType?: string; zip?: string; qty?: number }): number | null {
  const c = r.conditions ?? {}
  let s = r.customerGrid ? 1000 : 0
  if (c.containerTypeId) { if (c.containerTypeId !== item.containerTypeId) return null; s += 10 }
  if (c.materialId) { if (c.materialId !== item.materialId) return null; s += 10 }
  if (c.missionType) { if (c.missionType !== item.missionType) return null; s += 10 }
  if (c.zipPrefix) { if (!zipMatches(c.zipPrefix, item.zip)) return null; s += 10 }
  if (c.minQty !== undefined && (item.qty ?? 1) < c.minQty) return null
  return s + r.priority / 1000
}

export function bestRule(rules: PriceRuleData[], codes: RuleCode[], item: Parameters<typeof score>[1]): PriceRuleData | null {
  let best: PriceRuleData | null = null
  let bestScore = -Infinity
  for (const r of rules) {
    if (!codes.includes(r.code)) continue
    const s = score(r, item)
    if (s !== null && s > bestScore) { best = r; bestScore = s }
  }
  return best
}

function why(r: PriceRuleData, unitPrice: number, unitLabel: string): string {
  return `Grille « ${r.priceListName} » — ${r.label} : ${fmtEur(unitPrice)}${unitLabel}`
}

function line(partial: Omit<PricedLine, 'amountHT' | 'discountPct'> & { discountPct?: number }): PricedLine {
  const discountPct = partial.discountPct ?? 0
  return { ...partial, discountPct, amountHT: round2(partial.quantity * partial.unitPrice * (1 - discountPct / 100)) }
}

export function computeTotals(lines: Array<Pick<PricedLine, 'amountHT' | 'vatRate'>>): Totals {
  const byRate = new Map<number, number>()
  for (const l of lines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + l.amountHT)
  const vatByRate = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, base]) => ({ rate, base: round2(base), vat: round2(base * rate / 100) }))
  const totalHT = round2(vatByRate.reduce((a, v) => a + v.base, 0))
  const totalVAT = round2(vatByRate.reduce((a, v) => a + v.vat, 0))
  return { totalHT, totalVAT, totalTTC: round2(totalHT + totalVAT), vatByRate }
}

function isWeekend(date?: string): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return dow === 0 || dow === 6
}

/**
 * Prices a list of items with the rules of the customer's grids (customer grid first).
 * `invoiceLevel: false` leaves out the customer discount and the minimum invoice — for pricing one
 * operation among others, the document-level adjustments being applied once at the end
 * ({@link applyDocumentAdjustments}).
 */
export function priceItems(items: BillableItem[], rules: PriceRuleData[], mods: PricingModifiers = {}, opts: { invoiceLevel?: boolean } = {}): PricingResult {
  const defaultVat = mods.defaultVatRate ?? 20
  const active = rules.filter(r => Number.isFinite(r.amount))
  const lines: PricedLine[] = []
  const warnings: string[] = []
  const transportish: PricedLine[] = []

  for (const item of items) {
    switch (item.kind) {
      case 'OPERATION': {
        const code = OPERATION_CODE[item.missionType] ?? 'CUSTOM'
        const ctx = { containerTypeId: item.containerTypeId, materialId: item.materialId, missionType: item.missionType, zip: item.zip, qty: item.quantity }
        const r = bestRule(active, [code], ctx)
        const qty = item.quantity ?? 1
        const label = item.label ?? (r ? r.label : `Prestation ${item.missionType.toLowerCase()}`)
        if (r) {
          const l = line({ code: r.code, label, quantity: qty, unit: 'UNIT', unitPrice: r.amount, vatRate: r.vatRate ?? defaultVat, explanation: why(r, r.amount, ''), missionId: item.missionId, containerId: item.containerId, missionType: item.missionType, containerTypeId: item.containerTypeId, materialId: item.materialId })
          lines.push(l); transportish.push(l)
        } else {
          warnings.push(`Aucun tarif pour « ${label} » — ligne à 0 € à compléter`)
          lines.push(line({ code: 'UNPRICED', label, quantity: qty, unit: 'UNIT', unitPrice: 0, vatRate: defaultVat, explanation: 'Aucun tarif trouvé dans les grilles — prix à saisir', missionId: item.missionId, containerId: item.containerId, missionType: item.missionType, containerTypeId: item.containerTypeId, materialId: item.materialId }))
        }
        // Transport: a zone flat rate when the site is in a zone, else the per-trip flat rate.
        const t = bestRule(active, ['ZONE'], ctx) ?? bestRule(active, ['TRANSPORT'], ctx)
        if (t) {
          const l = line({ code: t.code, label: t.label, quantity: qty, unit: 'UNIT', unitPrice: t.amount, vatRate: t.vatRate ?? defaultVat, explanation: why(t, t.amount, ' par déplacement'), missionId: item.missionId })
          lines.push(l); transportish.push(l)
        }
        const ex = item.missionType === 'RETIRER' || item.missionType === 'ECHANGER' || item.missionType === 'ALLER_RETOUR'
          ? bestRule(active, ['EXUTOIRE'], ctx) : null
        if (ex) lines.push(line({ code: 'EXUTOIRE', label: ex.label, quantity: qty, unit: 'UNIT', unitPrice: ex.amount, vatRate: ex.vatRate ?? defaultVat, explanation: why(ex, ex.amount, ' par passage'), missionId: item.missionId }))
        break
      }
      case 'RENTAL': {
        const r = bestRule(active, ['RENTAL_DAY'], { containerTypeId: item.containerTypeId })
        const freeDays = item.freeDays ?? r?.conditions.freeDays ?? 0
        const billable = Math.max(0, Math.round(item.days) - freeDays)
        const label = item.label ?? 'Location de benne'
        if (billable === 0) break
        const unitPrice = r?.amount ?? item.fallbackDailyPrice ?? null
        if (unitPrice === null) { warnings.push(`Aucun tarif de location pour « ${label} »`); break }
        const explanation = r
          ? `${why(r, r.amount, ' / jour')} — ${item.days} j${freeDays ? ` dont ${freeDays} j de franchise` : ''}`
          : `Tarif journalier du type de benne : ${fmtEur(unitPrice)} / jour — ${item.days} j${freeDays ? ` dont ${freeDays} j de franchise` : ''}`
        lines.push(line({ code: 'RENTAL_DAY', label, quantity: billable, unit: 'DAY', unitPrice, vatRate: r?.vatRate ?? defaultVat, explanation, containerId: item.containerId, containerTypeId: item.containerTypeId }))
        break
      }
      case 'TREATMENT': {
        const r = bestRule(active, ['TREATMENT_TON'], { materialId: item.materialId })
        const label = item.label ?? 'Traitement'
        const tons = Math.round(item.tons * 1000) / 1000
        if (!r) { warnings.push(`Aucun tarif de traitement pour « ${label} »`); lines.push(line({ code: 'UNPRICED', label, quantity: tons, unit: 'TON', unitPrice: 0, vatRate: defaultVat, explanation: 'Aucun tarif à la tonne — prix à saisir', weighingId: item.weighingId, missionId: item.missionId, materialId: item.materialId })); break }
        lines.push(line({ code: 'TREATMENT_TON', label, quantity: tons, unit: 'TON', unitPrice: r.amount, vatRate: r.vatRate ?? defaultVat, explanation: `${why(r, r.amount, ' / t')} — pesée ${tons.toLocaleString('fr-FR')} t`, weighingId: item.weighingId, missionId: item.missionId, materialId: item.materialId }))
        break
      }
      case 'KM': {
        const r = bestRule(active, ['KM'], {})
        if (!r) { warnings.push('Aucun tarif kilométrique'); break }
        const l = line({ code: 'KM', label: item.label ?? r.label, quantity: Math.round(item.km * 10) / 10, unit: 'KM', unitPrice: r.amount, vatRate: r.vatRate ?? defaultVat, explanation: why(r, r.amount, ' / km') })
        lines.push(l); transportish.push(l)
        break
      }
    }
  }

  // Percentages on the base lines.
  const pct = (codes: RuleCode[], base: PricedLine[], cond: boolean, label: (_r: PriceRuleData) => string) => {
    if (!cond || base.length === 0) return
    const r = bestRule(active, codes, {})
    if (!r || r.amount === 0) return
    const baseHT = round2(base.reduce((a, l) => a + l.amountHT, 0))
    if (baseHT === 0) return
    lines.push(line({ code: r.code, label: label(r), quantity: 1, unit: 'PCT', unitPrice: round2(baseHT * r.amount / 100), vatRate: r.vatRate ?? defaultVat, explanation: `Grille « ${r.priceListName} » — ${r.amount} % de ${fmtEur(baseHT)}` }))
  }
  const baseLines = [...lines]
  pct(['FUEL_PCT'], transportish, true, r => `${r.label} (${r.amount} %)`)
  pct(['URGENCY_PCT'], baseLines, !!mods.urgent, r => `${r.label} (${r.amount} %)`)
  pct(['WEEKEND_PCT'], baseLines, isWeekend(mods.date), r => `${r.label} (${r.amount} %)`)
  if (opts.invoiceLevel !== false) lines.push(...applyDocumentAdjustments(lines, active, defaultVat))
  return { lines, totals: computeTotals(lines), warnings }
}

/** Customer discount and minimum invoice, computed once on a whole document's lines. */
export function applyDocumentAdjustments(lines: PricedLine[], rules: PriceRuleData[], defaultVat = 20): PricedLine[] {
  const out: PricedLine[] = []
  const disc = bestRule(rules, ['DISCOUNT_PCT'], {})
  if (disc && disc.amount > 0) {
    const baseHT = round2(lines.reduce((a, l) => a + l.amountHT, 0))
    if (baseHT > 0) out.push(line({ code: 'DISCOUNT_PCT', label: `${disc.label} (${disc.amount} %)`, quantity: 1, unit: 'PCT', unitPrice: -round2(baseHT * disc.amount / 100), vatRate: disc.vatRate ?? defaultVat, explanation: `Grille « ${disc.priceListName} » — remise de ${disc.amount} % sur ${fmtEur(baseHT)}` }))
  }
  const min = bestRule(rules, ['MINIMUM'], {})
  const subtotal = round2([...lines, ...out].reduce((a, l) => a + l.amountHT, 0))
  if (min && subtotal > 0 && subtotal < min.amount) {
    out.push(line({ code: 'MINIMUM', label: min.label, quantity: 1, unit: 'FLAT', unitPrice: round2(min.amount - subtotal), vatRate: min.vatRate ?? defaultVat, explanation: `Minimum de facturation ${fmtEur(min.amount)} HT (montant calculé ${fmtEur(subtotal)})` }))
  }
  return out
}
