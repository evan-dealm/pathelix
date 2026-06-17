import { describe, it, expect } from 'vitest'
import {
  estimateTollCost,
  estimateFuelCost,
  estimateWearCost,
  computeRouteCostBreakdown,
  TOLL_VAT_RATE,
  TOLL_NETWORKS,
  TELEPAY_DISCOUNTS,
} from '../tollDatabase'

describe('estimateTollCost', () => {
  it('returns 0 for zero distance', () => {
    expect(estimateTollCost(0)).toBe(0)
  })

  it('returns 0 for negative distance', () => {
    expect(estimateTollCost(-10)).toBe(0)
  })

  it('computes cost for class 3 by default', () => {
    const cost = estimateTollCost(100)
    expect(cost).toBeGreaterThan(0)
    // 100km * 0.40 toll ratio * 0.21 default rate * 1.0 multiplier
    expect(cost).toBeCloseTo(100 * 0.40 * 0.21, 1)
  })

  it('class 2 costs less than class 3', () => {
    const c2 = estimateTollCost(100, 2)
    const c3 = estimateTollCost(100, 3)
    expect(c2).toBeLessThan(c3)
  })

  it('class 4 costs more than class 3', () => {
    const c4 = estimateTollCost(100, 4)
    const c3 = estimateTollCost(100, 3)
    expect(c4).toBeGreaterThan(c3)
  })

  it('applies telepay discount', () => {
    const withDiscount = estimateTollCost(100, 3, 'tis_pl')
    const withoutDiscount = estimateTollCost(100, 3, '')
    expect(withDiscount).toBeLessThan(withoutDiscount)
    expect(withDiscount).toBeCloseTo(withoutDiscount * (1 - TELEPAY_DISCOUNTS['tis_pl']), 2)
  })

  it('uses network-specific rate for known highways', () => {
    // APRR A6: 0.21/km, ESCOTA A500: 0.24/km — different rates (exact match)
    const aprr = estimateTollCost(100, 3, '', 'A6')
    const escota = estimateTollCost(100, 3, '', 'A500')
    expect(escota).toBeGreaterThan(aprr) // 0.24 > 0.21
    // ATMB A401 has rate 0.28/km
    const atmb = estimateTollCost(100, 3, '', 'A401')
    expect(atmb).toBeGreaterThan(aprr) // 0.28 > 0.21
  })

  it('exact match: A500 does not match A5 prefix', () => {
    // Before fix, 'A500' would startsWith('A5') and return APRR (0.21)
    // After fix, 'A500' only matches ESCOTA (0.24)
    const escota = estimateTollCost(100, 3, '', 'A500')
    const aprr = estimateTollCost(100, 3, '', 'A5')
    expect(escota).not.toEqual(aprr) // different networks, different rates
  })

  it('uses highest rate for ATMB (A40 tunnel)', () => {
    const atmb = estimateTollCost(100, 3, '', 'A40')
    const sftrf = estimateTollCost(100, 3, '', 'A43')
    // SFTRF (0.30) > ATMB (0.28)
    expect(sftrf).toBeGreaterThan(atmb)
  })

  it('rounds to 2 decimal places', () => {
    const cost = estimateTollCost(37)
    expect(cost).toBe(Math.round(cost * 100) / 100)
  })

  it('unknown badge treated as no discount', () => {
    const noDiscount = estimateTollCost(100, 3, '')
    const unknownBadge = estimateTollCost(100, 3, 'unknown_badge_xyz')
    expect(unknownBadge).toBe(noDiscount)
  })
})

describe('estimateFuelCost', () => {
  it('returns 0 for zero distance', () => {
    expect(estimateFuelCost(0, 30, 1.8)).toBe(0)
  })

  it('returns 0 for negative distance', () => {
    expect(estimateFuelCost(-5, 30, 1.8)).toBe(0)
  })

  it('computes correct fuel cost', () => {
    // 100km * (30/100) L/km * 1.80 €/L = 54€
    expect(estimateFuelCost(100, 30, 1.8)).toBe(54)
  })

  it('rounds to 2 decimal places', () => {
    const cost = estimateFuelCost(37, 28, 1.79)
    expect(cost).toBe(Math.round(cost * 100) / 100)
  })
})

