/**
 * Weighing-ticket reading: turns the text the OCR engine saw into figures a person can confirm.
 *
 * Never trusted as is. Each figure carries the confidence of the line it was read on, and the
 * reading is flagged for review when the engine was unsure, when gross − tare does not give the
 * net, or when the net weight is implausible for a skip. The driver confirms (or corrects) on the
 * spot; flagged readings also wait for the office before billing.
 */

export interface OcrLine { text: string; /** 0–1 (Tesseract word confidences averaged). */ conf: number }
export interface OcrEngineResult { text: string; lines?: OcrLine[]; meanConfidence?: number }

export interface TicketReading {
  netKg: number | null
  grossKg: number | null
  tareKg: number | null
  ticketNumber: string | null
  /** YYYY-MM-DD when a date is printed. */
  date: string | null
  plate: string | null
  /** Confidence of the net weight figure (0–1): that is what gets billed. */
  confidence: number
  /** Human-readable reasons to double-check (French, shown as is). */
  issues: string[]
  /** True when a person must check the figures before they are used. */
  needsReview: boolean
}

/** Below this, a reading is shown as a suggestion and also waits for the office. */
export const REVIEW_CONFIDENCE = 0.8
/** A skip load beyond this is a misread (or a lorry-and-trailer total). */
const MAX_PLAUSIBLE_NET_KG = 40_000
const TOLERANCE_KG = 20

type Field = 'net' | 'gross' | 'tare'
const LABELS: Array<[Field, RegExp]> = [
  ['net', /\b(net|poids\s*net|net\s*weight|nett?o)\b/i],
  ['gross', /\b(brut|pes[ée]e?\s*1|entr[ée]e|gross|1\s*re\s*pes[ée]e)\b/i],
  ['tare', /\b(tare|pes[ée]e?\s*2|sortie|vide|2\s*e\s*pes[ée]e)\b/i],
]

/**
 * A weight written on a ticket line: "12 340 kg", "12.340 t", "12,34 T", "12340". Returns kg.
 * Thousands separators (space, dot before 3 digits followed by kg) are handled.
 */
export function parseWeightToken(raw: string): number | null {
  const m = raw.match(/(\d{1,3}(?:[ .  ]\d{3})+|\d+)(?:[.,](\d+))?\s*(kg|kgs|t|to|tonnes?)?\b/i)
  if (!m) return null
  const intPart = m[1].replace(/[ .  ]/g, '')
  const unit = (m[3] ?? '').toLowerCase()
  const value = Number(`${intPart}${m[2] ? `.${m[2]}` : ''}`)
  if (!Number.isFinite(value) || value <= 0) return null
  if (unit.startsWith('t')) return Math.round(value * 1000)
  if (unit.startsWith('kg')) return Math.round(value)
  // Bare figure: weighbridges print kg; a small decimal figure is tonnes.
  return value < 100 ? Math.round(value * 1000) : Math.round(value)
}

function toIsoDate(raw: string): string | null {
  const m = raw.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/)
  if (!m) return null
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const mo = Number(m[2]); const d = Number(m[1])
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Reads the figures of a weighbridge ticket out of OCR text. */
export function parseWeighingTicket(input: OcrEngineResult): TicketReading {
  const lines: OcrLine[] = input.lines?.length
    ? input.lines
    : input.text.split(/\r?\n/).map(text => ({ text, conf: input.meanConfidence ?? 0.5 }))
  const found: Partial<Record<Field, { kg: number; conf: number }>> = {}
  let ticketNumber: string | null = null
  let date: string | null = null
  let plate: string | null = null

  for (const line of lines) {
    const t = line.text.trim()
    if (!t) continue
    for (const [field, re] of LABELS) {
      if (found[field] || !re.test(t)) continue
      // The figure is after the label (a date or time on the same line must not be taken).
      const after = t.slice(t.search(re)).replace(re, '').replace(/\b\d{1,2}[:h]\d{2}\b/g, ' ').replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, ' ')
      const kg = parseWeightToken(after)
      if (kg !== null) { found[field] = { kg, conf: line.conf }; break }
    }
    if (!ticketNumber) {
      const m = t.match(/\b(?:ticket|bon|n[°o]|num[ée]ro|pes[ée]e\s*n[°o]?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i)
      if (m && /\d/.test(m[1])) ticketNumber = m[1]
    }
    if (!date) date = toIsoDate(t)
    if (!plate) {
      const m = t.match(/\b([A-Z]{2})[- ]?(\d{3})[- ]?([A-Z]{2})\b/)
      if (m) plate = `${m[1]}-${m[2]}-${m[3]}`
    }
  }

  const issues: string[] = []
  let netKg = found.net?.kg ?? null
  let confidence = found.net?.conf ?? 0
  const grossKg = found.gross?.kg ?? null
  const tareKg = found.tare?.kg ?? null
  if (grossKg !== null && tareKg !== null) {
    const computed = grossKg - tareKg
    if (netKg === null && computed > 0) {
      netKg = computed
      confidence = Math.min(found.gross?.conf ?? 0, found.tare?.conf ?? 0)
      issues.push('Poids net calculé (brut − tare) : il n\'est pas imprimé lisiblement')
    } else if (netKg !== null && Math.abs(computed - netKg) > TOLERANCE_KG) {
      issues.push(`Brut − tare = ${computed.toLocaleString('fr-FR')} kg, différent du net lu (${netKg.toLocaleString('fr-FR')} kg)`)
      confidence = Math.min(confidence, 0.5)
    }
  }
  if (netKg === null) issues.push('Poids net introuvable sur le ticket')
  else if (netKg > MAX_PLAUSIBLE_NET_KG) { issues.push('Poids net improbable pour une benne'); confidence = Math.min(confidence, 0.3) }
  if (netKg !== null && confidence < REVIEW_CONFIDENCE) issues.push(`Lecture incertaine (${Math.round(confidence * 100)} %)`)

  return {
    netKg, grossKg, tareKg, ticketNumber, date, plate,
    confidence: Math.round(confidence * 100) / 100,
    issues,
    needsReview: netKg === null || issues.length > 0,
  }
}

/** Reads a stored AiJob.outputData back (it is JSON from the database). */
export function readingFromJob(output: unknown): TicketReading | null {
  if (!output || typeof output !== 'object') return null
  const r = (output as { reading?: unknown }).reading
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    netKg: num(o.netKg), grossKg: num(o.grossKg), tareKg: num(o.tareKg), ticketNumber: str(o.ticketNumber), date: str(o.date), plate: str(o.plate),
    confidence: num(o.confidence) ?? 0, issues: Array.isArray(o.issues) ? o.issues.filter((x): x is string => typeof x === 'string') : [],
    needsReview: o.needsReview !== false,
  }
}
