import { describe, expect, it } from 'vitest'
import { groundFields, missingFields, parseMissionRules, sanitizeLlmFields } from '../missionText'

const REF = '2026-10-06' // a Tuesday

describe('parseMissionRules', () => {
  it('reads a complete request', () => {
    expect(parseMissionRules('Poser une benne 8m3 chez Dupont BTP, 14 rue des Artisans, Lyon 69003, demain avant 10h, urgent', REF)).toEqual({
      type: 'POSER', estimatedDurationMin: 30, binSize: '8m3', priority: 1,
      timeWindow: { openMin: 360, closeMin: 600 }, date: '2026-10-07',
      clientName: 'Dupont BTP', address: '14 rue des Artisans, Lyon 69003',
    })
  })

  it.each([
    ['Retirer la benne chez Martin Construction avenue de la Paix Grenoble', 'RETIRER'],
    ['Echanger benne ampliroll chez Garage Renard', 'ECHANGER'],
    ['rotation de la 15 m3 chez Bati Sud', 'ECHANGER'],
    ['Déplacer la benne au fond du chantier', 'DEPLACER'],
    ['aller-retour vidage sur place chez Leroy', 'ALLER_RETOUR'],
    ['enlever la benne pleine', 'RETIRER'],
  ])('%s → %s', (text, type) => { expect(parseMissionRules(text, REF).type).toBe(type) })

  it('reads time windows in their usual French forms', () => {
    expect(parseMissionRules('créneau 13h-16h', REF).timeWindow).toEqual({ openMin: 780, closeMin: 960 })
    expect(parseMissionRules('entre 8h30 et 10h', REF).timeWindow).toEqual({ openMin: 510, closeMin: 600 })
    expect(parseMissionRules('après 14h', REF).timeWindow).toEqual({ openMin: 840, closeMin: 1080 })
    expect(parseMissionRules('le matin', REF).timeWindow).toEqual({ openMin: 420, closeMin: 720 })
    expect(parseMissionRules('entre 10h et 8h', REF).timeWindow).toBeUndefined()
  })

  it('reads days', () => {
    expect(parseMissionRules('lundi', REF).date).toBe('2026-10-12')
    expect(parseMissionRules('mardi', REF).date).toBe('2026-10-13') // next week, not today
    expect(parseMissionRules('le 12/10', REF).date).toBe('2026-10-12')
    expect(parseMissionRules('le 02/01', REF).date).toBe('2027-01-02') // past date this year → next year
    expect(parseMissionRules('après-demain', REF).date).toBe('2026-10-08')
    expect(parseMissionRules('le 45/13', REF).date).toBeUndefined()
  })

  it('reports what is missing rather than guessing', () => {
    const p = parseMissionRules('urgent svp', REF)
    expect(p).toEqual({ priority: 1 })
    expect(missingFields(p)).toEqual(['type', 'adresse', 'client'])
  })
})

describe('sanitizeLlmFields', () => {
  it('keeps valid fields and drops invalid ones, one by one', () => {
    const { fields, dropped } = sanitizeLlmFields({
      type: 'POSER', priority: 7, timeWindow: { openMin: 600, closeMin: 480 }, estimatedDurationMin: 30,
      address: '14 rue des Artisans', extra: 'ignored', binSize: '',
    })
    expect(fields).toEqual({ type: 'POSER', estimatedDurationMin: 30, address: '14 rue des Artisans' })
    expect(dropped).toEqual(['priorité', 'créneau'])
  })

  it('ignores non-objects', () => {
    expect(sanitizeLlmFields('POSER')).toEqual({ fields: {}, dropped: [] })
    expect(sanitizeLlmFields(null)).toEqual({ fields: {}, dropped: [] })
  })
})

describe('groundFields', () => {
  const text = 'Poser une benne chez Dupont BTP, 14 rue des Artisans à Lyon'
  it('keeps names and addresses that are in the text (accents and case aside)', () => {
    expect(groundFields({ clientName: 'DUPONT btp', address: '14 Rue des Artisans, Lyon' }, text).ungrounded).toEqual([])
  })

  it('drops an invented address or client (hallucination or injected instruction)', () => {
    const r = groundFields({ clientName: 'Durand SA', address: '3 avenue Foch, Paris', type: 'POSER' }, text)
    expect(r.fields).toEqual({ type: 'POSER' })
    expect(r.ungrounded).toEqual(['client', 'adresse'])
  })
})
