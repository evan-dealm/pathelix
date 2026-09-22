// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { createRef } from 'react'

// A minimal but behaviorally faithful fake of the maplibre-gl surface this hook touches.
// Kept self-contained in this file (project convention: inline vi.mock, no shared __mocks__).
const addControlMock  = vi.fn()
const removeMock      = vi.fn()
const resizeMock      = vi.fn()
const onMock          = vi.fn()
const setWorkerUrlMock = vi.fn()

class FakeMap {
  static lastInstance: FakeMap | null = null
  static lastOptions: Record<string, unknown> | null = null
  listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  constructor(options: Record<string, unknown>) {
    FakeMap.lastInstance = this
    FakeMap.lastOptions = options
  }

  addControl = addControlMock
  remove     = removeMock
  resize     = resizeMock
  on = (event: string, handler: (...args: unknown[]) => void) => {
    onMock(event, handler)
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
  observe  = vi.fn()
  disconnect = vi.fn()
  constructor(_cb: unknown) {}
}

vi.mock('maplibre-gl', () => ({
  Map:                 FakeMap,
  NavigationControl:   vi.fn(function NavigationControl() { return {} }),
  AttributionControl:  vi.fn(function AttributionControl() { return {} }),
  ScaleControl:        vi.fn(function ScaleControl() { return {} }),
  setWorkerUrl:        setWorkerUrlMock,
}))

// Imported after the mock so it picks up the faked module.
const { useMapLibreMap } = await import('@/hooks/useMapLibreMap')
const { MAPLIBRE_WORKER_URL } = await import('@/lib/maplibre/config')

beforeEach(() => {
  addControlMock.mockClear()
  removeMock.mockClear()
  resizeMock.mockClear()
  onMock.mockClear()
  FakeMap.lastInstance = null
  FakeMap.lastOptions = null
  // @ts-expect-error jsdom has no ResizeObserver
  globalThis.ResizeObserver = FakeResizeObserver
})

afterEach(cleanup)

function containerRefWithDiv() {
  const ref = createRef<HTMLDivElement>()
  // @ts-expect-error assigning a real element to a readonly-looking ref for the test
  ref.current = document.createElement('div')
  return ref
}

describe('useMapLibreMap', () => {
  // Regression test for the real bug found in MIGRATION_MAPLIBRE_LOG.md "Investigation 2":
  // maplibre-gl's own worker-URL auto-resolution (`import.meta.url`-based) silently breaks
  // once re-bundled by Next.js's webpack — no error, no console warning, the map's 'load'
  // event just never fires because its tile-loading Worker never runs real code. The fix is
  // this one call, made before any Map is constructed; this test exists so a future refactor
  // that accidentally removes it fails loudly here instead of silently hanging in production.
  it('calls maplibregl.setWorkerUrl with the statically-served worker script before creating any map', () => {
    const ref = containerRefWithDiv()
    renderHook(() => useMapLibreMap(ref, { center: [2.3, 46.8], zoom: 10 }))

    // Compared against the real exported constant (not a hardcoded literal) so this test can't
    // drift from src/lib/maplibre/config.ts, which derives the version from the installed
    // maplibre-gl package rather than hardcoding it.
    expect(setWorkerUrlMock).toHaveBeenCalledWith(MAPLIBRE_WORKER_URL)
  })

  it('creates the map with the given center/zoom and the shared pitch/bearing defaults', () => {
    const ref = containerRefWithDiv()
    renderHook(() => useMapLibreMap(ref, { center: [6.068, 46.310], zoom: 11 }))

    expect(FakeMap.lastOptions).toMatchObject({
      center:   [6.068, 46.310],
      zoom:     11,
      pitch:    45,
      bearing:  -17,
      maxPitch: 70,
    })
  })

  it('honors explicit pitch/bearing overrides instead of the defaults', () => {
    const ref = containerRefWithDiv()
    renderHook(() => useMapLibreMap(ref, { center: [2.3, 46.8], zoom: 10, pitch: 0, bearing: 90 }))

    expect(FakeMap.lastOptions).toMatchObject({ pitch: 0, bearing: 90 })
  })

  it('adds Attribution, Navigation and Scale controls by default', () => {
    const ref = containerRefWithDiv()
    renderHook(() => useMapLibreMap(ref, { center: [2.3, 46.8], zoom: 10 }))

    expect(addControlMock).toHaveBeenCalledTimes(3)
  })

  it('skips the attribution control when attribution: false is passed', () => {
    const ref = containerRefWithDiv()
    renderHook(() => useMapLibreMap(ref, { center: [2.3, 46.8], zoom: 10, attribution: false }))

    expect(addControlMock).toHaveBeenCalledTimes(2)
  })

  it('flips isStyleLoaded to true once the map fires "load"', () => {
    const ref = containerRefWithDiv()
    const { result } = renderHook(() => useMapLibreMap(ref, { center: [2.3, 46.8], zoom: 10 }))

    expect(result.current.isStyleLoaded).toBe(false)

    act(() => { FakeMap.lastInstance!.emit('load') })

    expect(result.current.isStyleLoaded).toBe(true)
  })

  it('calls map.remove() on unmount and never leaves a dangling instance', () => {
    const ref = containerRefWithDiv()
    const { unmount } = renderHook(() => useMapLibreMap(ref, { center: [2.3, 46.8], zoom: 10 }))

    expect(removeMock).not.toHaveBeenCalled()
    unmount()
    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('survives a React StrictMode-style mount/unmount/remount without double-initializing state', () => {
    const ref = containerRefWithDiv()
    const { unmount: unmountFirst } = renderHook(() => useMapLibreMap(ref, { center: [2.3, 46.8], zoom: 10 }))
    const firstInstance = FakeMap.lastInstance
    unmountFirst()
    expect(removeMock).toHaveBeenCalledTimes(1)

    const { result } = renderHook(() => useMapLibreMap(ref, { center: [2.3, 46.8], zoom: 10 }))
    expect(FakeMap.lastInstance).not.toBe(firstInstance)
    expect(result.current.isStyleLoaded).toBe(false)
  })
})
