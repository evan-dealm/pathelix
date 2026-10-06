/**
 * Scores solver outputs with one independent judge: the current timeline simulator and its
 * regulatory audit (calcTour — what the dispatcher and the driver see). Several solution files
 * can be compared side by side (e.g. before / after a change).
 *
 *   npx tsx scripts/vrp-bench/evaluate.ts before=old.json after=new.json
 */
import { readFileSync } from 'node:fs'
import { calcTour } from '../../src/lib/algorithm'
import type { Exutoire, PlannedMission } from '../../src/lib/types'
import { benchmarkSet } from './instances'

interface Score {
  assigned: number; total: number; p1Unassigned: number; drivers: number
  km: number; hours: number; maxTourH: number
  lateStops: number; lateMin: number
  regulatory: number
  ms: number
}

function score(file: string): Record<string, Score> {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { routes: Record<string, PlannedMission[]>; unassigned: string[]; ms: number }>
  const out: Record<string, Score> = {}
  for (const inst of benchmarkSet()) {
    const sol = data[inst.name]
    if (!sol) continue
    const s: Score = { assigned: 0, total: inst.missions.length, p1Unassigned: 0, drivers: 0, km: 0, hours: 0, maxTourH: 0, lateStops: 0, lateMin: 0, regulatory: 0, ms: sol.ms }
    const p1 = new Set(inst.missions.filter(m => m.priority === 1).map(m => m.id))
    s.p1Unassigned = sol.unassigned.filter(id => p1.has(id)).length
    for (const d of inst.drivers) {
      const steps = sol.routes[d.id] ?? []
      if (steps.length === 0) continue
      s.drivers++
      s.assigned += steps.filter(m => !m.id.startsWith('_')).length
      const t = calcTour(steps, d.depotLat, d.depotLng, '07:00', 50, inst.exutoires as Exutoire[])
      s.km += t.totalRoadDistKm
      s.hours += t.totalDurationMin / 60
      s.maxTourH = Math.max(s.maxTourH, t.totalDurationMin / 60)
      for (const st of t.steps) {
        const w = st.mission.timeWindow
        if (w && !st.mission.id.startsWith('_') && st.arrivalMin > w.closeMin) { s.lateStops++; s.lateMin += st.arrivalMin - w.closeMin }
      }
      s.regulatory += t.warnings.filter(w => /CE 561/.test(w.message)).length
    }
    s.km = Math.round(s.km); s.hours = Math.round(s.hours * 10) / 10; s.maxTourH = Math.round(s.maxTourH * 10) / 10; s.lateMin = Math.round(s.lateMin)
    out[inst.name] = s
  }
  return out
}

const runs = process.argv.slice(2).map(a => { const [label, file] = a.includes('=') ? a.split('=') : [a, a]; return { label, scores: score(file) } })
const cols = ['assigned', 'p1Unassigned', 'drivers', 'km', 'hours', 'maxTourH', 'lateStops', 'lateMin', 'regulatory', 'ms'] as const
console.log(`| instance | run | ${cols.join(' | ')} |`)
console.log(`|${'---|'.repeat(cols.length + 2)}`)
for (const inst of benchmarkSet()) {
  for (const r of runs) {
    const s = r.scores[inst.name]
    if (!s) continue
    console.log(`| ${inst.name} | ${r.label} | ${cols.map(c => c === 'assigned' ? `${s.assigned}/${s.total}` : String(s[c])).join(' | ')} |`)
  }
}
console.log(JSON.stringify(Object.fromEntries(runs.map(r => [r.label, r.scores]))))