describe('estimateWearCost', () => {
  it('returns 0 for zero distance', () => {
    expect(estimateWearCost(0, 0.15)).toBe(0)
  })

  it('returns 0 for negative distance', () => {
    expect(estimateWearCost(-10, 0.15)).toBe(0)
  })

  it('computes correct wear cost', () => {
    // 100km * 0.15 €/km = 15€
    expect(estimateWearCost(100, 0.15)).toBe(15)
  })

  it('rounds to 2 decimal places', () => {
    const cost = estimateWearCost(37, 0.13)
    expect(cost).toBe(Math.round(cost * 100) / 100)
  })
})

describe('computeRouteCostBreakdown', () => {
  it('computes all components', () => {
    const result = computeRouteCostBreakdown({
      distanceKm: 100,
      consumptionLPer100: 30,
      fuelCostPerLiter: 1.8,
      costPerKm: 0.10,
    })
    expect(result.distanceKm).toBe(100)
    expect(result.fuelCost).toBeGreaterThan(0)
    expect(result.tollCost).toBeGreaterThan(0)
    expect(result.wearCost).toBeGreaterThan(0)
    expect(result.totalTTC).toBeCloseTo(result.fuelCost + result.tollCost + result.wearCost, 2)
  })

  it('totalHT < totalTTC', () => {
    const result = computeRouteCostBreakdown({
      distanceKm: 100,
      consumptionLPer100: 30,
      fuelCostPerLiter: 1.8,
      costPerKm: 0.10,
    })
    expect(result.totalHT).toBeLessThan(result.totalTTC)
    expect(result.totalHT).toBeCloseTo(result.totalTTC / (1 + TOLL_VAT_RATE), 2)
  })

  it('accepts tollClass and telepayBadge', () => {
    const c3 = computeRouteCostBreakdown({
      distanceKm: 100,
      consumptionLPer100: 30,
      fuelCostPerLiter: 1.8,
      costPerKm: 0.10,
      tollClass: 3,
      telepayBadge: '',
    })
    const c4badge = computeRouteCostBreakdown({
      distanceKm: 100,
      consumptionLPer100: 30,
      fuelCostPerLiter: 1.8,
      costPerKm: 0.10,
      tollClass: 4,
      telepayBadge: 'tis_pl',
    })
    // Different params → different costs
    expect(c3.tollCost).not.toBe(c4badge.tollCost)
  })

  it('returns 0 components for zero distance', () => {
    const result = computeRouteCostBreakdown({
      distanceKm: 0,
      consumptionLPer100: 30,
      fuelCostPerLiter: 1.8,
      costPerKm: 0.10,
    })
    expect(result.fuelCost).toBe(0)
    expect(result.tollCost).toBe(0)
    expect(result.wearCost).toBe(0)
    expect(result.totalTTC).toBe(0)
  })
})

describe('TOLL_NETWORKS data integrity', () => {
  it('all networks have ratePerKmClass3 between 0.10 and 0.50', () => {
    for (const n of TOLL_NETWORKS) {
      expect(n.ratePerKmClass3).toBeGreaterThan(0.10)
      expect(n.ratePerKmClass3).toBeLessThan(0.50)
    }
  })

  it('all networks have class multipliers for 2, 3, and 4', () => {
    for (const n of TOLL_NETWORKS) {
      expect(n.classMultiplier[2]).toBeDefined()
      expect(n.classMultiplier[3]).toBe(1.0)
      expect(n.classMultiplier[4]).toBeDefined()
    }
  })

  it('class 2 multiplier is always less than 1', () => {
    for (const n of TOLL_NETWORKS) {
      expect(n.classMultiplier[2]).toBeLessThan(1.0)
    }
  })

  it('class 4 multiplier is always greater than 1', () => {
    for (const n of TOLL_NETWORKS) {
      expect(n.classMultiplier[4]).toBeGreaterThan(1.0)
    }
  })
})

describe('TELEPAY_DISCOUNTS', () => {
  it('empty badge has 0 discount', () => {
    expect(TELEPAY_DISCOUNTS['']).toBe(0)
  })

  it('tis_pl has highest discount', () => {
    const discounts = Object.values(TELEPAY_DISCOUNTS).filter(d => d > 0)
    expect(TELEPAY_DISCOUNTS['tis_pl']).toBe(Math.max(...discounts))
  })

  it('all discounts are between 0 and 1', () => {
    for (const d of Object.values(TELEPAY_DISCOUNTS)) {
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThan(1)
    }
  })
})
