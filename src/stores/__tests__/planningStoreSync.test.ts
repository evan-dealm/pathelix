// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePlanningStore, _cleanupTimers } from '../planningStore'
import type { Driver, Mission } from '@/lib/types'

const DRIVER: Driver = { id: 'd-1', firstName: 'Jean', lastName: 'Dupont', sector: 'N', depotName: 'D', depotLat: 45.7, depotLng: 4.8 }
const M1: Mission = { id: 'm-1', type: 'POSER', date: '2026-03-18', address: 'a', latitude: 45.8, longitude: 4.9, estimatedDurationMin: 10, maneuverTimeMin: 5 }
const M2: Mission = { ...M1, id: 'm-2', address: 'b' }
const DATE = '2026-03-18'

const fetchMock = vi.fn()

function postedPlans(): Array<{ driverId: string; date: string; missions: Array<{ id: string }> }> {
  const last = fetchMock.mock.calls.filter(c => c[0] === '/api/plans').at(-1)
  if (!last) return []
  const body = JSON.parse((last[1] as RequestInit).body as string)
  return Array.isArray(body) ? body : [body]
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  usePlanningStore.getState().setInitialData([DRIVER], [M1, M2])
  usePlanningStore.setState({ plans: {}, syncStatus: 'idle', syncError: null })
})

afterEach(() => {
  _cleanupTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('tour persistence from the store (every change reaches the server)', () => {
  it('undo saves the restored tour — it used to stay local until the Tours tab happened to be open', async () => {
    const st = usePlanningStore.getState()
    st.assignToDriver('m-1', 'd-1', DATE)
    st.assignToDriver('m-2', 'd-1', DATE)
    await vi.advanceTimersByTimeAsync(600)
    fetchMock.mockClear()

    usePlanningStore.getState().undo()
    await vi.advanceTimersByTimeAsync(600)

    const saved = postedPlans().find(p => p.driverId === 'd-1')
    expect(saved?.missions.map(m => m.id)).toEqual(['m-1'])
  })

  it('archiving a planned mission saves the tour without it', async () => {
    usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
    await vi.advanceTimersByTimeAsync(600)
    fetchMock.mockClear()

    usePlanningStore.getState().archiveMission('m-1')
    await vi.advanceTimersByTimeAsync(600)

    expect(postedPlans().find(p => p.driverId === 'd-1')?.missions).toEqual([])
  })

  it('copying a day saves the target day', async () => {
    usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
    await vi.advanceTimersByTimeAsync(600)
    fetchMock.mockClear()

    usePlanningStore.getState().copyPlansToDate(DATE, '2026-03-19')
    await vi.advanceTimersByTimeAsync(600)

    expect(postedPlans().some(p => p.date === '2026-03-19' && p.missions.length === 1)).toBe(true)
  })

  it('exposes the server refusal as syncError', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Permission refusée' }), { status: 403 }))
    usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
    await vi.advanceTimersByTimeAsync(600)
    expect(usePlanningStore.getState().syncStatus).toBe('error')
    expect(usePlanningStore.getState().syncError).toBe('Permission refusée')
  })
})
