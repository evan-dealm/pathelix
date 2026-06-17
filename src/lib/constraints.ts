export const MAX_WORK_MIN         = 600

export const MAX_DRIVING_MIN      = 540

export const MAX_CONTINUOUS_MIN   = 270

export const BREAK_DURATION_MIN   = 45

export const MIN_DAILY_REST_MIN   = 660

export const MAX_WEEKLY_MIN       = 2880

export const WARN_WORK_MIN        = 480

export const P1_DEADLINE_MIN_DEFAULT = 600

export const P1_DEADLINE_MIN = P1_DEADLINE_MIN_DEFAULT

export function getP1DeadlineMin(tenantP1DeadlineMin?: number): number {
  return tenantP1DeadlineMin ?? P1_DEADLINE_MIN_DEFAULT
}

export const PENALTY_LINEAR_COEF     = 2

export const PENALTY_QUADRATIC_DIV   = 30

export const PENALTY_P1_LINEAR_COEF  = 3

export const PENALTY_P1_QUADRATIC_DIV = 20

export function penaltyForLate(lateMin: number): number {
  if (lateMin <= 0) return 0
  return lateMin * PENALTY_LINEAR_COEF + (lateMin * lateMin) / PENALTY_QUADRATIC_DIV
}

export function penaltyForP1Late(lateMin: number): number {
  if (lateMin <= 0) return 0
  return lateMin * PENALTY_P1_LINEAR_COEF + (lateMin * lateMin) / PENALTY_P1_QUADRATIC_DIV
}

export interface DriverScore {
  efficiency:    number
  compliance:    number
  total:         number
  violations:    Array<{ type: string; message: string }>
}

export function computeDriverScore(params: {
  workMin:      number
  drivingMin:   number
  onSiteMin:    number
  roadDistKm:   number
  hasOvertime:  boolean
  hasBreachDriving: boolean
  warnings:     number
}): DriverScore {
  const { workMin, drivingMin, onSiteMin, roadDistKm, hasOvertime, hasBreachDriving, warnings } = params

  const usageRatio   = Math.min(1, workMin / MAX_WORK_MIN)
  const onSiteRatio  = workMin > 0 ? Math.min(1, onSiteMin / workMin) : 0
  const distScore    = Math.min(1, roadDistKm / 200)
  const efficiency   = Math.round((usageRatio * 40 + onSiteRatio * 40 + distScore * 20))

  let compliance = 100
  const violations: Array<{ type: string; message: string }> = []
  if (hasOvertime) {
    compliance -= 25
    violations.push({ type: 'overtime', message: `Durée de travail dépasse ${MAX_WORK_MIN / 60}h` })
  }
  if (hasBreachDriving) {
    compliance -= 25
    violations.push({ type: 'driving_limit', message: `Durée de conduite dépasse ${MAX_DRIVING_MIN / 60}h` })
  }
  compliance -= warnings * 10
  compliance = Math.max(0, compliance)

  void drivingMin

  const total = Math.round(efficiency * 0.6 + compliance * 0.4)

  return { efficiency, compliance, total, violations }
}

export function computeDistributionScore(
  driverScores: number[],
  workMinByDriver: number[],
): number {
  if (driverScores.length === 0) return 0

  const avgScore = driverScores.reduce((a, b) => a + b, 0) / driverScores.length

  const mean = workMinByDriver.reduce((a, b) => a + b, 0) / workMinByDriver.length
  if (mean === 0) return Math.round(avgScore)
  const variance = workMinByDriver.reduce((s, v) => s + (v - mean) ** 2, 0) / workMinByDriver.length
  const cv = Math.sqrt(variance) / mean
  const balancePenalty = Math.min(20, cv * 40)

  return Math.max(0, Math.round(avgScore - balancePenalty))
}
