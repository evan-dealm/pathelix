import { z } from 'zod'

/**
 * Free-text mission entry ("poser une 15 m³ chez Dupont, 12 rue des Lilas Grenoble, demain
 * entre 8h et 10h, urgent").
 *
 * Two readers, one contract:
 * - `parseMissionRules`: deterministic, always available, no network — the fallback and the
 *   baseline;
 * - an optional local LLM (Ollama), whose answer is never taken as is: every field is validated on
 *   its own (`sanitizeLlmFields`), and a client name or address that does not appear in what the
 *   user typed is dropped (`groundFields`) — a model must not invent a site, and a crafted input
 *   cannot make it do so either.
 * Nothing is ever created from here: the result prefills the mission form for a person to check.
 */

export const NL_MISSION_TYPES = ['POSER', 'RETIRER', 'ECHANGER', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR'] as const
export type NlMissionType = typeof NL_MISSION_TYPES[number]

export interface ParsedMission {
  type?: NlMissionType
  address?: string
  clientName?: string
  estimatedDurationMin?: number
  priority?: 1 | 2 | 3
  timeWindow?: { openMin: number; closeMin: number }
  notes?: string
  binSize?: string
  /** YYYY-MM-DD when the text names a day ("demain", "lundi", "12/03"). */
  date?: string
}

const FieldSchemas = {
  type: z.enum(NL_MISSION_TYPES),
  address: z.string().trim().min(5).max(200),
  clientName: z.string().trim().min(2).max(120),
  estimatedDurationMin: z.number().int().min(5).max(480),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  timeWindow: z.object({ openMin: z.number().int().min(0).max(1439), closeMin: z.number().int().min(0).max(1439) })
    .refine(w => w.closeMin > w.openMin, 'créneau inversé'),
  notes: z.string().trim().max(500),
  binSize: z.string().trim().min(1).max(30),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
} as const
type FieldName = keyof typeof FieldSchemas

const LABEL: Record<FieldName, string> = {
  type: 'type', address: 'adresse', clientName: 'client', estimatedDurationMin: 'durée', priority: 'priorité',
  timeWindow: 'créneau', notes: 'remarques', binSize: 'benne', date: 'date',
}

/** Keeps each valid field of an untrusted object; reports the ones it had to drop. */
export function sanitizeLlmFields(raw: unknown): { fields: ParsedMission; dropped: string[] } {
  const fields: Record<string, unknown> = {}
  const dropped: string[] = []
  if (!raw || typeof raw !== 'object') return { fields: {}, dropped }
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(FieldSchemas) as FieldName[]) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === '') continue
    const r = FieldSchemas[key].safeParse(obj[key])
    if (r.success) fields[key] = r.data
    else dropped.push(LABEL[key])
  }
  return { fields: fields as ParsedMission, dropped }
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Drops a client name or address whose words are not in the user's text (the model made them up).
 * Small words and digits-only tokens are ignored; most of the remaining words must be found.
 */
export function groundFields(fields: ParsedMission, sourceText: string): { fields: ParsedMission; ungrounded: string[] } {
  const src = norm(sourceText)
  const out = { ...fields }
  const ungrounded: string[] = []
  for (const key of ['clientName', 'address'] as const) {
    const v = out[key]
    if (!v) continue
    const words = norm(v).split(/[^a-z0-9]+/).filter(w => w.length >= 3 || /^\d+$/.test(w))
    if (words.length === 0) continue
    const found = words.filter(w => src.includes(w)).length
    if (found / words.length < 0.7) { delete out[key]; ungrounded.push(LABEL[key]) }
  }
  return { fields: out, ungrounded }
}

// ─── Deterministic reader ─────────────────────────────────────────────────────

