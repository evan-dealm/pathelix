import { describe, it, expect } from 'vitest'
import { canSetManually, effectsOnDone, effectsOnDeparture, syntheticStepKind, daysOnSite, isAtCustomer } from '../lifecycle'
import { validateScan, parseScannedCode, defaultScanRole, type ScanMission, type ScannedContainer } from '../scan'
import { nextNumbers, newQrToken } from '../numbers'

const mission = (over: Partial<ScanMission> = {}): ScanMission => ({ id: 'm1', type: 'POSER', siteId: 's1', clientId: 'c1', ...over })
const bin = (over: Partial<ScannedContainer> = {}): ScannedContainer => ({ id: 'b1', number: 'B-00001', typeId: 't15', capacityM3: 15, status: 'AVAILABLE', ...over })

describe('container lifecycle', () => {
  it('a pose puts the bin at the customer, a pickup on the truck', () => {
    const base = { id: 'm1', latitude: 45, longitude: 5, clientId: 'c1', siteId: 's1' }
    expect(effectsOnDone({ ...base, type: 'POSER', placedContainerId: 'b1' }, 'd1')).toMatchObject([{ containerId: 'b1', to: 'AT_CUSTOMER', event: 'PLACED', patch: { clientId: 'c1', siteId: 's1' } }])
    expect(effectsOnDone({ ...base, type: 'RETIRER', collectedContainerId: 'b2' }, 'd1')).toMatchObject([{ containerId: 'b2', to: 'IN_TRANSIT', patch: { driverId: 'd1', siteId: null } }])
    const swap = effectsOnDone({ ...base, type: 'ECHANGER', placedContainerId: 'b1', collectedContainerId: 'b2' }, 'd1')
    expect(swap.map(e => [e.containerId, e.to])).toEqual([['b2', 'IN_TRANSIT'], ['b1', 'AT_CUSTOMER']])
  })

  it('leaving with the bin to put down loads it on the truck', () => {
    expect(effectsOnDeparture({ id: 'm1', type: 'POSER', placedContainerId: 'b1', latitude: 0, longitude: 0 }, 'd1')).toMatchObject([{ to: 'IN_TRANSIT', event: 'LOADED' }])
    expect(effectsOnDeparture({ id: 'm1', type: 'RETIRER', collectedContainerId: 'b1', latitude: 0, longitude: 0 }, 'd1')).toEqual([])
  })

  it('a mission without a bin moves nothing', () => {
    expect(effectsOnDone({ id: 'm1', type: 'POSER', latitude: 0, longitude: 0 }, 'd1')).toEqual([])
  })

  it('manual changes follow the allowed transitions only', () => {
    expect(canSetManually('AVAILABLE', 'MAINTENANCE')).toBe(true)
    expect(canSetManually('AT_CUSTOMER', 'TO_COLLECT')).toBe(true)
    expect(canSetManually('AVAILABLE', 'AT_CUSTOMER')).toBe(false) // a pose, not a click
    expect(canSetManually('AT_CUSTOMER', 'ARCHIVED')).toBe(false)  // never archive a bin at a customer's
  })

  it('recognises the synthetic plan steps', () => {
    expect(syntheticStepKind('_vider_ex1_m1').kind).toBe('DUMP')
    expect(syntheticStepKind('_vider_pre_ex1_m1').kind).toBe('DUMP')
    expect(syntheticStepKind('_vider_ar_ex1_m9')).toEqual({ kind: 'DUMP', missionId: 'm9' })
    expect(syntheticStepKind('_pose_ar_m9')).toEqual({ kind: 'REPOSE', missionId: 'm9' })
    expect(syntheticStepKind('_pause_d1_3').kind).toBe('BREAK')
    expect(syntheticStepKind('cm123').kind).toBeNull()
  })

  it('days on site', () => {
    expect(daysOnSite('2026-10-01T08:00:00Z', new Date('2026-10-31T09:00:00Z'))).toBe(30)
    expect(daysOnSite(null)).toBeNull()
    expect(isAtCustomer('FULL')).toBe(true)
    expect(isAtCustomer('IN_TRANSIT')).toBe(false)
  })
})

