// ─── seed-fleetmap-e2e.ts — Additive seed for the FleetMap E2E validation scenario ──────────
// Creates a small, dedicated tenant with real drivers/missions/exutoire/plan so
// e2e/fleetmap-validation.spec.ts can verify FleetMap against actual assigned tournées instead
// of an empty/near-empty tenant. Additive (upsert-by-slug), never wipes existing data — safe
// to run repeatedly. MUST be run via scripts/db-guard.sh against the sandbox DB, never prod.
//
// Usage:
//   export DATABASE_URL=... (manualtest_sandbox_never_prod)
//   scripts/db-guard.sh npx tsx scripts/seed-fleetmap-e2e.ts

import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg }     from '@prisma/adapter-pg'
import { hash }          from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma  = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding FleetMap E2E tenant...')

  let tenant = await prisma.tenant.findUnique({ where: { slug: 'fleetmap-e2e' } })
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: 'FleetMap E2E', slug: 'fleetmap-e2e', plan: 'ENTERPRISE', trade: 'collecte_recyclage' },
    })
  }
  const T = tenant.id

  const passwordHash = await hash('FleetMapE2E2026!', 10)
  const existingAdmin = await prisma.user.findFirst({ where: { tenantId: T, email: 'admin@fleetmap-e2e.test' } })
  if (!existingAdmin) {
    await prisma.user.create({
      data: { tenantId: T, email: 'admin@fleetmap-e2e.test', passwordHash, role: 'ADMIN', firstName: 'E2E', lastName: 'Admin' },
    })
  }

  // ── Drivers (3, real depot coordinates around Paris) ──────────────────────────────────────
  const driverDefs = [
    { firstName: 'Alice', lastName: 'Martin', depotName: 'Depot Nord', depotLat: 48.8900, depotLng: 2.3500 },
    { firstName: 'Bruno', lastName: 'Petit',   depotName: 'Depot Sud',  depotLat: 48.8300, depotLng: 2.3200 },
    { firstName: 'Chloe', lastName: 'Dubois',  depotName: 'Depot Est',  depotLat: 48.8600, depotLng: 2.4200 },
  ]
  const drivers = []
  for (const d of driverDefs) {
    let driver = await prisma.driver.findFirst({ where: { tenantId: T, firstName: d.firstName, lastName: d.lastName } })
    driver ??= await prisma.driver.create({
      data: { tenantId: T, sector: 'Paris', vehicleCapacity: 2, maxBinSizeM3: 35, ...d },
    })
    drivers.push(driver)
  }

  // ── Exutoire ────────────────────────────────────────────────────────────────────────────
  let exutoire = await prisma.exutoire.findFirst({ where: { tenantId: T, name: 'Centre E2E' } })
  exutoire ??= await prisma.exutoire.create({
    data: {
      tenantId: T, name: 'Centre E2E', address: '1 Rue Test, Paris',
      lat: 48.8566, lng: 2.3522, openingHoursOpen: 420, openingHoursClose: 1080,
      closedDays: [0], acceptedWasteTypes: ['DIB'], serviceTimeMin: 20,
    },
  })

  // ── Missions (real, non-synthetic — 2 assigned to Alice's plan, 1 left unassigned) ────────
  const today = new Date().toISOString().split('T')[0]
  const missionDefs = [
    { clientName: 'Client E2E Un', address: '10 Avenue Test, Paris', latitude: 48.8920, longitude: 2.3550, type: 'ECHANGER' as const },
    { clientName: 'Client E2E Deux', address: '20 Boulevard Test, Paris', latitude: 48.8950, longitude: 2.3600, type: 'RETIRER' as const },
    { clientName: 'Client E2E Trois (pool)', address: '30 Rue Test, Paris', latitude: 48.8400, longitude: 2.3100, type: 'ECHANGER' as const },
  ]
  const missions = []
  for (const m of missionDefs) {
    let mission = await prisma.mission.findFirst({ where: { tenantId: T, clientName: m.clientName, date: today } })
    mission ??= await prisma.mission.create({
      data: {
        tenantId: T, date: today, estimatedDurationMin: 20, maneuverTimeMin: 10,
        priority: 2, linkedExutoireId: exutoire.id, ...m,
      },
    })
    missions.push(mission)
  }

  // ── Plan (real tournée for Alice, today, 2 planned missions) ──────────────────────────────
  const plannedMissions = missions.slice(0, 2).map((m, i) => ({
    ...m,
    sequenceOrder: i + 1,
  }))
  const existingPlan = await prisma.plan.findFirst({ where: { tenantId: T, driverId: drivers[0].id, date: today } })
  if (existingPlan) {
    await prisma.plan.update({ where: { id: existingPlan.id }, data: { missions: plannedMissions } })
  } else {
    await prisma.plan.create({
      data: { tenantId: T, driverId: drivers[0].id, date: today, missions: plannedMissions, startTime: '07:00', speedKmh: 50 },
    })
  }

  console.log('Done.')
  console.log(`  Tenant: ${T} (fleetmap-e2e)`)
  console.log(`  Admin: admin@fleetmap-e2e.test / FleetMapE2E2026!`)
  console.log(`  Drivers: ${drivers.map(d => `${d.firstName} ${d.lastName} (${d.id})`).join(', ')}`)
  console.log(`  Missions: ${missions.length} (2 planned for ${drivers[0].firstName}, 1 in pool)`)
  console.log(`  Today: ${today}`)
}

main()
  .catch(e => { console.error('Seed failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
