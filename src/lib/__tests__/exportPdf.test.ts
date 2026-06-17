// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportTourSheetPdf } from '@/lib/exportPdf'

// Mock for the popup window returned by window.open
const mockWinWrite = vi.fn()
const mockWinClose = vi.fn()

function makeWin() {
  return {
    document: {
      write: mockWinWrite,
      close: mockWinClose,
    },
    print: vi.fn(),
  }
}

const baseDriver = {
  id: 'd1',
  firstName: 'Jean',
  lastName: 'Dupont',
  sector: 'Nord',
  depotName: 'Dépôt A',
} as any

const baseTour = {
  driver: baseDriver,
  plan: [],
  result: null,
  date: '2026-05-10',
  startTime: '08:00',
}

describe('exportTourSheetPdf — popup blocked', () => {
  it('dispatches pathelix:toast error when popup is blocked (window.open returns null)', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    exportTourSheetPdf([baseTour])

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pathelix:toast' }),
    )
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent
    expect((event as CustomEvent).detail?.type).toBe('error')

    vi.restoreAllMocks()
  })
})

describe('exportTourSheetPdf — HTML generation', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockReturnValue(makeWin() as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('writes HTML to popup window', () => {
    exportTourSheetPdf([baseTour])
    expect(mockWinWrite).toHaveBeenCalledTimes(1)
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
  })

  it('closes popup window after writing', () => {
    exportTourSheetPdf([baseTour])
    expect(mockWinClose).toHaveBeenCalledTimes(1)
  })

  it('includes driver first and last name', () => {
    exportTourSheetPdf([baseTour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('Jean')
    expect(html).toContain('Dupont')
  })

  it('uses PATHÉLIX as default company name', () => {
    exportTourSheetPdf([baseTour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('PATHÉLIX')
  })

  it('uses custom company name when provided', () => {
    exportTourSheetPdf([baseTour], 'ACME Corp')
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('ACME Corp')
  })

  it('includes start time', () => {
    exportTourSheetPdf([baseTour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('08:00')
  })

  it('includes sector and depot', () => {
    exportTourSheetPdf([baseTour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('Nord')
    expect(html).toContain('Dépôt A')
  })

  it('omits stats section when result is null', () => {
    exportTourSheetPdf([baseTour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).not.toContain('class="stats"')
  })

  it('includes stats section when result is provided', () => {
    const tour = {
      ...baseTour,
      result: {
        steps: [
          {
            isSynthetic: false,
            mission: { type: 'POSER', priority: 1, clientName: 'ACME', address: '1 rue Test', accessNotes: '' },
            arrivalStr: '08:30',
            departureStr: '09:00',
            onSiteMin: 30,
            roadDistKm: 5,
          },
        ],
        totalDurationMin: 180,
        totalRoadDistKm: 42,
        totalDrivingMin: 120,
        totalOnSiteMin: 60,
        finishStr: '17:00',
      } as any,
    }
    exportTourSheetPdf([tour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('class="stats"')
    expect(html).toContain('42')
    expect(html).toContain('3h00')
  })

  it('includes estimated finish time when result is provided', () => {
    const tour = {
      ...baseTour,
      result: {
        steps: [],
        totalDurationMin: 60,
        totalRoadDistKm: 10,
        totalDrivingMin: 40,
        totalOnSiteMin: 20,
        finishStr: '16:45',
      } as any,
    }
    exportTourSheetPdf([tour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('16:45')
  })

  it('adds page-break element between multiple tours', () => {
    const tour2 = { ...baseTour, driver: { ...baseDriver, firstName: 'Marie', lastName: 'Curie' } }
    exportTourSheetPdf([baseTour, tour2])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('page-break')
    expect(html).toContain('Marie')
    expect(html).toContain('Curie')
  })

  it('handles empty tours array without crash', () => {
    expect(() => exportTourSheetPdf([])).not.toThrow()
  })

  it('marks P1 priority missions with p1 badge', () => {
    const tour = {
      ...baseTour,
      result: {
        steps: [{
          isSynthetic: false,
          mission: { type: 'POSER', priority: 1, clientName: 'A', address: 'B', accessNotes: '' },
          arrivalStr: '08:30',
          departureStr: '09:00',
          onSiteMin: 30,
          roadDistKm: 3,
        }],
        totalDurationMin: 30,
        totalRoadDistKm: 3,
        totalDrivingMin: 15,
        totalOnSiteMin: 15,
        finishStr: '09:00',
      } as any,
    }
    exportTourSheetPdf([tour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('class="p1"')
  })

  it('does not include P1 badge for priority 2', () => {
    const tour = {
      ...baseTour,
      result: {
        steps: [{
          isSynthetic: false,
          mission: { type: 'RETIRER', priority: 2, clientName: 'B', address: 'C', accessNotes: '' },
          arrivalStr: '09:00',
          departureStr: '09:30',
          onSiteMin: 30,
          roadDistKm: 2,
        }],
        totalDurationMin: 30,
        totalRoadDistKm: 2,
        totalDrivingMin: 15,
        totalOnSiteMin: 15,
        finishStr: '10:00',
      } as any,
    }
    exportTourSheetPdf([tour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).not.toContain('class="p1"')
  })

  it('uses mission type badge class in table rows', () => {
    const tour = {
      ...baseTour,
      result: {
        steps: [{
          isSynthetic: false,
          mission: { type: 'RETIRER', clientName: 'X', address: 'Y', accessNotes: '' },
          arrivalStr: '08:30',
          departureStr: '09:00',
          onSiteMin: 30,
          roadDistKm: 3,
        }],
        totalDurationMin: 30,
        totalRoadDistKm: 3,
        totalDrivingMin: 15,
        totalOnSiteMin: 15,
        finishStr: '09:00',
      } as any,
    }
    exportTourSheetPdf([tour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('type-RETIRER')
  })

  it('includes print button', () => {
    exportTourSheetPdf([baseTour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).toContain('print-btn')
  })
})

describe('exportTourSheetPdf — escHtml (XSS prevention)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockReturnValue(makeWin() as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('escapes angle brackets in driver first name', () => {
    const xssTour = {
      ...baseTour,
      driver: { ...baseDriver, firstName: '<b>XSS</b>', lastName: 'Safe' },
    }
    exportTourSheetPdf([xssTour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).not.toContain('<b>XSS</b>')
    expect(html).toContain('&lt;b&gt;XSS&lt;/b&gt;')
  })

  it('escapes ampersand in company name', () => {
    exportTourSheetPdf([baseTour], 'Me & You')
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).not.toMatch(/Me & You(?!;)/)
    expect(html).toContain('Me &amp; You')
  })

  it('escapes double quotes in access notes', () => {
    const tour = {
      ...baseTour,
      result: {
        steps: [{
          isSynthetic: false,
          mission: { type: 'POSER', clientName: 'A', address: 'B', accessNotes: 'Note avec "guillemets"' },
          arrivalStr: '08:30',
          departureStr: '09:00',
          onSiteMin: 30,
          roadDistKm: 3,
        }],
        totalDurationMin: 30,
        totalRoadDistKm: 3,
        totalDrivingMin: 15,
        totalOnSiteMin: 15,
        finishStr: '09:00',
      } as any,
    }
    exportTourSheetPdf([tour])
    const html = mockWinWrite.mock.calls[0][0] as string
    expect(html).not.toContain('"guillemets"')
    expect(html).toContain('&quot;guillemets&quot;')
  })
})

describe('exportTourSheetPdf — formatMin (via HTML output)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockReturnValue(makeWin() as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  function tourWithDuration(totalDurationMin: number) {
    return {
      ...baseTour,
      result: {
        steps: [],
        totalDurationMin,
        totalRoadDistKm: 0,
        totalDrivingMin: 0,
        totalOnSiteMin: 0,
        finishStr: '17:00',
      } as any,
    }
  }

  it('formats 0 min → 0h00', () => {
    exportTourSheetPdf([tourWithDuration(0)])
    expect(mockWinWrite.mock.calls[0][0]).toContain('0h00')
  })

  it('formats 61 min → 1h01', () => {
    exportTourSheetPdf([tourWithDuration(61)])
    expect(mockWinWrite.mock.calls[0][0]).toContain('1h01')
  })

  it('formats 90 min → 1h30', () => {
    exportTourSheetPdf([tourWithDuration(90)])
    expect(mockWinWrite.mock.calls[0][0]).toContain('1h30')
  })

  it('formats 125 min → 2h05', () => {
    exportTourSheetPdf([tourWithDuration(125)])
    expect(mockWinWrite.mock.calls[0][0]).toContain('2h05')
  })

  it('formats 480 min → 8h00', () => {
    exportTourSheetPdf([tourWithDuration(480)])
    expect(mockWinWrite.mock.calls[0][0]).toContain('8h00')
  })
})
