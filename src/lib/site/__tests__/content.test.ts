import { describe, it, expect } from 'vitest'
import { CONTENT_PAGES, GLOSSAIRE, pathOf, titleOfPath } from '@/lib/site/content'
import { FAQ } from '@/lib/site/faq'
import { FILM, PRIMARY_NAV } from '@/lib/site/config'

/** Every address the website can link to (static pages + content pages). */
const STATIC_PATHS = [
  '/',
  '/produit',
  '/metiers',
  '/guides',
  '/glossaire',
  '/tarifs',
  '/securite',
  '/contact',
  '/mentions-legales',
  '/confidentialite',
]
const KNOWN = new Set([...STATIC_PATHS, ...CONTENT_PAGES.map(pathOf)])

function allText(): string {
  return [
    ...CONTENT_PAGES.flatMap(p => [
      p.title,
      p.metaTitle,
      p.description,
      p.answer,
      ...p.sections.flatMap(s => [
        s.heading,
        ...(s.paragraphs ?? []),
        ...(s.points ?? []),
        ...(s.table ? [...s.table.head, ...s.table.rows.flat()] : []),
      ]),
      ...(p.questions ?? []).flatMap(q => [q.question, q.answer]),
    ]),
    ...GLOSSAIRE.flatMap(g => [g.term, g.definition]),
    ...FAQ.flatMap(f => [f.question, f.answer]),
  ].join('\n')
}

describe('website content', () => {
  it('has no two pages at the same address', () => {
    const paths = CONTENT_PAGES.map(pathOf)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('only links to pages that exist — a dead « À lire ensuite » link would be a 404', () => {
    for (const page of CONTENT_PAGES) {
      for (const path of page.related) {
        expect(KNOWN.has(path), `${pathOf(page)} → ${path}`).toBe(true)
        expect(titleOfPath(path), `${pathOf(page)} → ${path} has no title`).toBeTruthy()
        expect(path, `${pathOf(page)} links to itself`).not.toBe(pathOf(page))
      }
    }
    for (const entry of GLOSSAIRE) {
      if (entry.more)
        {expect(KNOWN.has(entry.more), `glossaire ${entry.id} → ${entry.more}`).toBe(true)}
    }
    for (const item of PRIMARY_NAV) {
      expect(KNOWN.has(item.href.split('#')[0] || '/'), item.href).toBe(true)
    }
  })

  it('gives every page a title and a description that fit in a search result', () => {
    for (const page of CONTENT_PAGES) {
      // The layout appends « — Pathélix » (11 characters).
      expect(page.metaTitle.length, `${pathOf(page)} title`).toBeLessThanOrEqual(75)
      expect(page.description.length, `${pathOf(page)} description`).toBeGreaterThanOrEqual(110)
      expect(page.description.length, `${pathOf(page)} description`).toBeLessThanOrEqual(220)
      expect(page.answer.length, `${pathOf(page)} answer`).toBeGreaterThan(120)
      expect(page.sections.length, `${pathOf(page)} sections`).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps glossary anchors unique and its terms in alphabetical order', () => {
    const ids = GLOSSAIRE.map(g => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    const terms = GLOSSAIRE.map(g => g.term)
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b, 'fr')))
  })

  it('every film chapter has its text, in increasing time order', () => {
    const times = FILM.chapters.map(c => c.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    for (const chapter of FILM.chapters)
      {expect(chapter.text.length, chapter.label).toBeGreaterThan(40)}
  })

  it('never claims what the product cannot back', () => {
    const text = allText()
    // No certification is held.
    expect(text).not.toMatch(/certifi[ée]s? (ISO|SOC|HDS)|conforme (ISO|SOC)|SecNumCloud/i)
    // Driving times are taken into account, never guaranteed.
    expect(text).not.toMatch(/garantit? (la |le )?(conformité|respect)[^.]*561/i)
    // Trackdéchets is never presented without saying it is not open in production.
    for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
      if (/connecteur Trackdéchets|Trackdéchets :/.test(sentence)) {
        expect(sentence, sentence).toMatch(/validation|pas ouvert|non ouvert/)
      }
    }
    // No invented performance figure.
    expect(text).not.toMatch(/\d+\s?% (de )?(gain|productivité|économie|kilomètres en moins)/i)
  })
})
