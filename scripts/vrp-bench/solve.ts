/**
 * Solves the benchmark instances with the solver of the tree it runs in and writes each driver's
 * plan as produced (dump trips and breaks included) to the JSON file given as argument.
 *
 * Time budget = what /api/optimize gives an instance of that size in production (the search and
 * its final local search are time-bound), haversine distances (no routing service), fixed seed
 * per run: `BENCH_SEED` lets several runs measure the spread.
 *
 *   VALHALLA_URL= BENCH_SEED=42 npx tsx scripts/vrp-bench/solve.ts out.json
 */
import { writeFileSync } from 'node:fs'
import { runVRP } from '../../src/lib/vrp/index'
import { benchmarkSet } from './instances'

/** Same rule as /api/optimize (autoTimeBudget). */
function productionBudget(n: number): number {
  const instanceMin = n < 20 ? 2_000 : n < 50 ? 5_000 : n < 200 ? 10_000 : 15_000
  return Math.min(120_000, Math.max(instanceMin, Math.ceil(n / 200) * 1_000))
}

async function main() {
  const out = process.argv[2] ?? 'vrp-bench-solutions.json'
  const seed = Number(process.env.BENCH_SEED ?? 42)
  const results: Record<string, { routes: Record<string, unknown[]>; unassigned: string[]; ms: number; budgetMs: number; seed: number }> = {}
  for (const inst of benchmarkSet()) {
    const t0 = Date.now()
    const budgetMs = productionBudget(inst.missions.length)
    // Plain shapes cast to the solver's own types (they differ across versions).
    const res = await runVRP(inst.missions as never, inst.drivers as never, inst.exutoires as never, inst.date, {
      seed, timeBudgetMs: budgetMs, defaultStartTime: '07:00', defaultSpeedKmh: 50,
    })
    results[inst.name] = {
      routes: res.assignments as Record<string, unknown[]>,
      unassigned: (res.unassignedMissions as Array<{ id: string }>).map(m => m.id),
      ms: Date.now() - t0, budgetMs, seed,
    }
    process.stderr.write(`${inst.name}: ${Date.now() - t0} ms\n`)
  }
  writeFileSync(out, JSON.stringify(results))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
