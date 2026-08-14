// ─── Backfill matching logic — Mission.generatedFromTemplateId ────────────────────────────
// Best-effort match of existing missions (created before this field existed) to the
// MissionTemplate that most likely generated them, using the exact recurrence occurrences
// each template ever produced. Only links a mission when the match is UNAMBIGUOUS — no
// false certainty. Pure logic, no DB access — wired to Prisma by
// prisma/backfill-generatedFromTemplateId.ts.

import { toRRule, type RecurrenceRule } from '@/workers/recurringMissionsWorker'

export interface BackfillTemplate {
  id:         string
  tenantId:   string
  address:    string
  type:       string
  clientName: string | null
  startDate:  string
  endDate:    string | null
  recurrence: unknown
}

export interface BackfillMission {
  id:         string
  tenantId:   string
  date:       string
  address:    string
  type:       string
  clientName: string | null
}

export interface BackfillResult {
  assignments: Map<string, string> // missionId -> templateId
  ambiguous:   number
  unmatched:   number
}

export function computeTemplateMatches(
  templates: BackfillTemplate[],
  candidateMissions: BackfillMission[],
  onInvalidRecurrence?: (_templateId: string, _err: unknown) => void,
): BackfillResult {
  // missionId -> Set of candidate templateIds. A mission only gets linked if it has EXACTLY
  // one candidate across ALL templates — if two different templates could plausibly have
  // generated the same mission, that's a genuine ambiguity, left null rather than guessed.
  const candidatesByMission = new Map<string, Set<string>>()

  for (const tpl of templates) {
    const recurrence = tpl.recurrence as RecurrenceRule
    const startDate   = new Date(tpl.startDate)
    const endDate     = tpl.endDate ? new Date(tpl.endDate) : new Date()

    let occurrenceDates: Set<string>
    try {
      const rrule = toRRule(recurrence, startDate, endDate)
      occurrenceDates = new Set(rrule.between(startDate, endDate, true).map(d => d.toISOString().split('T')[0]))
    } catch (err) {
      onInvalidRecurrence?.(tpl.id, err)
      continue
    }

    for (const m of candidateMissions) {
      if (m.tenantId !== tpl.tenantId) continue
      if (!occurrenceDates.has(m.date)) continue
      if (m.address !== tpl.address) continue
      if (m.type !== tpl.type) continue
      if ((m.clientName || '') !== (tpl.clientName || '')) continue

      if (!candidatesByMission.has(m.id)) candidatesByMission.set(m.id, new Set())
      candidatesByMission.get(m.id)!.add(tpl.id)
    }
  }

  const assignments = new Map<string, string>()
  let ambiguous = 0, unmatched = 0

  for (const m of candidateMissions) {
    const candidates = candidatesByMission.get(m.id)
    if (!candidates || candidates.size === 0) { unmatched++; continue }
    if (candidates.size > 1) { ambiguous++; continue }

    const [templateId] = candidates
    assignments.set(m.id, templateId)
  }

  return { assignments, ambiguous, unmatched }
}
