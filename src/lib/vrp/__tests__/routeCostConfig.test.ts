import { describe, it, expect } from 'vitest'
import { createVrpCostConfig } from '@/lib/vrp/routeCost'
import type { VrpCostConfig } from '@/lib/vrp/routeCost'

const DEFAULTS: VrpCostConfig = {
  overtimePenalty:       30_000,
  overtimePerMin:        300,
  closedExutoirePenalty: 800,
  distanceCostFactor:    1.5,
  nearmaxStartMin:       540,
  nearmaxPerMin:         20,
  balancePenaltyWeight:  0.8,
  fixedRouteCost:        50,
  lunchBreakStartMin:    720,
  lunchBreakEndMin:      810,
  lunchBreakDurationMin: 30,
  lunchBreakPenalty:     80,
}

describe('createVrpCostConfig — no args returns all 12 defaults', () => {
  it('returns an object with all 12 keys', () => {
    const cfg = createVrpCostConfig()
    expect(Object.keys(cfg)).toHaveLength(12)
  })

  it('overtimePenalty default is 30000', () => {
    expect(createVrpCostConfig().overtimePenalty).toBe(30_000)
  })

  it('overtimePerMin default is 300', () => {
    expect(createVrpCostConfig().overtimePerMin).toBe(300)
  })

  it('closedExutoirePenalty default is 800', () => {
    expect(createVrpCostConfig().closedExutoirePenalty).toBe(800)
  })

  it('distanceCostFactor default is 1.5', () => {
    expect(createVrpCostConfig().distanceCostFactor).toBe(1.5)
  })

  it('nearmaxStartMin default is 540', () => {
    expect(createVrpCostConfig().nearmaxStartMin).toBe(540)
  })

  it('nearmaxPerMin default is 20', () => {
    expect(createVrpCostConfig().nearmaxPerMin).toBe(20)
  })

  it('balancePenaltyWeight default is 0.8', () => {
    expect(createVrpCostConfig().balancePenaltyWeight).toBe(0.8)
  })

  it('fixedRouteCost default is 50', () => {
    expect(createVrpCostConfig().fixedRouteCost).toBe(50)
  })

  it('lunchBreakStartMin default is 720', () => {
    expect(createVrpCostConfig().lunchBreakStartMin).toBe(720)
  })

  it('lunchBreakEndMin default is 810', () => {
    expect(createVrpCostConfig().lunchBreakEndMin).toBe(810)
  })

  it('lunchBreakDurationMin default is 30', () => {
    expect(createVrpCostConfig().lunchBreakDurationMin).toBe(30)
  })

  it('lunchBreakPenalty default is 80', () => {
    expect(createVrpCostConfig().lunchBreakPenalty).toBe(80)
  })

  it('lunchBreakStartMin (720) < lunchBreakEndMin (810) in defaults', () => {
    const cfg = createVrpCostConfig()
    expect(cfg.lunchBreakStartMin).toBeLessThan(cfg.lunchBreakEndMin)
  })
})

describe('createVrpCostConfig({}) returns all defaults', () => {
  it('empty object arg produces same values as no-arg call', () => {
    const noArgs = createVrpCostConfig()
    const emptyObj = createVrpCostConfig({})
    expect(emptyObj).toEqual(noArgs)
  })

  it('overtimePenalty is 30000 when passed {}', () => {
    expect(createVrpCostConfig({}).overtimePenalty).toBe(30_000)
  })

  it('distanceCostFactor is 1.5 when passed {}', () => {
    expect(createVrpCostConfig({}).distanceCostFactor).toBe(1.5)
  })

  it('fixedRouteCost is 50 when passed {}', () => {
    expect(createVrpCostConfig({}).fixedRouteCost).toBe(50)
  })
})

