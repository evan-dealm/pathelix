import { describe, it, expect } from 'vitest'
import { priceItems, computeTotals, type PriceRuleData } from '../engine'

let n = 0
const rule = (over: Partial<PriceRuleData>): PriceRuleData => ({
  id: `r${n++}`, code: 'POSE', label: 'Pose', unit: 'UNIT', amount: 0, vatRate: 20, conditions: {}, priority: 0,
  priceListName: 'Tarifs 2026', customerGrid: false, ...over,
})

const GRID: PriceRuleData[] = [
  rule({ code: 'POSE', label: 'Pose benne', amount: 80 }),
  rule({ code: 'POSE', label: 'Pose benne 30 m³', amount: 110, conditions: { containerTypeId: 't30' } }),
  rule({ code: 'RETRAIT', label: 'Retrait', amount: 90 }),
  rule({ code: 'TRANSPORT', label: 'Transport', amount: 45 }),
  rule({ code: 'ZONE', label: 'Zone Isère', amount: 30, conditions: { zipPrefix: '38' } }),
  rule({ code: 'RENTAL_DAY', label: 'Location 15 m³', unit: 'DAY', amount: 3, conditions: { containerTypeId: 't15', freeDays: 7 } }),
  rule({ code: 'TREATMENT_TON', label: 'Traitement gravats', unit: 'TON', amount: 22, conditions: { materialId: 'gravats' } }),
  rule({ code: 'FUEL_PCT', label: 'Surcharge carburant', unit: 'PCT', amount: 10 }),
]

describe('pricing engine', () => {
  it('prices a pose with transport, and explains each price', () => {
    const r = priceItems([{ kind: 'OPERATION', missionType: 'POSER', containerTypeId: 't15' }], GRID)
    expect(r.lines.map(l => [l.code, l.amountHT])).toEqual([['POSE', 80], ['TRANSPORT', 45], ['FUEL_PCT', 12.5]])
    expect(r.lines[0].explanation).toContain('Tarifs 2026')
    expect(r.totals).toMatchObject({ totalHT: 137.5, totalVAT: 27.5, totalTTC: 165 })
  })

  it('the most specific rule wins (bin type), and a zone replaces the per-trip transport', () => {
    const r = priceItems([{ kind: 'OPERATION', missionType: 'POSER', containerTypeId: 't30', zip: '38100' }], GRID)
    expect(r.lines.slice(0, 2).map(l => [l.code, l.unitPrice])).toEqual([['POSE', 110], ['ZONE', 30]])
  })

  it('a customer grid beats the default grid', () => {
    const custom = [...GRID, rule({ code: 'POSE', label: 'Pose négociée', amount: 60, customerGrid: true, priceListName: 'Client BTP' })]
    const r = priceItems([{ kind: 'OPERATION', missionType: 'POSER', containerTypeId: 't30' }], custom)
    expect(r.lines[0]).toMatchObject({ unitPrice: 60, label: 'Pose négociée' })
    expect(r.lines[0].explanation).toContain('Client BTP')
  })

  it('rental: free days are not charged', () => {
    const r = priceItems([{ kind: 'RENTAL', containerTypeId: 't15', days: 20 }], GRID)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatchObject({ quantity: 13, unitPrice: 3, amountHT: 39 })
    expect(r.lines[0].explanation).toContain('7 j de franchise')
    expect(priceItems([{ kind: 'RENTAL', containerTypeId: 't15', days: 5 }], GRID).lines).toHaveLength(0)
  })

  it('treatment per tonne from the weighing', () => {
    const r = priceItems([{ kind: 'TREATMENT', materialId: 'gravats', tons: 7.84 }], GRID)
    expect(r.lines[0]).toMatchObject({ quantity: 7.84, amountHT: 172.48 })
  })

  it('never bills 0 € silently: unpriced items are flagged', () => {
    const r = priceItems([{ kind: 'OPERATION', missionType: 'TASSER' }], [])
    expect(r.lines[0].code).toBe('UNPRICED')
    expect(r.warnings[0]).toMatch(/Aucun tarif/)
  })

  it('urgency, week-end, customer discount and minimum invoice', () => {
    const grid = [
      rule({ code: 'RETRAIT', label: 'Retrait', amount: 100 }),
      rule({ code: 'URGENCY_PCT', label: 'Urgence', unit: 'PCT', amount: 20 }),
      rule({ code: 'WEEKEND_PCT', label: 'Week-end', unit: 'PCT', amount: 50 }),
      rule({ code: 'DISCOUNT_PCT', label: 'Remise', unit: 'PCT', amount: 10, customerGrid: true }),
      rule({ code: 'MINIMUM', label: 'Minimum', unit: 'FLAT', amount: 250 }),
    ]
    // Saturday 2026-10-03, urgent: 100 + 20 + 50 = 170, -10 % = 153, minimum 250 → +97.
    const r = priceItems([{ kind: 'OPERATION', missionType: 'RETIRER' }], grid, { urgent: true, date: '2026-10-03' })
    expect(r.lines.map(l => [l.code, l.amountHT])).toEqual([['RETRAIT', 100], ['URGENCY_PCT', 20], ['WEEKEND_PCT', 50], ['DISCOUNT_PCT', -17], ['MINIMUM', 97]])
    expect(r.totals.totalHT).toBe(250)
  })

  it('totals group VAT by rate', () => {
    const t = computeTotals([{ amountHT: 100, vatRate: 20 }, { amountHT: 50, vatRate: 10 }, { amountHT: 0.1, vatRate: 20 }])
    expect(t.vatByRate).toEqual([{ rate: 10, base: 50, vat: 5 }, { rate: 20, base: 100.1, vat: 20.02 }])
    expect(t.totalTTC).toBe(175.12)
  })
})
