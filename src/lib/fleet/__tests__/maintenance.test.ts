import { describe, expect, it } from 'vitest'
import { planStatus, vehicleBlockers, type PlanLike } from '../maintenance'

const plan = (p: Partial<PlanLike>): PlanLike => ({
  kind: 'SERVICE', label: 'Vidange', everyKm: null, everyMonths: null, lastDoneAt: null, lastDoneKm: null,
  dueDate: null, warnDays: 30, warnKm: 1500, active: true, ...p,
})
const TRUCK = { licensePlate: 'AB-123-CD', mileageKm: 100_000, nextInspection: null, insuranceExpiry: null }

describe('planStatus', () => {
  it('computes the next date from the last intervention (month ends handled)', () => {
    const s = planStatus(plan({ everyMonths: 12, lastDoneAt: '2025-11-15' }), 0, '2026-10-06')
    expect(s).toMatchObject({ state: 'OK', nextDate: '2026-11-15', daysLeft: 40 })
    expect(planStatus(plan({ everyMonths: 1, lastDoneAt: '2026-01-31' }), 0, '2026-01-31').nextDate).toBe('2026-02-28')
  })

  it('is OK when far away, due soon inside the warning window, overdue after', () => {
    const p = plan({ everyMonths: 12, lastDoneAt: '2026-01-10' })
    expect(planStatus(p, 0, '2026-06-01').state).toBe('OK')
    expect(planStatus(p, 0, '2026-12-20').state).toBe('DUE_SOON')
    expect(planStatus(p, 0, '2027-01-11').state).toBe('OVERDUE')
  })

  it('also counts kilometres, whichever comes first', () => {
    const p = plan({ everyKm: 60_000, everyMonths: 12, lastDoneKm: 50_000, lastDoneAt: '2026-09-01' })
    expect(planStatus(p, 109_000, '2026-10-06')).toMatchObject({ state: 'DUE_SOON', nextKm: 110_000, kmLeft: 1000 })
    expect(planStatus(p, 111_000, '2026-10-06').state).toBe('OVERDUE')
    expect(planStatus(p, 111_000, '2026-10-06').message).toMatch(/dépassement de 1\s000 km/)
  })

  it('says when it cannot know', () => {
    expect(planStatus(plan({ everyMonths: 12 }), 0, '2026-10-06').state).toBe('UNKNOWN')
  })

  it('an explicit due date wins over the interval', () => {
    expect(planStatus(plan({ kind: 'INSURANCE', label: 'Assurance', dueDate: '2026-12-31', everyMonths: 1, lastDoneAt: '2026-01-01' }), 0, '2026-10-06').nextDate).toBe('2026-12-31')
  })
})

describe('vehicleBlockers', () => {
  const day = '2026-10-06'
  it('immobilises a truck whose CT, tachograph or insurance is overdue', () => {
    const ct = plan({ kind: 'CT', label: 'Contrôle technique', everyMonths: 12, lastDoneAt: '2025-09-30' })
    expect(vehicleBlockers(TRUCK, [ct], [], day)).toEqual(['Contrôle technique : échéance dépassée depuis le 30/09/2026'])
    expect(vehicleBlockers({ ...TRUCK, insuranceExpiry: '2026-10-05' }, [], [], day)).toEqual(['assurance expirée le 05/10/2026'])
    expect(vehicleBlockers({ ...TRUCK, insuranceExpiry: '2026-10-06' }, [], [], day)).toEqual([]) // valid through that day
  })

  it('does not immobilise for an overdue service: it only warns', () => {
    const svc = plan({ everyKm: 60_000, lastDoneKm: 30_000 })
    expect(planStatus(svc, TRUCK.mileageKm, day).state).toBe('OVERDUE')
    expect(vehicleBlockers(TRUCK, [svc], [], day)).toEqual([])
  })

  it('immobilises while a critical defect is open or in repair, not once fixed', () => {
    const d = { severity: 'CRITICAL', status: 'OPEN', description: 'Fuite hydraulique bras' }
    expect(vehicleBlockers(TRUCK, [], [d], day)).toEqual(['défaut bloquant : Fuite hydraulique bras'])
    expect(vehicleBlockers(TRUCK, [], [{ ...d, status: 'IN_REPAIR' }], day)).toHaveLength(1)
    expect(vehicleBlockers(TRUCK, [], [{ ...d, status: 'FIXED' }], day)).toEqual([])
    expect(vehicleBlockers(TRUCK, [], [{ ...d, severity: 'MAJOR' }], day)).toEqual([])
  })
})
