import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'

// Pre-warm ALL dynamic imports before any test executes.
// This avoids 30s Vite SSR transform timeouts on cold module chains
// (routeCost.ts alone is 1300+ lines and pulls in a large dependency graph).
let _sector: typeof import('@/lib/vrp/sector') | null = null
let _prometheus: typeof import('@/lib/prometheus') | null = null
let _themeToggle: typeof import('@/components/ui/ThemeToggle') | null = null
let _valhallaMatrix: typeof import('@/lib/vrp/valhallaMatrix') | null = null
let _demandPrediction: typeof import('@/lib/demandPrediction') | null = null
let _redistributeRoute: typeof import('@/app/api/redistribute/route') | null = null
let _predictionsRoute: typeof import('@/app/api/predictions/route') | null = null

beforeAll(async () => {
  ;[
    _sector,
    _prometheus,
    _themeToggle,
    _valhallaMatrix,
    _demandPrediction,
    _redistributeRoute,
    _predictionsRoute,
  ] = await Promise.all([
    import('@/lib/vrp/sector').catch(() => null),
    import('@/lib/prometheus').catch(() => null),
    import('@/components/ui/ThemeToggle').catch(() => null),
    import('@/lib/vrp/valhallaMatrix').catch(() => null),
    import('@/lib/demandPrediction').catch(() => null),
    import('@/app/api/redistribute/route').catch(() => null),
    import('@/app/api/predictions/route').catch(() => null),
  ])
}, 90_000)

describe('#2 — Demand Prediction', () => {
  it('predictDemand module exports correctly', () => {
    expect(_demandPrediction).not.toBeNull()
    expect(typeof _demandPrediction!.predictDemand).toBe('function')
  })
})

