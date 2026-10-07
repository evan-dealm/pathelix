// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'driver-1' }),
  useSearchParams: () => ({ get: () => '2026-08-12' }),
}))
vi.mock('@/hooks/useGpsTracking', () => ({ useGpsTracking: () => undefined }))

const queue = vi.hoisted(() => ({
  enqueueAction:     vi.fn(async () => 'sync-q:1-x'),
  sendNow:           vi.fn(async () => true),
  flushSyncQueue:    vi.fn(async () => ({ synced: 0, pending: 0, failed: 0, authRequired: false })),
  getQueueStatus:    vi.fn(async () => ({ pending: 0, failed: [] })),
  getQueuedActions:  vi.fn(async () => []),
  retryFailedAction: vi.fn(),
  discardAction:     vi.fn(),
  cacheDayPlan:      vi.fn(async () => undefined),
  getCachedDayPlan:  vi.fn(async () => null),
  clearDriverDeviceData: vi.fn(async () => undefined),
}))
vi.mock('@/lib/syncQueue', () => queue)

import DriverPage from '../page'

const DRIVER = { id: 'driver-1', firstName: 'Jean', lastName: 'Dupont', sector: 'A', depotName: 'Dépôt', depotLat: 45.0, depotLng: 5.0 }
const POSER = {
  id: 'm-poser', type: 'POSER', date: '2026-08-12', clientName: 'Boulangerie Martin', address: '2 rue B',
  latitude: 45.2, longitude: 5.2, estimatedDurationMin: 10, maneuverTimeMin: 5, sequenceOrder: 0,
}
const VIDER = {
  id: 'vider-1', type: 'VIDER', date: '2026-08-12', outletName: 'Centre de tri Nord', address: '1 rue A',
  latitude: 45.1, longitude: 5.1, estimatedDurationMin: 10, maneuverTimeMin: 5, sequenceOrder: 1, isSynthetic: true,
}

function planResponse(statuses: Record<string, string> = {}, plan: unknown[] = [POSER, VIDER]) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/driver-plan/')) {
      return new Response(JSON.stringify({ driver: DRIVER, plan, statuses, startTime: '07:00', speedKmh: 50, date: '2026-08-12' }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', planResponse())
  Object.values(queue).forEach(fn => (fn as ReturnType<typeof vi.fn>).mockClear())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('driver app', () => {
  it('shows the first unfinished stop and its next action', async () => {
    render(<DriverPage />)
    expect(await screen.findByRole('heading', { name: 'Boulangerie Martin' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Démarrer le trajet' })).toBeTruthy()
  })

  it('resumes from the statuses stored on the server (other device / cleared cache)', async () => {
    vi.stubGlobal('fetch', planResponse({ 'm-poser': 'arrived' }))
    render(<DriverPage />)
    expect(await screen.findByRole('button', { name: 'Commencer la manœuvre' })).toBeTruthy()
  })

  it('records one status action per tap, with the server status flow and an Idempotency-backed queue', async () => {
    render(<DriverPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Démarrer le trajet' }))
    await waitFor(() => expect(queue.enqueueAction).toHaveBeenCalledTimes(1))
    const [url, body, opts] = queue.enqueueAction.mock.calls[0] as unknown as [string, Record<string, unknown>, { ownerId: string }]
    expect(url).toBe('/api/driver-status/update')
    expect(body).toMatchObject({ driverId: 'driver-1', missionId: 'm-poser', date: '2026-08-12', status: 'en_route' })
    expect(opts.ownerId).toBe('driver-1')
    expect(await screen.findByRole('button', { name: 'Je suis arrivé' })).toBeTruthy()
  })

  it('shows dump (VIDER) stops in the tour and asks for the weighing ticket when the dump is done', async () => {
    vi.stubGlobal('fetch', planResponse({ 'm-poser': 'done', 'vider-1': 'arrived' }))
    render(<DriverPage />)
    expect(await screen.findByRole('heading', { name: 'Centre de tri Nord' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Vidage terminé' }))
    expect(await screen.findByLabelText('Poids net du ticket de pesée')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Poids net du ticket de pesée'), { target: { value: '1,42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le poids' }))
    await waitFor(() => expect(queue.enqueueAction).toHaveBeenLastCalledWith(
      '/api/driver-status/update',
      { driverId: 'driver-1', missionId: 'vider-1', date: '2026-08-12', weightKg: 1420 },
      expect.objectContaining({ label: 'Poids du ticket de pesée' }),
    ))
  })

  it('reports an incident on the current mission through the queue', async () => {
    render(<DriverPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Incident' }))
    fireEvent.click(await screen.findByLabelText('Accès impossible'))
    fireEvent.change(screen.getByLabelText(/Précisions/), { target: { value: 'Portail fermé' } })
    fireEvent.click(screen.getByRole('button', { name: 'Signaler l’incident' }))
    await waitFor(() => expect(queue.enqueueAction).toHaveBeenCalledWith(
      '/api/incidents', { missionId: 'm-poser', incidentType: 'acces', notes: 'Portail fermé' }, expect.anything(),
    ))
  })

  it('falls back to the cached tour only when the network is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    queue.getCachedDayPlan.mockResolvedValueOnce({ driver: DRIVER, plan: [POSER], statuses: {}, startTime: '07:00', speedKmh: 50, date: '2026-08-12' } as never)
    render(<DriverPage />)
    expect(await screen.findByText(/dernière copie enregistrée/)).toBeTruthy()
  })

  it('never shows a cached tour when the server refuses access', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Accès refusé' }), { status: 403 })))
    render(<DriverPage />)
    expect(await screen.findByText('Accès refusé')).toBeTruthy()
    expect(queue.getCachedDayPlan).not.toHaveBeenCalled()
  })
})