describe('createVrpCostConfig — single field override keeps others at default', () => {
  it('overriding overtimePenalty keeps overtimePerMin at 300', () => {
    const cfg = createVrpCostConfig({ overtimePenalty: 99_999 })
    expect(cfg.overtimePenalty).toBe(99_999)
    expect(cfg.overtimePerMin).toBe(300)
  })

  it('overriding overtimePerMin keeps closedExutoirePenalty at 800', () => {
    const cfg = createVrpCostConfig({ overtimePerMin: 500 })
    expect(cfg.overtimePerMin).toBe(500)
    expect(cfg.closedExutoirePenalty).toBe(800)
  })

  it('overriding distanceCostFactor keeps fixedRouteCost at 50', () => {
    const cfg = createVrpCostConfig({ distanceCostFactor: 2.0 })
    expect(cfg.distanceCostFactor).toBe(2.0)
    expect(cfg.fixedRouteCost).toBe(50)
  })

  it('overriding lunchBreakPenalty keeps lunchBreakStartMin at 720', () => {
    const cfg = createVrpCostConfig({ lunchBreakPenalty: 200 })
    expect(cfg.lunchBreakPenalty).toBe(200)
    expect(cfg.lunchBreakStartMin).toBe(720)
  })

  it('overriding balancePenaltyWeight keeps nearmaxStartMin at 540', () => {
    const cfg = createVrpCostConfig({ balancePenaltyWeight: 1.5 })
    expect(cfg.balancePenaltyWeight).toBe(1.5)
    expect(cfg.nearmaxStartMin).toBe(540)
  })
})

describe('createVrpCostConfig — overriding with 0 uses 0, not default', () => {
  it('overtimePenalty = 0 is respected (not replaced by default)', () => {
    const cfg = createVrpCostConfig({ overtimePenalty: 0 })
    expect(cfg.overtimePenalty).toBe(0)
  })

  it('fixedRouteCost = 0 is respected', () => {
    const cfg = createVrpCostConfig({ fixedRouteCost: 0 })
    expect(cfg.fixedRouteCost).toBe(0)
  })

  it('lunchBreakPenalty = 0 is respected', () => {
    const cfg = createVrpCostConfig({ lunchBreakPenalty: 0 })
    expect(cfg.lunchBreakPenalty).toBe(0)
  })

  it('closedExutoirePenalty = 0 is respected', () => {
    const cfg = createVrpCostConfig({ closedExutoirePenalty: 0 })
    expect(cfg.closedExutoirePenalty).toBe(0)
  })
})

describe('createVrpCostConfig — specific overtimePenalty overrides', () => {
  it('overtimePenalty = 99999', () => {
    expect(createVrpCostConfig({ overtimePenalty: 99_999 }).overtimePenalty).toBe(99_999)
  })

  it('overtimePenalty = 1', () => {
    expect(createVrpCostConfig({ overtimePenalty: 1 }).overtimePenalty).toBe(1)
  })

  it('overtimePenalty = 0 is stored as 0', () => {
    expect(createVrpCostConfig({ overtimePenalty: 0 }).overtimePenalty).toBe(0)
  })
})

describe('createVrpCostConfig — lunchBreakStartMin / lunchBreakEndMin overrides', () => {
  it('overrides lunchBreakStartMin to custom value', () => {
    const cfg = createVrpCostConfig({ lunchBreakStartMin: 660 })
    expect(cfg.lunchBreakStartMin).toBe(660)
    expect(cfg.lunchBreakEndMin).toBe(810)
  })

  it('overrides lunchBreakEndMin to custom value', () => {
    const cfg = createVrpCostConfig({ lunchBreakEndMin: 780 })
    expect(cfg.lunchBreakEndMin).toBe(780)
    expect(cfg.lunchBreakStartMin).toBe(720)
  })

  it('overrides both lunchBreak bounds simultaneously', () => {
    const cfg = createVrpCostConfig({ lunchBreakStartMin: 700, lunchBreakEndMin: 800 })
    expect(cfg.lunchBreakStartMin).toBe(700)
    expect(cfg.lunchBreakEndMin).toBe(800)
  })
})

