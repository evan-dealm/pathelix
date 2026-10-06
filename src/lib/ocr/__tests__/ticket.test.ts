import { describe, expect, it } from 'vitest'
import { parseWeightToken, parseWeighingTicket, readingFromJob } from '../ticket'

const lines = (text: string, conf = 0.95) => ({ text, lines: text.split('\n').map(t => ({ text: t, conf })) })

describe('parseWeightToken', () => {
  it.each([
    ['12 340 kg', 12340], ['12.340 kg', 12340], ['7840', 7840], ['7,84 t', 7840], ['12,34 T', 12340],
    ['1.42 t', 1420], ['3.5', 3500], ['  980 KG', 980], ['12 340 kg', 12340],
  ])('%s → %d kg', (raw, kg) => { expect(parseWeightToken(raw)).toBe(kg) })

  it('rejects text without a figure', () => { expect(parseWeightToken('kg')).toBeNull() })
})

describe('parseWeighingTicket', () => {
  const TICKET = [
    'CENTRE DE TRI DU GRESIVAUDAN',
    'Ticket N° 2026-04812',
    'Date : 14/03/2026  10:42',
    'Immat : GH-482-KT',
    'Pesée 1 (brut)   20 120 kg',
    'Pesée 2 (tare)   12 280 kg',
    'Poids net         7 840 kg',
    'Produit : Gravats',
  ].join('\n')

  it('reads a clean ticket with all figures and no issue', () => {
    const r = parseWeighingTicket(lines(TICKET))
    expect(r).toMatchObject({ netKg: 7840, grossKg: 20120, tareKg: 12280, ticketNumber: '2026-04812', date: '2026-03-14', plate: 'GH-482-KT', needsReview: false })
    expect(r.issues).toEqual([])
    expect(r.confidence).toBeCloseTo(0.95)
  })

  it('does not take the time printed on the net line as the weight', () => {
    expect(parseWeighingTicket(lines('Net 10:42 7 840 kg')).netKg).toBe(7840)
  })

  it('flags a net weight that does not match gross − tare', () => {
    const r = parseWeighingTicket(lines(TICKET.replace('7 840 kg', '7 340 kg')))
    expect(r.netKg).toBe(7340)
    expect(r.needsReview).toBe(true)
    expect(r.issues.join(' ')).toMatch(/différent du net lu/)
    expect(r.confidence).toBeLessThanOrEqual(0.5)
  })

  it('computes the net from gross and tare when the net line is unreadable, and asks for review', () => {
    const r = parseWeighingTicket(lines(TICKET.replace('Poids net         7 840 kg', 'P#ds n€t   ????')))
    expect(r.netKg).toBe(7840)
    expect(r.needsReview).toBe(true)
  })

  it('asks for review when the engine was unsure of the net line', () => {
    const r = parseWeighingTicket({ text: '', lines: [{ text: 'Poids net 7 840 kg', conf: 0.62 }] })
    expect(r.netKg).toBe(7840)
    expect(r.needsReview).toBe(true)
    expect(r.issues.join(' ')).toMatch(/incertaine \(62 %\)/)
  })

  it('reports a missing net weight instead of guessing', () => {
    const r = parseWeighingTicket(lines('Bon de livraison\nMerci de votre visite'))
    expect(r.netKg).toBeNull()
    expect(r.needsReview).toBe(true)
  })

  it('flags an implausible net weight', () => {
    const r = parseWeighingTicket(lines('Poids net 78 400 kg'))
    expect(r.needsReview).toBe(true)
    expect(r.issues.join(' ')).toMatch(/improbable/)
  })

  it('falls back to the mean confidence when the engine gives plain text', () => {
    expect(parseWeighingTicket({ text: 'NET 2,46 t', meanConfidence: 0.9 })).toMatchObject({ netKg: 2460, confidence: 0.9, needsReview: false })
  })

  it('round-trips through stored job output', () => {
    const r = parseWeighingTicket(lines(TICKET))
    expect(readingFromJob(JSON.parse(JSON.stringify({ reading: r })))).toEqual(r)
    expect(readingFromJob({ weight: '7.84' })).toBeNull()
  })
})
