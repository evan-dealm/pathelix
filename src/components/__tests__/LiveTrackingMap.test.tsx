// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

const setLngLatMock = vi.fn().mockReturnThis()
const setPopupMock  = vi.fn().mockReturnThis()
const addToMock     = vi.fn().mockReturnThis()
const removeMock    = vi.fn()
const setHTMLMock   = vi.fn().mockReturnThis()

class FakeMarker {
  static created: FakeMarker[] = []
  el: HTMLElement
  constructor(opts: { element: HTMLElement }) {
    this.el = opts.element
    FakeMarker.created.push(this)
  }
  setLngLat = setLngLatMock
  setPopup  = setPopupMock
  addTo     = addToMock
  remove    = removeMock
  getElement = () => this.el
  getPopup   = () => ({ setHTML: setHTMLMock })
}

class FakePopup {
  static created: FakePopup[] = []
  html = ''
  constructor() { FakePopup.created.push(this) }
  setHTML(h: string) { this.html = h; return this }
}

class FakeLngLatBounds {
  extend = vi.fn().mockReturnThis()
}

class FakeMap {
  static lastInstance: FakeMap | null = null
  listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  constructor() { FakeMap.lastInstance = this }
  addControl = vi.fn()
  remove     = vi.fn()
  resize     = vi.fn()
  fitBounds  = vi.fn()
  on = (event: string, handler: (...args: unknown[]) => void) => {
    const list = this.listeners.get(event) ?? []
    list.push(handler)
    this.listeners.set(event, list)
    return this
  }
  emit(event: string, payload?: unknown) {
    for (const h of this.listeners.get(event) ?? []) h(payload)
  }
}

class FakeResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(_cb: unknown) {}
}

vi.mock('maplibre-gl', () => ({
  Map:                FakeMap,
  Marker:             FakeMarker,
  Popup:              FakePopup,
  LngLatBounds:       FakeLngLatBounds,
  NavigationControl:  vi.fn(function NavigationControl() { return {} }),
  AttributionControl: vi.fn(function AttributionControl() { return {} }),
  ScaleControl:       vi.fn(function ScaleControl() { return {} }),
}))

const { LiveTrackingMap } = await import('@/components/LiveTrackingMap')

const DRIVERS = [
  { id: 'd-1', firstName: 'Gabin', lastName: 'Martin' },
  { id: 'd-2', firstName: 'Lucas', lastName: 'Perrin' },
]

function livePosition(overrides: Partial<{
  driverId: string; lat: number; lng: number; speedKmh: number; ignition: boolean; updatedAt: number
}> = {}) {
  return {
    driverId:  'd-1',
    lat:       46.0682,
    lng:       5.9245,
    speedKmh:  42,
    ignition:  true,
    updatedAt: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  FakeMarker.created = []
  FakePopup.created = []
  FakeMap.lastInstance = null
  // @ts-expect-error jsdom has no ResizeObserver
  globalThis.ResizeObserver = FakeResizeObserver
})

afterEach(cleanup)

describe('LiveTrackingMap', () => {
  it('renders a full-size container and creates no markers before the style has loaded', () => {
    render(<LiveTrackingMap positions={[livePosition()]} drivers={DRIVERS} />)
    expect(FakeMarker.created).toHaveLength(0)
  })

  it('creates one marker per active driver position once the style is loaded, at the correct [lng, lat]', async () => {
    render(<LiveTrackingMap positions={[livePosition({ driverId: 'd-1', lat: 46.0682, lng: 5.9245 })]} drivers={DRIVERS} />)

    await act(async () => { FakeMap.lastInstance!.emit('load') })

    expect(FakeMarker.created).toHaveLength(1)
    expect(setLngLatMock).toHaveBeenCalledWith([5.9245, 46.0682])
  })

  it('filters out positions older than 30 minutes', async () => {
    const stale = livePosition({ driverId: 'd-2', updatedAt: Date.now() - 31 * 60_000 })
    const fresh = livePosition({ driverId: 'd-1', updatedAt: Date.now() })
    render(<LiveTrackingMap positions={[stale, fresh]} drivers={DRIVERS} />)

    await act(async () => { FakeMap.lastInstance!.emit('load') })

    expect(FakeMarker.created).toHaveLength(1)
  })

  it('escapes the driver name in the popup HTML (no raw markup from DB data)', async () => {
    const evilDrivers = [{ id: 'd-1', firstName: '<img src=x onerror=alert(1)>', lastName: 'X' }]
    render(<LiveTrackingMap positions={[livePosition({ driverId: 'd-1' })]} drivers={evilDrivers} />)

    await act(async () => { FakeMap.lastInstance!.emit('load') })

    const popupHtml = FakePopup.created.at(-1)?.html ?? ''
    expect(popupHtml).not.toContain('<img')
    expect(popupHtml).toContain('&lt;img')
  })

  it('removes a marker once its driver stops reporting a position', async () => {
    const { rerender } = render(<LiveTrackingMap positions={[livePosition({ driverId: 'd-1' })]} drivers={DRIVERS} />)
    await act(async () => { FakeMap.lastInstance!.emit('load') })
    expect(FakeMarker.created).toHaveLength(1)

    rerender(<LiveTrackingMap positions={[]} drivers={DRIVERS} />)
    await act(async () => {})

    expect(removeMock).toHaveBeenCalled()
  })
})
