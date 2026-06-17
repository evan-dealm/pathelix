// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { ScanTicketButton } from '@/components/driver/ScanTicketButton'

const BASE_PROPS = {
  missionId:   'mission-1',
  driverId:    'driver-1',
  missionType: 'VIDER',
  status:      'done',
}

function mockFetchOk(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok:   status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  })
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_AI_ENGINE_URL', 'http://ai-engine')
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// ── rendering conditions ─────────────────────────────────────────────────────

describe('rendering conditions', () => {
  it('not rendered when mission type is not VIDER', () => {
    const { container } = render(<ScanTicketButton {...BASE_PROPS} missionType="POSER" />)
    expect(container.firstChild).toBeNull()
  })

  it('not rendered when status is not done', () => {
    const { container } = render(<ScanTicketButton {...BASE_PROPS} status="doing" />)
    expect(container.firstChild).toBeNull()
  })

  it('not rendered when AI_ENGINE_URL absent', () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENGINE_URL', '')
    const { container } = render(<ScanTicketButton {...BASE_PROPS} />)
    expect(container.firstChild).toBeNull()
  })

  it('rendered when VIDER + done + AI configured', () => {
    render(<ScanTicketButton {...BASE_PROPS} />)
    expect(screen.getByText(/Scanner le ticket/i)).toBeTruthy()
  })
})

// ── file input attributes ────────────────────────────────────────────────────

describe('file input attributes', () => {
  it('has accept="image/*"', () => {
    render(<ScanTicketButton {...BASE_PROPS} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('image/*')
  })

  it('has capture="environment"', () => {
    render(<ScanTicketButton {...BASE_PROPS} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.getAttribute('capture')).toBe('environment')
  })
})

// ── upload flow ──────────────────────────────────────────────────────────────

describe('upload flow', () => {
  it('calls POST /api/ai/ocr on file select', async () => {
    const mockFetch = mockFetchOk({ jobId: 'job-42' })
    vi.stubGlobal('fetch', mockFetch)

    render(<ScanTicketButton {...BASE_PROPS} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['data'], 'ticket.jpg', { type: 'image/jpeg' })

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/ai/ocr', expect.objectContaining({ method: 'POST' }))
    const body = mockFetch.mock.calls[0][1].body as FormData
    expect(body.get('missionId')).toBe('mission-1')
  })

  it('shows loading state during upload', async () => {
    let resolveFetch!: (v: unknown) => void
    const fetchPromise = new Promise(r => { resolveFetch = r })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchPromise))

    render(<ScanTicketButton {...BASE_PROPS} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['data'], 'ticket.jpg', { type: 'image/jpeg' })

    act(() => {
      fireEvent.change(input, { target: { files: [file] } })
    })

    expect(screen.getByText('Envoi du ticket...')).toBeTruthy()

    resolveFetch({ ok: true, status: 200, json: () => Promise.resolve({ jobId: 'job-x' }) })
  })

  it('shows confirmation (polling state) after 202 response', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 202, json: () => Promise.resolve({ jobId: 'job-99' }) })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'pending' }) })
    vi.stubGlobal('fetch', mockFetch)

    render(<ScanTicketButton {...BASE_PROPS} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['data'], 'ticket.jpg', { type: 'image/jpeg' })

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })

    expect(screen.getByText('Lecture en cours...')).toBeTruthy()
  })
})

// ── polling ──────────────────────────────────────────────────────────────────

describe('polling', () => {
  it('polls GET /api/ai/jobs/[id] every 3 seconds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ jobId: 'job-7' }) })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'pending' }) })
    vi.stubGlobal('fetch', mockFetch)

    render(<ScanTicketButton {...BASE_PROPS} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
    })

    // advance 3 s → first poll
    await act(async () => { vi.advanceTimersByTime(3_000) })
    await act(async () => {})

    expect(mockFetch).toHaveBeenCalledWith('/api/ai/jobs/job-7')

    // advance another 3 s → second poll
    await act(async () => { vi.advanceTimersByTime(3_000) })
    await act(async () => {})

    const pollCalls = mockFetch.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('/api/ai/jobs/'),
    )
    expect(pollCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('shows weight when result available', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ jobId: 'job-8' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ status: 'done', outputData: { weight: '2.34t' } }) })
    vi.stubGlobal('fetch', mockFetch)

    render(<ScanTicketButton {...BASE_PROPS} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
    })

    await act(async () => { vi.advanceTimersByTime(3_000) })
    await act(async () => {})

    expect(screen.getByText('2.34t')).toBeTruthy()
    expect(screen.getByText('Poids enregistré')).toBeTruthy()
  })

  it('shows manual input fallback after 60s timeout', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ jobId: 'job-9' }) })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'pending' }) })
    vi.stubGlobal('fetch', mockFetch)

    render(<ScanTicketButton {...BASE_PROPS} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
    })

    // advance past 60 s timeout
    await act(async () => { vi.advanceTimersByTime(60_000) })
    await act(async () => {})

    expect(screen.getByText('Saisie manuelle du poids')).toBeTruthy()
  })
})

// ── manual input ─────────────────────────────────────────────────────────────

describe('manual input', () => {
  async function enterManualState() {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ jobId: 'job-m' }) })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'pending' }) })
    vi.stubGlobal('fetch', mockFetch)

    render(<ScanTicketButton {...BASE_PROPS} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
    })

    await act(async () => { vi.advanceTimersByTime(60_000) })
    await act(async () => {})
  }

  it('manual input is present in manual phase', async () => {
    await enterManualState()
    expect(document.querySelector('input[type="text"]')).toBeTruthy()
  })

  it('OK button disabled when input empty', async () => {
    await enterManualState()
    const btn = screen.getByText('OK') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('OK button enabled when input has value', async () => {
    await enterManualState()
    const textInput = document.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(textInput, { target: { value: '1.5t' } })
    const btn = screen.getByText('OK') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('saves manual weight and shows done state', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ jobId: 'job-m2' }) })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'pending' }) })
    vi.stubGlobal('fetch', mockFetch)

    render(<ScanTicketButton {...BASE_PROPS} />)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
    })
    await act(async () => { vi.advanceTimersByTime(60_000) })
    await act(async () => {})

    const textInput = document.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(textInput, { target: { value: '3.2t' } })

    await act(async () => {
      fireEvent.click(screen.getByText('OK'))
    })

    expect(screen.getByText('3.2t')).toBeTruthy()
    expect(screen.getByText('Poids enregistré')).toBeTruthy()
  })

  it('OK button stays disabled for whitespace-only input', async () => {
    await enterManualState()
    const textInput = document.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(textInput, { target: { value: '   ' } })
    const btn = screen.getByText('OK') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