describe('createVrpCostConfig — override all 12 fields at once', () => {
  const fullOverride: VrpCostConfig = {
    overtimePenalty:       1,
    overtimePerMin:        2,
    closedExutoirePenalty: 3,
    distanceCostFactor:    4,
    nearmaxStartMin:       5,
    nearmaxPerMin:         6,
    balancePenaltyWeight:  7,
    fixedRouteCost:        8,
    lunchBreakStartMin:    9,
    lunchBreakEndMin:      10,
    lunchBreakDurationMin: 11,
    lunchBreakPenalty:     12,
  }

  it('returns exact values when all 12 fields are overridden', () => {
    const cfg = createVrpCostConfig(fullOverride)
    expect(cfg).toEqual(fullOverride)
  })

  it('overtimePenalty is 1 in full override', () => {
    expect(createVrpCostConfig(fullOverride).overtimePenalty).toBe(1)
  })

  it('lunchBreakPenalty is 12 in full override', () => {
    expect(createVrpCostConfig(fullOverride).lunchBreakPenalty).toBe(12)
  })
})

describe('createVrpCostConfig — return type and independence', () => {
  it('returns a plain object (not a class instance)', () => {
    const cfg = createVrpCostConfig()
    expect(Object.getPrototypeOf(cfg)).toBe(Object.prototype)
  })

  it('mutating returned object does NOT affect the next call', () => {
    const cfg1 = createVrpCostConfig()
    cfg1.overtimePenalty = 999
    const cfg2 = createVrpCostConfig()
    expect(cfg2.overtimePenalty).toBe(30_000)
  })

  it('two calls with no args return equal but distinct objects', () => {
    const a = createVrpCostConfig()
    const b = createVrpCostConfig()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('two calls with {} return equal but distinct objects', () => {
    const a = createVrpCostConfig({})
    const b = createVrpCostConfig({})
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('returned object is not the same reference as any internal default', () => {
    const cfg1 = createVrpCostConfig()
    const cfg2 = createVrpCostConfig()
    cfg1.distanceCostFactor = 99
    expect(cfg2.distanceCostFactor).toBe(1.5)
  })

  it('has all required keys present in returned object', () => {
    const cfg = createVrpCostConfig()
    const requiredKeys: (keyof VrpCostConfig)[] = [
      'overtimePenalty', 'overtimePerMin', 'closedExutoirePenalty',
      'distanceCostFactor', 'nearmaxStartMin', 'nearmaxPerMin',
      'balancePenaltyWeight', 'fixedRouteCost', 'lunchBreakStartMin',
      'lunchBreakEndMin', 'lunchBreakDurationMin', 'lunchBreakPenalty',
    ]
    for (const key of requiredKeys) {
      expect(cfg).toHaveProperty(key)
    }
  })
})

describe('createVrpCostConfig — default value coherence', () => {
  it('nearmaxStartMin (540) corresponds to 09:00', () => {
    expect(createVrpCostConfig().nearmaxStartMin).toBe(540)
  })

  it('lunchBreakStartMin (720) corresponds to 12:00', () => {
    expect(createVrpCostConfig().lunchBreakStartMin).toBe(720)
  })

  it('lunchBreakEndMin (810) corresponds to 13:30', () => {
    expect(createVrpCostConfig().lunchBreakEndMin).toBe(810)
  })

  it('balancePenaltyWeight is between 0 and 1 by default', () => {
    const weight = createVrpCostConfig().balancePenaltyWeight
    expect(weight).toBeGreaterThan(0)
    expect(weight).toBeLessThanOrEqual(1)
  })

  it('distanceCostFactor > 1 (roads are longer than crow-fly)', () => {
    expect(createVrpCostConfig().distanceCostFactor).toBeGreaterThan(1)
  })

  it('overtimePenalty > overtimePerMin (lump sum > per-minute cost)', () => {
    const cfg = createVrpCostConfig()
    expect(cfg.overtimePenalty).toBeGreaterThan(cfg.overtimePerMin)
  })

  it('all numeric values are finite numbers', () => {
    const cfg = createVrpCostConfig()
    for (const [, value] of Object.entries(cfg)) {
      expect(typeof value).toBe('number')
      expect(isFinite(value)).toBe(true)
    }
  })
})
