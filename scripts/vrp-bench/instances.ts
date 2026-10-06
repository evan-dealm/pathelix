/**
 * Reproducible skip-bin instances for the VRP benchmark (seeded; no network, no database).
 * Plain object shapes on purpose: the same file runs against older versions of the solver.
 */

export interface BenchMission {
  id: string; type: string; date: string; address: string; latitude: number; longitude: number
  estimatedDurationMin: number; maneuverTimeMin: number; priority?: 1 | 2 | 3
  timeWindow?: { openMin: number; closeMin: number }; binSizeM3?: number; clientName: string
}
export interface BenchDriver { id: string; firstName: string; lastName: string; sector: string; depotName: string; depotLat: number; depotLng: number; vehicleCapacity: number; maxBinSizeM3?: number }
export interface BenchExutoire { id: string; name: string; address: string; lat: number; lng: number; openingHoursOpen: number; openingHoursClose: number; closedDays: number[]; acceptedWasteTypes: string[]; serviceTimeMin: number }
export interface Instance { name: string; date: string; missions: BenchMission[]; drivers: BenchDriver[]; exutoires: BenchExutoire[] }

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CENTER = { lat: 45.188, lng: 5.724 } // Grenoble basin
const DATE = '2026-03-17' // a Tuesday

export function makeInstance(name: string, nMissions: number, nDrivers: number, seed: number, opts: { windows?: number; p1?: number; radiusKm?: number } = {}): Instance {
  const r = rng(seed)
  const radius = (opts.radiusKm ?? 25) / 111
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const point = () => {
    const a = r() * 2 * Math.PI; const d = Math.sqrt(r()) * radius
    return { lat: CENTER.lat + d * Math.sin(a), lng: CENTER.lng + d * Math.cos(a) * 1.4 }
  }
  const types: Array<[string, number]> = [['POSER', 0.32], ['RETIRER', 0.32], ['ECHANGER', 0.26], ['ALLER_RETOUR', 0.05], ['DEPLACER', 0.05]]
  const missions: BenchMission[] = []
  for (let i = 0; i < nMissions; i++) {
    const p = point()
    let x = r(); let type = 'POSER'
    for (const [t, w] of types) { if (x < w) { type = t; break } x -= w }
    const hasWindow = r() < (opts.windows ?? 0.3)
    const open = 420 + Math.floor(r() * 6) * 60
    missions.push({
      id: `m${String(i).padStart(4, '0')}`, type, date: DATE, address: `Site ${i}`, latitude: p.lat, longitude: p.lng,
      estimatedDurationMin: type === 'ECHANGER' ? 25 : type === 'ALLER_RETOUR' ? 20 : 15, maneuverTimeMin: 5,
      priority: r() < (opts.p1 ?? 0.05) ? 1 : 2,
      ...(hasWindow ? { timeWindow: { openMin: open, closeMin: open + pick([120, 180, 240]) } } : {}),
      binSizeM3: pick([8, 10, 15, 20, 30]), clientName: `Client ${i % 37}`,
    })
  }
  const drivers: BenchDriver[] = Array.from({ length: nDrivers }, (_, i) => {
    const p = i % 2 === 0 ? { lat: 45.17, lng: 5.70 } : { lat: 45.21, lng: 5.78 }
    return { id: `d${i}`, firstName: `C${i}`, lastName: 'Bench', sector: '', depotName: i % 2 ? 'Dépôt Est' : 'Dépôt Ouest', depotLat: p.lat, depotLng: p.lng, vehicleCapacity: 1, maxBinSizeM3: 30 }
  })
  const exutoires: BenchExutoire[] = [
    { id: 'ex-nord', name: 'Centre de tri Nord', address: 'Nord', lat: 45.24, lng: 5.69, openingHoursOpen: 420, openingHoursClose: 1080, closedDays: [0], acceptedWasteTypes: [], serviceTimeMin: 15 },
    { id: 'ex-sud', name: 'ISDND Sud', address: 'Sud', lat: 45.10, lng: 5.72, openingHoursOpen: 450, openingHoursClose: 1050, closedDays: [0], acceptedWasteTypes: [], serviceTimeMin: 20 },
    { id: 'ex-est', name: 'Déchèterie pro Est', address: 'Est', lat: 45.20, lng: 5.86, openingHoursOpen: 480, openingHoursClose: 1020, closedDays: [0, 6], acceptedWasteTypes: [], serviceTimeMin: 15 },
  ]
  return { name, date: DATE, missions, drivers, exutoires }
}

/** The benchmark set: sizes a haulier actually runs, plus a tight-window and a sparse case. */
export function benchmarkSet(): Instance[] {
  return [
    makeInstance('S-20x3', 20, 3, 11),
    makeInstance('M-50x6', 50, 6, 22),
    makeInstance('M-50x6-windows', 50, 6, 33, { windows: 0.8 }),
    makeInstance('L-100x10', 100, 10, 44),
    makeInstance('L-100x8-rural', 100, 8, 55, { radiusKm: 45 }),
    makeInstance('XL-200x18', 200, 18, 66, { p1: 0.08 }),
  ]
}