describe('scan validation', () => {
  it('accepts the right bin for a pose', () => {
    expect(validateScan(mission({ binSizeM3: 15 }), bin(), 'place', 'd1')).toEqual({ ok: true })
  })
  it('refuses the wrong size, the wrong type, a bin promised elsewhere, a bin out of service', () => {
    expect(validateScan(mission({ binSizeM3: 30 }), bin(), 'place', 'd1')).toMatchObject({ ok: false, code: 'WRONG_SIZE' })
    expect(validateScan(mission({ containerTypeId: 't30' }), bin(), 'place', 'd1')).toMatchObject({ ok: false, code: 'WRONG_TYPE' })
    expect(validateScan(mission(), bin({ status: 'RESERVED', missionId: 'other' }), 'place', 'd1')).toMatchObject({ ok: false, code: 'RESERVED_ELSEWHERE' })
    expect(validateScan(mission(), bin({ status: 'MAINTENANCE' }), 'place', 'd1')).toMatchObject({ ok: false, code: 'OUT_OF_SERVICE' })
    expect(validateScan(mission({ placedContainerId: 'b9' }), bin(), 'place', 'd1')).toMatchObject({ ok: false, code: 'WRONG_CONTAINER' })
  })
  it('a pose from a bin at another customer is refused, from my own truck accepted', () => {
    expect(validateScan(mission(), bin({ status: 'AT_CUSTOMER', siteId: 's2' }), 'place', 'd1')).toMatchObject({ ok: false, code: 'NOT_AVAILABLE' })
    expect(validateScan(mission(), bin({ status: 'IN_TRANSIT', driverId: 'd1' }), 'place', 'd1')).toEqual({ ok: true })
    expect(validateScan(mission(), bin({ status: 'IN_TRANSIT', driverId: 'd2' }), 'place', 'd1')).toMatchObject({ ok: false })
  })
  it('a pickup refuses a bin recorded at another customer, accepts one with no recorded place', () => {
    const m = mission({ type: 'RETIRER' })
    expect(validateScan(m, bin({ status: 'AT_CUSTOMER', siteId: 's1' }), 'collect', 'd1')).toEqual({ ok: true })
    expect(validateScan(m, bin({ status: 'AT_CUSTOMER', siteId: 's2', clientId: 'c2' }), 'collect', 'd1')).toMatchObject({ ok: false, code: 'WRONG_SITE' })
    expect(validateScan(m, bin({ status: 'AVAILABLE' }), 'collect', 'd1')).toEqual({ ok: true })
    expect(validateScan(mission({ type: 'POSER' }), bin(), 'collect', 'd1')).toMatchObject({ ok: false, code: 'NOT_FOR_THIS_MISSION' })
  })
  it('default role from the mission type', () => {
    expect(defaultScanRole('POSER')).toBe('place')
    expect(defaultScanRole('RETIRER')).toBe('collect')
    expect(defaultScanRole('ECHANGER')).toBeNull()
  })
})

describe('codes and numbers', () => {
  it('reads our QR URL, a bare token, or a typed number', () => {
    const t = newQrToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(parseScannedCode(`https://app.example/c/${t}`)).toEqual({ token: t })
    expect(parseScannedCode(' b-00482 ')).toEqual({ number: 'B-00482' })
  })
  it('numbers a batch after the highest existing number', () => {
    expect(nextNumbers(['B-00007', 'B-00002', 'X-00099'], 'B-', 3)).toEqual(['B-00008', 'B-00009', 'B-00010'])
    expect(nextNumbers([], 'BEN', 2)).toEqual(['BEN00001', 'BEN00002'])
  })
})
