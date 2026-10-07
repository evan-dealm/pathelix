/**
 * Data and sessions for the k6 scenarios: one dedicated tenant (`load-test`) with 150 drivers,
 * one driver account per driver, dispatchers, an admin and a few customers — and a session
 * token for each, written to load-tests/.tokens.json (gitignored).
 *
 * Every simulated user has its own session on purpose: the application limits requests per
 * user, so 150 virtual drivers sharing one cookie measure the rate limiter, not the application.
 *
 *   npx tsx --tsconfig tsconfig.json load-tests/seed.ts          # create / refresh
 *   npx tsx --tsconfig tsconfig.json load-tests/seed.ts --clean  # remove the tenant and its data
 *
 * Refuses to touch a database that is not a test sandbox, unless LOADTEST_DB=<exact database
 * name> says so explicitly. SESSION_SECRET must be the one of the application under test.
 */
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { unscopedPrisma, getTenantDb } from '@/lib/tenantDb'
import { signSession } from '@/lib/session'

const SLUG = 'load-test'
const DRIVERS = Number(process.env.DRIVER_COUNT ?? 150)
const DISPATCHERS = Number(process.env.DISPATCHER_COUNT ?? 20)
const CLIENTS = 20
const TOKENS_FILE = join(__dirname, '.tokens.json')
const SESSION_TTL_S = 4 * 3600
const pad = (n: number) => String(n).padStart(3, '0')

function assertSafeDatabase(): void {
  const dbName = (process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop() ?? ''
  if (!dbName) throw new Error('DATABASE_URL is not set')
  if (dbName.includes('manualtest_sandbox') || process.env.LOADTEST_DB === dbName) return
  throw new Error(
    `Refusing to seed load-test data into "${dbName}". If that is really intended: LOADTEST_DB=${dbName}`,
  )
}

async function clean(): Promise<void> {
  // Tenant deletion cascades to everything it owns.
  const del = await unscopedPrisma.tenant.deleteMany({ where: { slug: SLUG } })
  rmSync(TOKENS_FILE, { force: true })
  console.log(del.count > 0 ? 'Load-test tenant removed.' : 'No load-test tenant to remove.')
}

async function seed(): Promise<void> {
  const tenant = await unscopedPrisma.tenant.upsert({
    where: { slug: SLUG },
    // ENTERPRISE: the per-plan write limits of a free account (60 writes/min for the whole
    // organisation) would cap the scenarios long before the application does.
    update: { plan: 'ENTERPRISE' },
    create: {
      name: 'Load test',
      slug: SLUG,
      trade: 'waste',
      plan: 'ENTERPRISE',
      contactEmail: 'admin@load-test.invalid',
    },
    select: { id: true },
  })
  const db = getTenantDb(tenant.id)

  await db.driver.createMany({
    skipDuplicates: true,
    data: Array.from({ length: DRIVERS }, (_, i) => ({
      id: `load-driver-${pad(i + 1)}`,
      firstName: 'Load',
      lastName: pad(i + 1),
      sector: 'Lyon',
      depotName: 'Dépôt de test',
      depotLat: 45.75,
      depotLng: 4.83,
    })) as Parameters<typeof db.driver.createMany>[0]['data'],
  })

  const accounts = [
    { email: 'admin@load-test.invalid', role: 'ADMIN' as const, driverRef: null as string | null },
    ...Array.from({ length: DISPATCHERS }, (_, i) => ({
      email: `dispatcher-${pad(i + 1)}@load-test.invalid`,
      role: 'DISPATCHER' as const,
      driverRef: null,
    })),
    ...Array.from({ length: DRIVERS }, (_, i) => ({
      email: `driver-${pad(i + 1)}@load-test.invalid`,
      role: 'DRIVER' as const,
      driverRef: `load-driver-${pad(i + 1)}`,
    })),
  ]
  await db.user.createMany({
    skipDuplicates: true,
    // No usable password: these accounts only exist through the tokens minted below.
    data: accounts.map(a => ({
      email: a.email,
      role: a.role,
      driverRef: a.driverRef,
      passwordHash: '!',
      firstName: 'Load',
      lastName: a.email.split('@')[0],
    })) as Parameters<typeof db.user.createMany>[0]['data'],
  })

  if ((await db.client.count()) < CLIENTS) {
    await db.client.createMany({
      data: Array.from({ length: CLIENTS }, (_, i) => ({
        name: `Client de charge ${pad(i + 1)}`,
      })) as Parameters<typeof db.client.createMany>[0]['data'],
    })
  }

  const users = await db.user.findMany({
    select: { id: true, email: true, role: true, driverRef: true, sessionVersion: true },
  })
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S
  const token = (u: (typeof users)[number]) =>
    signSession({
      sub: u.id,
      role: u.role.toLowerCase() as 'admin' | 'dispatcher' | 'driver',
      tenantId: tenant.id,
      trade: 'waste',
      sv: u.sessionVersion,
      exp,
      ...(u.driverRef ? { driverRef: u.driverRef } : {}),
    })
  const byEmail = [...users].sort((a, b) => a.email.localeCompare(b.email))
  const admin = byEmail.find(u => u.role === 'ADMIN')
  if (!admin) throw new Error('admin account missing')
  const out = {
    tenantId: tenant.id,
    expiresAt: new Date(exp * 1000).toISOString(),
    admin: await token(admin),
    dispatchers: await Promise.all(byEmail.filter(u => u.role === 'DISPATCHER').map(token)),
    drivers: await Promise.all(
      byEmail
        .filter(u => u.role === 'DRIVER' && u.driverRef)
        .map(async u => ({ id: u.driverRef as string, token: await token(u) })),
    ),
    clientIds: (await db.client.findMany({ select: { id: true }, take: CLIENTS })).map(c => c.id),
  }
  writeFileSync(TOKENS_FILE, JSON.stringify(out))
  console.log(
    `Load-test tenant ready: ${out.drivers.length} drivers, ${out.dispatchers.length} dispatchers, ${out.clientIds.length} customers.`,
  )
  console.log(`Sessions valid until ${out.expiresAt} → ${TOKENS_FILE}`)
}

async function main(): Promise<void> {
  assertSafeDatabase()
  try {
    if (process.argv.includes('--clean')) await clean()
    else await seed()
  } finally {
    await unscopedPrisma.$disconnect()
  }
}

// Explicit exit: importing the session module opens a Redis subscription that keeps Node alive.
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
