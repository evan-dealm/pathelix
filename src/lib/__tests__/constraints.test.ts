import { describe, it, expect } from 'vitest'
import {
  MAX_WORK_MIN,
  MAX_DRIVING_MIN,
  MAX_CONTINUOUS_MIN,
  BREAK_DURATION_MIN,
  MIN_DAILY_REST_MIN,
  MAX_WEEKLY_MIN,
  WARN_WORK_MIN,
  P1_DEADLINE_MIN,
  getP1DeadlineMin,
  penaltyForLate,
  penaltyForP1Late,
  computeDriverScore,
  computeDistributionScore,
} from '../constraints'

describe('Constantes réglementaires CE 561/2006', () => {
  it('durée max travail = 10h', () => {
    expect(MAX_WORK_MIN).toBe(600)
  })

  it('durée max conduite = 9h', () => {
    expect(MAX_DRIVING_MIN).toBe(540)
  })

  it('conduite continue max = 4h30', () => {
    expect(MAX_CONTINUOUS_MIN).toBe(270)
  })

  it('durée pause réglementaire = 45 min', () => {
    expect(BREAK_DURATION_MIN).toBe(45)
  })

  it('repos journalier min = 11h', () => {
    expect(MIN_DAILY_REST_MIN).toBe(660)
  })

  it('max hebdomadaire = 48h', () => {
    expect(MAX_WEEKLY_MIN).toBe(2880)
  })

  it('seuil alerte préventif = 8h', () => {
    expect(WARN_WORK_MIN).toBe(480)
  })

  it('deadline P1 par défaut = 10h', () => {
    expect(P1_DEADLINE_MIN).toBe(600)
  })

  it('repos + travail = 24h (cohérence)', () => {

    expect(MIN_DAILY_REST_MIN + MAX_WORK_MIN).toBeLessThanOrEqual(24 * 60)
  })
})

describe('getP1DeadlineMin', () => {
  it('retourne la valeur tenant si fournie', () => {
    expect(getP1DeadlineMin(720)).toBe(720)
  })

  it('retourne le défaut si undefined', () => {
    expect(getP1DeadlineMin(undefined)).toBe(600)
  })

  it('retourne le défaut si non fourni', () => {
    expect(getP1DeadlineMin()).toBe(600)
  })

  it('accepte 0 comme valeur tenant', () => {
    expect(getP1DeadlineMin(0)).toBe(0)
  })
})

describe('penaltyForLate', () => {
  it('zéro pour retard négatif', () => {
    expect(penaltyForLate(-10)).toBe(0)
  })

  it('zéro pour retard nul', () => {
    expect(penaltyForLate(0)).toBe(0)
  })

  it('pénalité croissante', () => {
    expect(penaltyForLate(10)).toBeLessThan(penaltyForLate(20))
    expect(penaltyForLate(20)).toBeLessThan(penaltyForLate(30))
    expect(penaltyForLate(30)).toBeLessThan(penaltyForLate(60))
  })

  it('pénalité superlinéaire (quadratique)', () => {
    const p30 = penaltyForLate(30)
    const p60 = penaltyForLate(60)

    expect(p60).toBeGreaterThan(2 * p30 * 0.9)
  })

  it('f(15) ≈ 37.5', () => {
    expect(penaltyForLate(15)).toBeCloseTo(15 * 2 + 15 * 15 / 30, 1)
  })

  it('f(30) = 90', () => {
    expect(penaltyForLate(30)).toBeCloseTo(30 * 2 + 30 * 30 / 30, 1)
  })

  it('f(60) = 240', () => {
    expect(penaltyForLate(60)).toBeCloseTo(60 * 2 + 60 * 60 / 30, 1)
  })
})

