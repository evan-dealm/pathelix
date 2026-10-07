import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg }     from '@prisma/adapter-pg'
import { hash }          from 'bcryptjs'

export default async function globalSetup() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pathelix_fleet',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new PrismaClient({ adapter } as any)

  try {
    // ── Tenant ──────────────────────────────────────────────────────────────
    let tenant = await prisma.tenant.findUnique({ where: { slug: 'excoffier-test' } })
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: { name: 'Excoffier Test', slug: 'excoffier-test', plan: 'ENTERPRISE', trade: 'collecte_recyclage' },
      })
    } else if (!tenant.trade) {
      tenant = await prisma.tenant.update({
        where: { id: tenant.id },
        data:  { trade: 'collecte_recyclage' },
      })
    }

    // ── Admin user ──────────────────────────────────────────────────────────
    const passwordHash  = await hash('Excoffier2026!', 10)
    const existingUser  = await prisma.user.findFirst({
      where: { tenantId: tenant.id, email: 'admin@excoffier.fr' },
    })
    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data:  { passwordHash },
      })
    } else {
      await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email:    'admin@excoffier.fr',
          passwordHash,
          role:      'ADMIN',
          firstName: 'Admin',
          lastName:  'Excoffier',
        },
      })
    }

    // ── TenantSettings (requis par /admin) ──────────────────────────────────
    const existingSettings = await prisma.tenantSettings.findUnique({
      where: { tenantId: tenant.id },
    })
    if (!existingSettings) {
      await prisma.tenantSettings.create({ data: { tenantId: tenant.id } })
    }

    // ── Exutoire (requis par modals + exutoires tab) ─────────────────────────
    const existingExutoire = await prisma.exutoire.findFirst({ where: { tenantId: tenant.id } })
    if (!existingExutoire) {
      await prisma.exutoire.create({
        data: {
          tenantId:          tenant.id,
          name:              'Centre de tri test',
          address:           '1 Rue de la Paix, 75001 Paris',
          lat:               48.8698,
          lng:               2.3309,
          openingHoursOpen:  480,
          openingHoursClose: 1080,
          serviceTimeMin:    15,
        },
      })
    }

    // ── Vehicle (requis par vehicles tab) ────────────────────────────────────
    const existingVehicle = await prisma.vehicle.findFirst({ where: { tenantId: tenant.id } })
    if (!existingVehicle) {
      await prisma.vehicle.create({
        data: {
          tenantId:     tenant.id,
          licensePlate: 'AA-001-TEST',
          type:         'benne',
        },
      })
    }

    // ── Missions for today (requis par modals + missions tab) ─────────────────
    // type must be a real, user-facing MissionType — VIDER/PAUSE are synthetic
    // (VRP-generated only, see CLAUDE.md) and are filtered out of the Missions tab
    // table by SYNTHETIC_TYPES, so seeding with 'VIDER' left the table permanently
    // empty ("Aucune mission") no matter how many rows existed for today in the DB.
    const today = new Date().toISOString().split('T')[0]
    const existingMissions = await prisma.mission.findMany({
      where: { tenantId: tenant.id, date: today, type: { not: { in: ['VIDER', 'PAUSE'] } } },
    })
    if (existingMissions.length < 2) {
      const needed = 2 - existingMissions.length
      for (let i = 0; i < needed; i++) {
        await prisma.mission.create({
          data: {
            tenantId:             tenant.id,
            type:                 'POSER',
            date:                 today,
            address:              `${i + 1} Avenue de la Gare, 75002 Paris`,
            latitude:             48.87 + i * 0.01,
            longitude:            2.35  + i * 0.01,
            estimatedDurationMin: 30,
            clientName:           `Client Test ${i + 1}`,
            wasteTypeLabel:       'Déchets recyclables',
          },
        })
      }
    }

    // ── Baseline the specs rely on, restored before every run ───────────────────────────────
    // Several specs open "the first driver / vehicle / user row" or the day's routes. They used
    // to pass only as long as an earlier run had left such rows behind: one spec deletes a
    // driver, and after a few runs the tenant had none — 20 tests then failed on an empty table.
    const baselineDrivers = [
      { firstName: 'Alice', lastName: 'Martin', sector: 'Nord', depotName: 'Dépôt Nord', depotLat: 48.90, depotLng: 2.35 },
      { firstName: 'Bruno', lastName: 'Petit',  sector: 'Sud',  depotName: 'Dépôt Sud',  depotLat: 48.83, depotLng: 2.32 },
      { firstName: 'Chloé', lastName: 'Dubois', sector: 'Est',  depotName: 'Dépôt Est',  depotLat: 48.86, depotLng: 2.42 },
    ]
    const drivers = []
    for (const d of baselineDrivers) {
      const found = await prisma.driver.findFirst({ where: { tenantId: tenant.id, firstName: d.firstName, lastName: d.lastName, archived: false } })
      drivers.push(found ?? await prisma.driver.create({ data: { tenantId: tenant.id, vehicleCapacity: 2, maxBinSizeM3: 35, ...d } }))
    }
    for (const licensePlate of ['AA-002-TEST', 'AA-003-TEST']) {
      const found = await prisma.vehicle.findFirst({ where: { tenantId: tenant.id, licensePlate } })
      if (!found) await prisma.vehicle.create({ data: { tenantId: tenant.id, licensePlate, type: 'benne' } })
    }
    for (const [email, firstName] of [['exploitant1@excoffier.fr', 'Emma'], ['exploitant2@excoffier.fr', 'Hugo']] as const) {
      const found = await prisma.user.findFirst({ where: { email } })
      if (!found) await prisma.user.create({ data: { tenantId: tenant.id, email, passwordHash, role: 'DISPATCHER', firstName, lastName: 'Test' } })
    }
    // One archived mission: the Missions tab only shows its « Archives » section when there is one.
    const archived = await prisma.mission.findFirst({ where: { tenantId: tenant.id, archived: true } })
    if (!archived) {
      await prisma.mission.create({
        data: { tenantId: tenant.id, type: 'RETIRER', date: today, address: '9 rue des Archives, 75003 Paris', latitude: 48.86, longitude: 2.36, estimatedDurationMin: 20, clientName: 'Client archivé', archived: true },
      })
    }
    // A real route for today (first driver, the day's first two missions).
    const todays = await prisma.mission.findMany({
      where: { tenantId: tenant.id, date: today, archived: false, type: { not: { in: ['VIDER', 'PAUSE'] } } },
      orderBy: { createdAt: 'asc' }, take: 2,
    })
    const planned = todays.map((m, i) => ({ ...m, sequenceOrder: i + 1 }))
    const existingPlan = await prisma.plan.findFirst({ where: { tenantId: tenant.id, driverId: drivers[0].id, date: today } })
    if (!existingPlan && planned.length > 0) {
      await prisma.plan.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { tenantId: tenant.id, driverId: drivers[0].id, date: today, missions: planned as any, startTime: '07:00', speedKmh: 50 },
      })
    }

    console.log(`[E2E globalSetup] seed OK — admin@excoffier.fr (tenant: ${tenant.id})`)
  } finally {
    await prisma.$disconnect()
  }

  // ── Warmup Next.js dev server ────────────────────────────────────────────
  // Sequential warmup to avoid overwhelming the dev server with simultaneous compilations
  const BASE = 'http://localhost:3000'
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.status !== 0) break
    } catch { /* server not ready yet */ }
    await new Promise(r => setTimeout(r, 1_000))
  }

  const today = new Date().toISOString().split('T')[0]
  const warmupRoutes = [
    // Pages first (trigger Next.js page compilation)
    { url: `${BASE}/login`, method: 'GET' },
    { url: `${BASE}/admin`, method: 'GET' },
    // Auth route — compile POST handler explicitly
    { url: `${BASE}/api/auth/login`, method: 'POST', body: JSON.stringify({ email: 'warmup@test.com', password: 'warmup' }), ct: 'application/json' },
    // DataProvider routes
    { url: `${BASE}/api/drivers?limit=2000`, method: 'GET' },
    { url: `${BASE}/api/missions?date=${today}&limit=5000`, method: 'GET' },
    { url: `${BASE}/api/settings`, method: 'GET' },
    { url: `${BASE}/api/plans?date=${today}`, method: 'GET' },
    { url: `${BASE}/api/health`, method: 'GET' },
  ]
  for (const r of warmupRoutes) {
    try {
      const opts: RequestInit = { method: r.method }
      if (r.body) { opts.body = r.body; opts.headers = { 'Content-Type': r.ct ?? 'application/json' } }
      await fetch(r.url, opts)
    } catch { /* ignore */ }
    await new Promise(res => setTimeout(res, 300))
  }
  // Extra stabilization delay — lets the dev server settle after compilation burst
  await new Promise(res => setTimeout(res, 2_000))

  // ── Browser warmup — compile client-side JS bundles ────────────────────────
  // fetch() only compiles the SSR shell; the browser needs to request hundreds of
  // JS chunks before domcontentloaded fires. We launch a headless browser here so
  // those bundles are compiled once and cached for the entire test run.
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({ headless: true })
  const ctx     = await browser.newContext()
  const pg      = await ctx.newPage()
  try {
    await pg.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await new Promise(r => setTimeout(r, 1_000))
    // Login via API to get session cookie, then navigate to /admin
    const res = await ctx.request.post(`${BASE}/api/auth/login`, {
      data: { email: 'admin@excoffier.fr', password: 'Excoffier2026!' },
      headers: { 'Content-Type': 'application/json' },
    })
    if (res.ok()) {
      await pg.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await new Promise(r => setTimeout(r, 2_000))
    }
    console.log('[E2E globalSetup] browser warmup OK')
  } catch (e) {
    console.error('[E2E globalSetup] browser warmup error (non-fatal):', (e as Error).message)
  } finally {
    await browser.close()
  }

  console.log('[E2E globalSetup] server warmed up')
}
