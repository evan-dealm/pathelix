// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'driver-1' }),
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@/lib/syncQueue', () => ({
  enqueueAction:     vi.fn().mockResolvedValue(undefined),
  getSyncQueueSize:  vi.fn().mockResolvedValue(0),
  flushSyncQueue:    vi.fn().mockResolvedValue(0),
  cacheDayPlan:      vi.fn().mockResolvedValue(undefined),
  getCachedDayPlan:  vi.fn().mockResolvedValue(null),
  getQueuedActions:  vi.fn().mockResolvedValue([]),
}))

import DriverPage from '../page'

const DRIVER = {
  id: 'driver-1', firstName: 'Jean', lastName: 'Dupont', sector: 'A',
  depotName: 'Depot', depotLat: 45.0, depotLng: 5.0,
}

const MISSION_VIDER = {
  id: 'mission-1', type: 'VIDER', date: '2026-08-12',
  clientName: 'Site A', address: '1 rue A', latitude: 45.1, longitude: 5.1,
  estimatedDurationMin: 10, maneuverTimeMin: 5, sequenceOrder: 0,
}

const MISSION_POSER = {
  id: 'mission-2', type: 'POSER', date: '2026-08-12',
  clientName: 'Site B', address: '2 rue B', latitude: 45.2, longitude: 5.2,
  estimatedDurationMin: 10, maneuverTimeMin: 5, sequenceOrder: 1,
}

function mockDriverPlanFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/driver-plan/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          driver: DRIVER,
          plan: [MISSION_VIDER, MISSION_POSER],
          startTime: '07:00',
          speedKmh: 50,
          date: '2026-08-12',
        }),
      })
    }
    if (typeof url === 'string' && url.startsWith('/api/driver-photos')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_AI_ENGINE_URL', 'http://ai-engine')
  vi.stubGlobal('fetch', mockDriverPlanFetch())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// Regression for C1: ScanTicketButton was gated on `currentMission`'s own status, but
// `currentMission` is derived as the first non-done mission — so the instant a mission
// reaches 'done', currentMission already points at the NEXT mission and the two conditions
// (currentMission === X, statuses[X] === 'done') can never both hold. The scan UI was
// structurally unreachable for any VIDER mission.
describe('driver page — scan ticket reachability after completing a VIDER mission', () => {
  it('shows the ticket-scan interstitial for the just-completed VIDER mission instead of jumping straight to the next mission', async () => {
    render(<DriverPage />)

    await waitFor(() => expect(screen.getByText('Site A')).toBeTruthy())

    // Drive mission-1 (VIDER) through the full status flow: todo -> en_route -> arrived -> started -> doing -> done
    for (let i = 0; i < 5; i++) {
      const advanceBtn = document.querySelector('button[aria-label]') as HTMLButtonElement
      expect(advanceBtn).toBeTruthy()
      await act(async () => { fireEvent.click(advanceBtn) })
    }

    // The interstitial screen for the completed VIDER mission must appear...
    await waitFor(() => expect(screen.getByText(/Vidage termine/i)).toBeTruthy())
    // ...with the actual scan feature reachable (this is the part that was dead before the fix)
    expect(screen.getByText(/Scanner le ticket/i)).toBeTruthy()

    // Crucially, it must NOT have silently skipped straight to mission-2's card
    expect(screen.queryByText('Site B')).toBeNull()

    // Dismissing the interstitial resumes the normal flow onto mission-2
    fireEvent.click(screen.getByText('Continuer'))
    await waitFor(() => expect(screen.getByText('Site B')).toBeTruthy())
  })
})