const TYPE_WORDS: Array<[NlMissionType, RegExp]> = [
  ['ALLER_RETOUR', /\baller[- ]retour\b|\bvidage sur place\b|\bvider et (re)?poser\b/],
  ['ECHANGER', /\b(echang\w*|rotation|remplac\w*|benne pleine contre)\b/],
  ['DEPLACER', /\bdeplac\w*\b/],
  ['TASSER', /\btass\w*|compact\w*\b/],
  ['CHARGER_IMMEDIAT', /\bcharg\w* (immediat\w*|sur place|direct\w*)|\bchargement immediat\b/],
  ['EXPEDIER', /\bexpedi\w*\b/],
  ['RETIRER', /\b(retir\w*|enlev\w*|recup\w*|reprendre|reprise|ramass\w*)\b/],
  ['POSER', /\b(pos\w*|depos\w*|livr\w*|install\w*|amener|apporter)\b/],
]
const DEFAULT_DURATION: Partial<Record<NlMissionType, number>> = { POSER: 30, RETIRER: 30, ECHANGER: 45 }
const STREET = /(?:\d{1,4}\s*(?:bis|ter)?,?\s+)?(?:rue|avenue|av\.?|boulevard|bd|chemin|ch\.?|route|rte|all[ée]e|impasse|place|pl\.?|quai|cours|zone|za|zi|zac|lieu[- ]dit|parc|square|faubourg|voie)\b[^,;\n]*/i
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function hourToMin(h: string, m?: string): number | null {
  const hh = Number(h); const mm = m ? Number(m) : 0
  if (!Number.isInteger(hh) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Reads what it reliably can from the text; leaves the rest empty for the person to fill. */
export function parseMissionRules(text: string, refDate: string): ParsedMission {
  const t = norm(text)
  const out: ParsedMission = {}

  for (const [type, re] of TYPE_WORDS) if (re.test(t)) { out.type = type; break }
  if (out.type && DEFAULT_DURATION[out.type]) out.estimatedDurationMin = DEFAULT_DURATION[out.type]

  const bin = t.match(/\b(\d{1,2})\s*(?:m3|m³|m 3|metres? cubes?)\b/)
  if (bin) out.binSize = `${bin[1]}m3`
  else if (/\bampli\s*roll\b|\bampliroll\b/.test(t)) out.binSize = 'ampliroll'

  if (/\b(urgent\w*|tres urgent|p1|prioritaire|au plus vite|asap)\b/.test(t)) out.priority = 1
  else if (/\b(pas presse|pas urgent|basse priorite|p3|quand vous pouvez)\b/.test(t)) out.priority = 3

  const between = t.match(/\b(?:entre|de)\s*(\d{1,2})\s*h\s*(\d{2})?\s*(?:et|a|-)\s*(\d{1,2})\s*h\s*(\d{2})?/) ?? t.match(/\b(\d{1,2})\s*h\s*(\d{2})?\s*-\s*(\d{1,2})\s*h\s*(\d{2})?/)
  if (between) {
    const o = hourToMin(between[1], between[2]); const c = hourToMin(between[3], between[4])
    if (o !== null && c !== null && c > o) out.timeWindow = { openMin: o, closeMin: c }
  } else {
    const before = t.match(/\b(?:avant|au plus tard a|pour)\s*(\d{1,2})\s*h\s*(\d{2})?/)
    const after = t.match(/\b(?:apres|a partir de|des)\s*(\d{1,2})\s*h\s*(\d{2})?/)
    const c = before ? hourToMin(before[1], before[2]) : null
    const o = after ? hourToMin(after[1], after[2]) : null
    if (o !== null || c !== null) {
      const openMin = o ?? 360; const closeMin = c ?? 1080
      if (closeMin > openMin) out.timeWindow = { openMin, closeMin }
    } else if (/\b(le matin|en matinee|ce matin)\b/.test(t)) out.timeWindow = { openMin: 420, closeMin: 720 }
    else if (/\b(l'?apres[- ]midi|cet apres[- ]midi)\b/.test(t)) out.timeWindow = { openMin: 780, closeMin: 1080 }
  }

  if (/\bapres[- ]demain\b/.test(t)) out.date = addDays(refDate, 2)
  else if (/\bdemain\b/.test(t)) out.date = addDays(refDate, 1)
  else if (/\b(aujourd'?hui|ce matin|cet apres[- ]midi|ce soir)\b/.test(t)) out.date = refDate
  else {
    const dm = t.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/)
    if (dm) {
      const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(refDate.slice(0, 4))
      const iso = `${y}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`
      if (FieldSchemas.date.safeParse(iso).success && !Number.isNaN(new Date(`${iso}T12:00:00Z`).getTime()) && Number(dm[2]) <= 12 && Number(dm[1]) <= 31) {
        out.date = iso < refDate && !dm[3] ? `${y + 1}${iso.slice(4)}` : iso
      }
    } else {
      const wd = WEEKDAYS.findIndex(d => new RegExp(`\\b${d}\\b`).test(t))
      if (wd >= 0) {
        const cur = new Date(`${refDate}T12:00:00Z`).getUTCDay()
        out.date = addDays(refDate, ((wd - cur + 7) % 7) || 7)
      }
    }
  }

  // Client: "chez X" / "pour X" / "client X", up to a separator or the address.
  const client = text.match(/\b(?:chez|pour le client|client|pour)\s+([A-ZÀ-ÖØ-Ý0-9][\wÀ-ÿ&'’.\- ]{1,80}?)(?=\s*(?:,|;|\.|\bau\b|\baux\b|\ba\b|\bà\b|\bdemain\b|\baujourd|\bavant\b|\bapr[eè]s\b|\bentre\b|\burgent|\d{1,4}\s*(?:bis|ter)?,?\s+(?:rue|avenue|bd|boulevard|chemin|route|all[ée]e|impasse|place)|$))/)
  if (client) out.clientName = client[1].trim()

  const street = text.match(STREET)
  if (street) {
    // Keep the city that follows ("…, Lyon 69003" / "… Grenoble").
    const start = street.index ?? 0
    const rest = text.slice(start + street[0].length).match(/^\s*,?\s*(\d{5}\s+)?([A-ZÀ-Ý][\wÀ-ÿ'’\- ]{1,40}?)(\s+\d{5})?(?=\s*(?:,|;|\.|$|\bdemain\b|\bavant\b|\bentre\b|\burgent))/)
    const addr = `${street[0].trim()}${rest ? `, ${rest[0].replace(/^\s*,?\s*/, '').trim()}` : ''}`
    if (addr.length >= 5) out.address = addr
  }
  return out
}

/** Fields worth telling the person they still have to fill. */
export function missingFields(p: ParsedMission): string[] {
  return (['type', 'address', 'clientName'] as const).filter(k => !p[k]).map(k => LABEL[k])
}
