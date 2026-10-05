// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ScanTicketButton, parseTicketWeightKg } from '../ScanTicketButton'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('parseTicketWeightKg', () => {
  it.each([
    ['1.42 t', 1420], ['1,42t', 1420], ['1420 kg', 1420], ['1 420kg', 1420], ['2.5', 2500], ['14200', 14200],
  ])('%s → %s kg', (raw, kg) => expect(parseTicketWeightKg(raw)).toBe(kg))

  it('rejects unreadable values', () => {
    expect(parseTicketWeightKg('illisible')).toBeNull()
    expect(parseTicketWeightKg('0')).toBeNull()
  })
})

describe('ScanTicketButton', () => {
  it('is hidden when no OCR engine is deployed (manual entry only)', () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENGINE_URL', '')
    render(<ScanTicketButton missionId="v1" onWeight={() => undefined} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('uploads the ticket, polls the OCR job and hands back the weight in kg', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENGINE_URL', 'http://ai')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'done', outputData: { weight: '1.42 t' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const onWeight = vi.fn()
    render(<ScanTicketButton missionId="v1" onWeight={onWeight} />)
    const input = screen.getByLabelText('Photographier le ticket de pesée') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 't.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(onWeight).toHaveBeenCalledWith(1420), { timeout: 5000 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ai/ocr')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/ai/jobs/job-1')
  })

  it('tells the driver to type the weight when the OCR job fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENGINE_URL', 'http://ai')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'failed' }), { status: 200 })))
    render(<ScanTicketButton missionId="v1" onWeight={() => undefined} />)
    fireEvent.change(screen.getByLabelText('Photographier le ticket de pesée'), { target: { files: [new File(['x'], 't.jpg')] } })
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toBeTruthy()
  })
})
