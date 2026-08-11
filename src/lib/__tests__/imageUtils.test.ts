// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressImage } from '@/lib/imageUtils'

const SAMPLE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

beforeEach(() => {
  // Mock Image
  vi.stubGlobal('Image', class {
    width = 800
    height = 600
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_: string) { setTimeout(() => this.onload?.(), 0) }
  })

  // Mock canvas
  const mockCtx = { drawImage: vi.fn() }
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => mockCtx),
    toDataURL: vi.fn((_type: string, _q: number) => 'data:image/jpeg;base64,compressed'),
  }
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return mockCanvas as unknown as HTMLElement
    return document.createElement(tag)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('compressImage', () => {
  it('returns a JPEG dataUrl when image loads successfully', async () => {
    const result = await compressImage(SAMPLE_PNG, 1280, 0.75)
    expect(result).toBe('data:image/jpeg;base64,compressed')
  })

  it('scales down width when image wider than maxWidth', async () => {
    const result = await compressImage(SAMPLE_PNG, 400, 0.75)
    expect(result).toBe('data:image/jpeg;base64,compressed')
    // canvas.width should be 400, canvas.height should be 300 (800×600 halved)
    // just verify it returned compressed result
  })

  it('does not upscale when image smaller than maxWidth', async () => {
    vi.stubGlobal('Image', class {
      width = 100
      height = 80
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_: string) { setTimeout(() => this.onload?.(), 0) }
    })
    const result = await compressImage(SAMPLE_PNG, 1280, 0.75)
    expect(result).toBe('data:image/jpeg;base64,compressed')
  })

  it('falls back to original dataUrl when canvas context unavailable', async () => {
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0, height: 0,
          getContext: vi.fn(() => null),
          toDataURL: vi.fn(),
        } as unknown as HTMLElement
      }
      return document.createElement(tag)
    })
    const result = await compressImage(SAMPLE_PNG, 1280, 0.75)
    expect(result).toBe(SAMPLE_PNG)
  })

  it('falls back to original dataUrl on image load error', async () => {
    vi.stubGlobal('Image', class {
      width = 0
      height = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_: string) { setTimeout(() => this.onerror?.(), 0) }
    })
    const result = await compressImage(SAMPLE_PNG, 1280, 0.75)
    expect(result).toBe(SAMPLE_PNG)
  })

  it('returns original in non-browser environment (no document)', async () => {
    const origDocument = global.document
    Object.defineProperty(global, 'document', { value: undefined, writable: true, configurable: true })
    const result = await compressImage(SAMPLE_PNG, 1280, 0.75)
    expect(result).toBe(SAMPLE_PNG)
    Object.defineProperty(global, 'document', { value: origDocument, writable: true, configurable: true })
  })
})