describe('penaltyForP1Late', () => {
  it('zéro pour retard négatif', () => {
    expect(penaltyForP1Late(-5)).toBe(0)
  })

  it('zéro pour retard nul', () => {
    expect(penaltyForP1Late(0)).toBe(0)
  })

  it('plus sévère que penaltyForLate', () => {
    for (const delay of [10, 30, 60, 90]) {
      expect(penaltyForP1Late(delay)).toBeGreaterThan(penaltyForLate(delay))
    }
  })

  it('f(30) = 135', () => {
    expect(penaltyForP1Late(30)).toBeCloseTo(30 * 3 + 30 * 30 / 20, 1)
  })

  it('f(60) = 360', () => {
    expect(penaltyForP1Late(60)).toBeCloseTo(60 * 3 + 60 * 60 / 20, 1)
  })

  it('pénalité croissante strictement', () => {
    let prev = 0
    for (let i = 1; i <= 120; i += 5) {
      const p = penaltyForP1Late(i)
      expect(p).toBeGreaterThan(prev)
      prev = p
    }
  })
})

describe('computeDriverScore', () => {
  const base = {
    workMin: 480,
    drivingMin: 300,
    onSiteMin: 150,
    roadDistKm: 120,
    hasOvertime: false,
    hasBreachDriving: false,
    warnings: 0,
  }

  it('score total entre 0 et 100', () => {
    const s = computeDriverScore(base)
    expect(s.total).toBeGreaterThanOrEqual(0)
    expect(s.total).toBeLessThanOrEqual(100)
  })

  it('conformité 100 sans violations', () => {
    const s = computeDriverScore(base)
    expect(s.compliance).toBe(100)
    expect(s.violations).toHaveLength(0)
  })

  it('overtime réduit la conformité de 25', () => {
    const s = computeDriverScore({ ...base, hasOvertime: true })
    expect(s.compliance).toBe(75)
    expect(s.violations).toHaveLength(1)
    expect(s.violations[0].type).toBe('overtime')
  })

  it('breach driving réduit la conformité de 25', () => {
    const s = computeDriverScore({ ...base, hasBreachDriving: true })
    expect(s.compliance).toBe(75)
    expect(s.violations[0].type).toBe('driving_limit')
  })

  it('overtime + breach = 50 de réduction', () => {
    const s = computeDriverScore({ ...base, hasOvertime: true, hasBreachDriving: true })
    expect(s.compliance).toBe(50)
    expect(s.violations).toHaveLength(2)
  })

  it('warnings réduisent la conformité', () => {
    const s = computeDriverScore({ ...base, warnings: 2 })
    expect(s.compliance).toBe(80)
  })

  it('conformité ne descend pas sous 0', () => {
    const s = computeDriverScore({ ...base, hasOvertime: true, hasBreachDriving: true, warnings: 10 })
    expect(s.compliance).toBe(0)
  })

  it('efficacité plus haute avec plus de travail', () => {
    const s1 = computeDriverScore({ ...base, workMin: 200 })
    const s2 = computeDriverScore({ ...base, workMin: 500 })
    expect(s2.efficiency).toBeGreaterThan(s1.efficiency)
  })

  it('total = 60% efficacité + 40% conformité', () => {
    const s = computeDriverScore(base)
    expect(s.total).toBe(Math.round(s.efficiency * 0.6 + s.compliance * 0.4))
  })

  it('travail nul → efficacité basse', () => {
    const s = computeDriverScore({ ...base, workMin: 0, onSiteMin: 0, roadDistKm: 0 })
    expect(s.efficiency).toBeLessThanOrEqual(20)
  })
})

describe('computeDistributionScore', () => {
  it('retourne 0 pour tableau vide', () => {
    expect(computeDistributionScore([], [])).toBe(0)
  })

  it('score élevé si charge équilibrée', () => {
    const scores = [80, 80, 80]
    const workMins = [400, 400, 400]
    const result = computeDistributionScore(scores, workMins)
    expect(result).toBeGreaterThanOrEqual(70)
  })

  it('pénalise le déséquilibre de charge', () => {
    const scores = [80, 80, 80]
    const balanced = computeDistributionScore(scores, [400, 400, 400])
    const unbalanced = computeDistributionScore(scores, [600, 200, 100])
    expect(balanced).toBeGreaterThan(unbalanced)
  })

  it('score 0 si tous les workMin = 0', () => {
    const result = computeDistributionScore([50, 50], [0, 0])
    expect(result).toBe(Math.round(50))
  })

  it('score jamais négatif', () => {
    const result = computeDistributionScore([10, 10, 10], [600, 10, 10])
    expect(result).toBeGreaterThanOrEqual(0)
  })
})