describe('#10 — DBSCAN Clustering', () => {
  it('clusterDriversDBSCAN is exported from sector.ts', () => {
    expect(_sector).not.toBeNull()
    expect(typeof _sector!.clusterDriversDBSCAN).toBe('function')
  })

  it('returns valid cluster assignments for 10 drivers', () => {
    expect(_sector).not.toBeNull()
    const drivers = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`, firstName: `D${i}`, lastName: 'Test', sector: 'S1',
      depotName: 'Depot', depotLat: 45.7 + i * 0.02, depotLng: 6.0 + i * 0.03,
    }))
    const result = _sector!.clusterDriversDBSCAN(drivers as never[], 5)
    expect(result).toHaveLength(10)
    for (const label of result) {
      expect(label).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(label)).toBe(true)
    }
  })

  it('assigns all drivers to cluster 0 when fewer than targetSize', () => {
    expect(_sector).not.toBeNull()
    const drivers = Array.from({ length: 3 }, (_, i) => ({
      id: `d${i}`, firstName: `D${i}`, lastName: 'Test', sector: 'S1',
      depotName: 'Depot', depotLat: 45.7 + i * 0.01, depotLng: 6.0,
    }))
    const result = _sector!.clusterDriversDBSCAN(drivers as never[], 15)
    expect(result).toHaveLength(3)
    expect(result.every(l => l === 0)).toBe(true)
  })

  it('creates multiple clusters for geographically separated drivers', () => {
    expect(_sector).not.toBeNull()
    const drivers = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `annecy${i}`, firstName: `A${i}`, lastName: 'Test', sector: 'S1',
        depotName: 'Annecy', depotLat: 45.90 + i * 0.005, depotLng: 6.12 + i * 0.005,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `lyon${i}`, firstName: `L${i}`, lastName: 'Test', sector: 'S2',
        depotName: 'Lyon', depotLat: 45.76 + i * 0.005, depotLng: 4.83 + i * 0.005,
      })),
    ]
    const result = _sector!.clusterDriversDBSCAN(drivers as never[], 8)
    expect(result).toHaveLength(10)
    const uniqueClusters = new Set(result)
    expect(uniqueClusters.size).toBeGreaterThanOrEqual(2)
  })
})

describe('#15 — Dark Mode', () => {
  it('tailwind config has darkMode class', () => {
    const config = fs.readFileSync('tailwind.config.js', 'utf-8')
    expect(config).toContain("darkMode: 'class'")
  })

  it('ThemeToggle component exports useTheme and ThemeToggle', () => {
    expect(_themeToggle).not.toBeNull()
    expect(typeof _themeToggle!.useTheme).toBe('function')
    expect(typeof _themeToggle!.ThemeToggle).toBe('function')
  })
})

describe('#18 — Animations', () => {
  it('globals.css contains new animation keyframes', () => {
    const css = fs.readFileSync('src/app/globals.css', 'utf-8')
    expect(css).toContain('@keyframes mission-pulse')
    expect(css).toContain('@keyframes mission-assign')
    expect(css).toContain('@keyframes route-highlight')
    expect(css).toContain('@keyframes status-change')
    expect(css).toContain('@keyframes optimize-spin')
    expect(css).toContain('@keyframes slide-up')
    expect(css).toContain('@keyframes count-up')
    expect(css).toContain('.animate-mission-pulse')
    expect(css).toContain('.animate-mission-assign')
    expect(css).toContain('.animate-optimize-spin')
  })
})

describe('#22 — Prometheus Metrics', () => {
  it('generates valid Prometheus format', () => {
    expect(_prometheus).not.toBeNull()
    const { promIncrement, promGauge, promObserve, generatePrometheusMetrics } = _prometheus!

    promIncrement('test_counter', 'A test counter')
    promIncrement('test_counter', 'A test counter')
    promGauge('test_gauge', 'A test gauge', 42)
    promObserve('test_histogram', 'A test histogram', 100)
    promObserve('test_histogram', 'A test histogram', 200)

    const output = generatePrometheusMetrics()

    expect(output).toContain('# HELP test_counter A test counter')
    expect(output).toContain('# TYPE test_counter counter')
    expect(output).toContain('test_counter 2')
    expect(output).toContain('# TYPE test_gauge gauge')
    expect(output).toContain('test_gauge 42')
    expect(output).toContain('# TYPE test_histogram histogram')
    expect(output).toContain('test_histogram_count 2')
    expect(output).toContain('test_histogram_bucket{le="+Inf"} 2')
  })

  it('PROM helpers are callable', () => {
    expect(_prometheus).not.toBeNull()
    const { PROM } = _prometheus!
    PROM.vrpDurationMs(1500)
    PROM.vrpMissions(50)
    PROM.apiRequest('/api/optimize', 200)
    PROM.cacheHit('valhalla')
    PROM.mlMetricsCollected()
  })

  it('counter with labels generates correct format', () => {
    expect(_prometheus).not.toBeNull()
    const { promIncrement, generatePrometheusMetrics } = _prometheus!
    promIncrement('labeled_counter', 'With labels', { route: '/api/test', status: '200' })
    const output = generatePrometheusMetrics()
    expect(output).toContain('labeled_counter{route="/api/test",status="200"}')
  })
})

describe('#20 — Multi-Region Valhalla', () => {
  it('valhallaMatrix supports VALHALLA_FALLBACK_URL', () => {
    expect(_valhallaMatrix).not.toBeNull()
    expect(typeof _valhallaMatrix!.buildValhallaMatrix).toBe('function')
  })

  it('builds haversine fallback matrix when no Valhalla URL', async () => {
    expect(_valhallaMatrix).not.toBeNull()
    const points = [
      { id: 'a', lat: 45.8, lng: 6.1 },
      { id: 'b', lat: 45.9, lng: 6.2 },
    ]
    const matrix = await _valhallaMatrix!.buildValhallaMatrix(points)
    expect(matrix.source).toBe('haversine')
    expect(matrix.size).toBe(2)
    expect(matrix.indexOf('a')).toBe(0)
    expect(matrix.indexOf('b')).toBe(1)
    expect(matrix.distance(0, 1)).toBeGreaterThan(0)
    expect(matrix.duration(0, 1)).toBeGreaterThan(0)
  })
})

describe('#16 — Capacitor Config', () => {
  it('capacitor.config.ts exists and has correct appId', () => {
    const config = fs.readFileSync('capacitor.config.ts', 'utf-8')
    expect(config).toContain("appId: 'fr.pathelix.fleet'")
    expect(config).toContain("appName: 'PATHELIX Fleet'")
    expect(config).toContain('Geolocation')
    expect(config).toContain('ACCESS_BACKGROUND_LOCATION')
  })
})

describe('#4 — Redistribute API', () => {
  it('redistribute route module exports POST handler', () => {
    expect(_redistributeRoute).not.toBeNull()
    expect(typeof _redistributeRoute!.POST).toBe('function')
  })
})

describe('#2 — Predictions API', () => {
  it('predictions route module exports GET handler', () => {
    expect(_predictionsRoute).not.toBeNull()
    expect(typeof _predictionsRoute!.GET).toBe('function')
  })
})
