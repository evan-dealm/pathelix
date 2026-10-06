// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ScanTicketButton } from '../ScanTicketButton'
import { WeightForm } from '../ReportForms'
import { parseWeighingTicket } from '@/lib/ocr/ticket'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const READING = parseWeighingTicket({ text: '', lines: [{ text: 'Poids net 1 420 kg', conf: 0.95 }, { text: 'Ticket N° T-881', conf: 0.95 }] })

describe('ScanTicketButton', () => {
  it('is hidden when no OCR engine is running (manual entry only)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ available: false }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ScanTicketButton missionId="v1" onReading={() => undefined} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/ai/ocr'))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('uploads the ticket, polls the job and hands back the reading — it records nothing itself', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ available: true }))
      .mockResolvedValueOnce(json({ jobId: 'job-1' }, 202))
      .mockResolvedValueOnce(json({ status: 'done', outputData: { reading: READING } }))
    vi.stubGlobal('fetch', fetchMock)
    const onReading = vi.fn()
    render(<ScanTicketButton missionId="v1" onReading={onReading} />)
    const input = await screen.findByLabelText('Photographier le ticket de pesée') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 't.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(onReading).toHaveBeenCalledWith(expect.objectContaining({ netKg: 1420 }), 'job-1'), { timeout: 5000 })
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/api/ai/ocr', '/api/ai/ocr', '/api/ai/jobs/job-1'])
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('driver-status'))).toBe(false)
  })

  it('tells the driver to type the weight when the OCR job fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ available: true }))
      .mockResolvedValueOnce(json({ jobId: 'job-1' }, 202))
      .mockResolvedValueOnce(json({ status: 'failed' })))
    render(<ScanTicketButton missionId="v1" onReading={() => undefined} />)
    fireEvent.change(await screen.findByLabelText('Photographier le ticket de pesée'), { target: { files: [new File(['x'], 't.jpg')] } })
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toBeTruthy()
  })
})

describe('WeightForm with a ticket reading', () => {
  it('prefills the reading and asks the driver to confirm it', () => {
    const onSubmit = vi.fn()
    render(<WeightForm suggestion={READING} onSubmit={onSubmit} />)
    expect((screen.getByLabelText('Poids net du ticket de pesée') as HTMLInputElement).value).toBe('1,42')
    expect(screen.getByRole('status').textContent).toMatch(/Vérifiez avec le ticket/)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le poids' }))
    expect(onSubmit).toHaveBeenCalledWith(1420)
  })

  it('shows why an uncertain reading must be checked', () => {
    const shaky = parseWeighingTicket({ text: '', lines: [{ text: 'Poids net 1 420 kg', conf: 0.55 }] })
    render(<WeightForm suggestion={shaky} onSubmit={() => undefined} />)
    expect(screen.getByRole('status').textContent).toMatch(/incertaine/)
  })
})
