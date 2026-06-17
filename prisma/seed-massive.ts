// ─── seed-massive.ts — Stress-test industriel Pathélix ─────────────────────────
//
// Génère une base réaliste à l'échelle pour un seul tenant :
//   - 1 000 chauffeurs + véhicules
//   - 5 000 clients, 10 000 sites
//   - 100 exutoires (horaires stricts, types de déchets)
//   - 50 000 missions sur 3 jours
//
// Edge cases VRP injectés :
//   - 5% missions P1 (urgentes, deadline 10h)
//   - 15% missions avec time windows serrées
//   - Cohérence HFVRP (binSizeM3 ↔ maxBinSizeM3 ↔ acceptedWasteTypes)
//   - Dépendances inter-missions (POSER → RETIRER)
//
// Géographie : bounding box Auvergne-Rhône-Alpes (lat 45.0–46.5, lng 5.5–6.5)
//
// Usage : npx tsx prisma/seed-massive.ts
//
// Anti-crash : batching 2000-5000 par lot, logs de progression, GC hints.

import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg }     from '@prisma/adapter-pg'
import { hash }         from 'bcryptjs'
import { config }       from 'dotenv'
config({ path: '.env.local' })
config()

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pathelix',
})
const prisma = new PrismaClient({ adapter })

// ─── Configuration ─────────────────────────────────────────────────────────────

const NUM_DRIVERS        = 150
const NUM_CLIENTS        = 200
const NUM_SITES          = 400
const NUM_EXUTOIRES      = 25
const NUM_MISSIONS       = 1_500   // ~500/jour sur 3 jours
const MISSION_DAYS       = 3
const BATCH_SIZE         = 500

// Bounding box Auvergne-Rhône-Alpes
const LAT_MIN = 45.0,  LAT_MAX = 46.5
const LNG_MIN = 5.5,   LNG_MAX = 6.5

// Dépôts principaux (villes réelles dans la zone Auvergne-Rhône-Alpes)
const DEPOTS = [
  { name: 'Dépôt Annecy',       lat: 45.899, lng: 6.129 },
  { name: 'Dépôt Chambéry',     lat: 45.566, lng: 5.921 },
  { name: 'Dépôt Grenoble',     lat: 45.188, lng: 5.724 },
  { name: 'Dépôt Aix-les-Bains',lat: 45.688, lng: 5.917 },
  { name: 'Dépôt Albertville',   lat: 45.676, lng: 6.393 },
  { name: 'Dépôt Rumilly',      lat: 45.867, lng: 5.944 },
  { name: 'Dépôt Thonon',       lat: 46.371, lng: 6.480 },
  { name: 'Dépôt Cluses',       lat: 46.060, lng: 6.579 },
  { name: 'Dépôt Bonneville',   lat: 46.079, lng: 6.404 },
  { name: 'Dépôt Sallanches',   lat: 45.934, lng: 6.631 },
  { name: 'Dépôt Bellegarde',   lat: 46.109, lng: 5.827 },
  { name: 'Dépôt Divonne',      lat: 46.356, lng: 6.139 },
  { name: 'Dépôt La Roche',     lat: 45.861, lng: 6.115 },
  { name: 'Dépôt Voiron',       lat: 45.365, lng: 5.591 },
  { name: 'Dépôt Moûtiers',     lat: 45.485, lng: 6.532 },
]

const SECTORS = [
  'Annecy Nord', 'Annecy Sud', 'Chambéry Centre', 'Chambéry Est',
  'Grenoble Nord', 'Grenoble Sud', 'Haute-Savoie Nord', 'Haute-Savoie Sud',
  'Tarentaise', 'Bauges', 'Chartreuse', 'Grésivaudan',
  'Avant-Pays', 'Chablais', 'Genevois', 'Albanais',
  'Faucigny', 'Maurienne', 'Belledonne', 'Vercors',
]

const WASTE_TYPES = [
  'DIB', 'Gravats', 'Bois', 'Papier Carton', 'Ferraille',
  'Végétaux', 'Encombrants', 'Plâtre', 'Amiante',
  'Déchets dangereux', 'Terres inertes', 'DEEE',
]

const MISSION_TYPES = [
  'POSER', 'RETIRER', 'ECHANGER',
] as const

const BIN_SIZES_M3 = [8, 10, 15, 20, 25, 30, 35, 40]
const EQUIPMENT_TYPES = ['ampliroll', 'grue', 'polybenne', 'multibenne', 'compacteur']

const VEHICLE_BRANDS = ['Renault', 'Volvo', 'Scania', 'DAF', 'MAN', 'Mercedes', 'Iveco']
const VEHICLE_MODELS: Record<string, string[]> = {
  Renault:  ['T480', 'C460', 'D Wide', 'K520'],
  Volvo:    ['FH 500', 'FM 420', 'FMX 460'],
  Scania:   ['R450', 'G410', 'P280'],
  DAF:      ['XF 480', 'CF 340'],
  MAN:      ['TGX 18.510', 'TGS 26.400'],
  Mercedes: ['Actros 2545', 'Arocs 3251'],
  Iveco:    ['Stralis 480', 'Trakker 410'],
}

const FIRST_NAMES = [
  'Jean', 'Pierre', 'Michel', 'André', 'Philippe', 'Alain', 'Jacques', 'Bernard',
  'Julien', 'Nicolas', 'Sébastien', 'Christophe', 'Stéphane', 'David', 'Laurent',
  'Maxime', 'Antoine', 'Thomas', 'Alexandre', 'Romain', 'Florian', 'Yann', 'Hugo',
  'Mathieu', 'Clément', 'Paul', 'Lucas', 'Gabriel', 'Théo', 'Raphaël', 'Léo',
  'Nathan', 'Éric', 'Patrick', 'Daniel', 'Gérard', 'François', 'Olivier', 'Marc',
  'Fabien', 'Cédric', 'Bruno', 'Thierry', 'Pascal', 'Frédéric', 'Vincent', 'Kevin',
]

const LAST_NAMES = [
  'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand',
  'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David',
  'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier',
  'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Garnier', 'Faure',
  'Rousseau', 'Blanc', 'Guérin', 'Muller', 'Henry', 'Roussel', 'Nicolas', 'Perrin',
  'Morin', 'Mathieu', 'Clément', 'Gauthier', 'Dumont', 'Lopez', 'Fontaine', 'Chevalier',
]

const CLIENT_PREFIXES = [
  'BTP', 'Menuiserie', 'Charpente', 'Maçonnerie', 'Démolition', 'Rénovation',
  'Paysages', 'Toitures', 'Terrassement', 'Scierie', 'Recyclage', 'Industries',
  'Couverture', 'Travaux', 'Construction', 'Bâtiment', 'Carrelage', 'Électricité',
  'Plomberie', 'Ferblanterie', 'Métallerie', 'Isolation', 'Béton', 'Granulats',
]

const SITE_TYPES = [
  'Chantier', 'Entrepôt', 'Usine', 'Centre commercial', 'Parking',
  'Immeuble', 'Lotissement', 'Zone industrielle', 'Déchetterie',
  'Station', 'Bâtiment public', 'Hôpital', 'École', 'Gare',
]

const TOWNS = [
  'Annecy', 'Chambéry', 'Grenoble', 'Aix-les-Bains', 'Albertville',
  'Rumilly', 'Thonon-les-Bains', 'Cluses', 'Bonneville', 'Sallanches',
  'La Roche-sur-Foron', 'Voiron', 'Moûtiers', 'Saint-Jean-de-Maurienne',
  'Ugine', 'Faverges', 'Cran-Gevrier', 'Seynod', 'Meythet', 'Pringy',
  'Saint-Julien-en-Genevois', 'Gaillard', 'Annemasse', 'Évian-les-Bains',
  'Chamonix', 'Megève', 'Crolles', 'Montmélian', 'Saint-Alban-Leysse',
  'Cognin', 'Barberaz', 'Échirolles', 'Meylan', 'Saint-Martin-d\'Hères',
  'Pontcharra', 'Le Bourget-du-Lac', 'Voglans', 'Viviers-du-Lac',
]

const EXUTOIRE_NAMES = [
  'Centre de Tri', 'Plateforme de Recyclage', 'ISDND', 'Déchetterie Pro',
  'Centre de Valorisation', 'Écosite', 'Plateforme Bois', 'Carrière',
  'Installation de Stockage', 'Centre de Compostage',
]

// ─── PRNG déterministe (xorshift32) — zéro dépendance externe ────────────────

class Rng {
  private s: number
  constructor(seed = 42) { this.s = seed >>> 0 || 1 }
  next(): number {
    this.s ^= this.s << 13
    this.s ^= this.s >> 17
    this.s ^= this.s << 5
    return (this.s >>> 0) / 0x100000000
  }
  int(max: number): number { return Math.floor(this.next() * max) }
  pick<T>(arr: readonly T[]): T { return arr[this.int(arr.length)] }
  lat(): number { return LAT_MIN + this.next() * (LAT_MAX - LAT_MIN) }
  lng(): number { return LNG_MIN + this.next() * (LNG_MAX - LNG_MIN) }
  /** Point GPS avec cluster autour d'un dépôt (sigma ~0.15°) */
  clusteredPoint(depot: { lat: number; lng: number }): { lat: number; lng: number } {
    const sigma = 0.15
    // Box-Muller pour distribution gaussienne
    const u1 = Math.max(1e-10, this.next())
    const u2 = this.next()
    const r = Math.sqrt(-2 * Math.log(u1)) * sigma
    const theta = 2 * Math.PI * u2
    return {
      lat: Math.max(LAT_MIN, Math.min(LAT_MAX, depot.lat + r * Math.cos(theta))),
      lng: Math.max(LNG_MIN, Math.min(LNG_MAX, depot.lng + r * Math.sin(theta))),
    }
  }
  /** ID unique pseudo-aléatoire (cuid-like) */
  id(prefix = ''): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let s = prefix
    for (let i = 0; i < 20; i++) s += chars[this.int(chars.length)]
    return s
  }
  /** Plaque d'immatriculation FR */
  plate(): string {
    const l = () => String.fromCharCode(65 + this.int(26))
    const d = () => String(this.int(10))
    return `${l()}${l()}-${d()}${d()}${d()}-${l()}${l()}`
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function pad2(n: number): string { return String(n).padStart(2, '0') }

function dateStr(daysOffset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysOffset)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Insert par lots avec progression */
async function batchInsert<T>(
  label: string,
  items: T[],
  inserter: (batch: T[]) => Promise<void>,
  batchSize = BATCH_SIZE,
): Promise<void> {
  const total = items.length
  for (let i = 0; i < total; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    await inserter(batch)
    const done = Math.min(i + batchSize, total)
    console.log(`  ${label}: ${done}/${total}`)
    // Hint GC entre les lots
    if (global.gc) global.gc()
  }
}

// ─── Seed principal ────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now()
  const rng = new Rng(2024_06_21)

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  SEED MASSIF — Pathélix Stress Test')
  console.log(`  ${NUM_DRIVERS} chauffeurs, ${NUM_MISSIONS} missions, ${NUM_EXUTOIRES} exutoires`)
  console.log(`  Zone: Auvergne-Rhône-Alpes (${LAT_MIN}-${LAT_MAX}, ${LNG_MIN}-${LNG_MAX})`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // ── 0. Nettoyage ────────────────────────────────────────────────────────────
  console.log('\n[0/9] Nettoyage de la base...')
  await prisma.auditLog.deleteMany()
  await prisma.driverUnavailability.deleteMany()
  await prisma.holiday.deleteMany()
  await prisma.tenantSettings.deleteMany()
  await prisma.siteProduct.deleteMany()
  await prisma.clientSite.deleteMany()
  await prisma.vehicle.deleteMany()
  await prisma.plan.deleteMany()
  await prisma.tourHistory.deleteMany()
  await prisma.mission.deleteMany()
  await prisma.exutoire.deleteMany()
  await prisma.site.deleteMany()
  await prisma.client.deleteMany()
  await prisma.driver.deleteMany()
  await prisma.user.deleteMany()
  await prisma.tenant.deleteMany()
  console.log('  OK — base vide')

  // ── 1. Tenant + Admin + Settings ──────────────────────────────────────────
  console.log('\n[1/9] Création du tenant...')
  const tenantId = rng.id('t_')
  await prisma.tenant.create({
    data: { id: tenantId, name: 'Pathélix', slug: 'pathelix-massive', plan: 'ENTERPRISE' },
  })
  const adminPwHash = await hash('admin1234', 10)
  await prisma.user.create({
    data: {
      tenantId, email: 'admin@pathelix-massive.test', passwordHash: adminPwHash,
      role: 'ADMIN', firstName: 'Admin', lastName: 'Test',
    },
  })
  await prisma.tenantSettings.create({
    data: {
      tenantId, defaultSpeedKmh: 45, defaultStartTime: '06:30',
      maxWorkDayMin: 600, pauseAfterMin: 270, pauseDurationMin: 45,
      costPerKm: 0.38, fuelCostPerLiter: 1.92, consumptionLPer100: 34,
      companyDisplayName: 'Pathélix (Stress Test)',
    },
  })
  console.log(`  Tenant: ${tenantId}`)

  // ── 2. Exutoires (100) ──────────────────────────────────────────────────────
  console.log('\n[2/15] Génération des exutoires...')
  const exutoireIds: string[] = []
  // Chaque exutoire accepte 2-4 types de déchets
  const exutoireWasteMap: Map<string, string[]> = new Map()

  const exutoireData = Array.from({ length: NUM_EXUTOIRES }, (_, i) => {
    const id = rng.id('exu_')
    exutoireIds.push(id)
    const depot = rng.pick(DEPOTS)
    const pt = rng.clusteredPoint(depot)
    // Horaires d'ouverture réalistes : 6h-18h ou 7h-17h ou 5h30-19h
    const openHour = rng.pick([330, 360, 390, 420])  // 5h30, 6h, 6h30, 7h
    const closeHour = rng.pick([1020, 1050, 1080, 1140])  // 17h, 17h30, 18h, 19h
    const closedDays = rng.next() < 0.8 ? [0] : [0, 6]  // dimanche, parfois samedi
    // 2-4 types de déchets acceptés
    const nTypes = 2 + rng.int(3)
    const accepted: string[] = []
    for (let t = 0; t < nTypes; t++) {
      const w = rng.pick(WASTE_TYPES)
      if (!accepted.includes(w)) accepted.push(w)
    }
    exutoireWasteMap.set(id, accepted)

    const town = rng.pick(TOWNS)
    const nameBase = rng.pick(EXUTOIRE_NAMES)

    return {
      id, tenantId,
      name: `${nameBase} ${town} ${i + 1}`,
      address: `ZI ${town}, ${rng.int(200)} rue des ${rng.pick(['Acacias', 'Lilas', 'Peupliers', 'Chênes', 'Tilleuls'])}`,
      lat: pt.lat, lng: pt.lng,
      openingHoursOpen: openHour,
      openingHoursClose: closeHour,
      closedDays: JSON.stringify(closedDays),
      acceptedWasteTypes: JSON.stringify(accepted),
      serviceTimeMin: rng.pick([10, 15, 15, 20, 20, 25, 30]),
    }
  })

  await prisma.exutoire.createMany({ data: exutoireData })
  console.log(`  ${exutoireData.length} exutoires créés`)

  // ── 3. Chauffeurs + Véhicules (1000) ────────────────────────────────────────
  console.log('\n[3/15] Génération des chauffeurs + véhicules...')
  const driverIds: string[] = []
  const driverMaxBins: Map<string, number> = new Map()

  const driverData: Array<Record<string, unknown>> = []
  const vehicleData: Array<Record<string, unknown>> = []

  for (let i = 0; i < NUM_DRIVERS; i++) {
    const id = rng.id('drv_')
    driverIds.push(id)
    const depot = DEPOTS[i % DEPOTS.length]
    const sector = SECTORS[i % SECTORS.length]
    // Benne max : 70% des chauffeurs acceptent toutes les tailles, 30% sont limités
    const maxBin = rng.next() < 0.7 ? 40 : rng.pick([15, 20, 25, 30])
    const capacity = rng.pick([1, 1, 1, 1, 1, 2])  // 80% = 1 benne, 20% = 2 bennes
    driverMaxBins.set(id, maxBin)

    // Léger bruit sur la position du dépôt (~1km)
    const depotLat = depot.lat + (rng.next() - 0.5) * 0.02
    const depotLng = depot.lng + (rng.next() - 0.5) * 0.02

    driverData.push({
      id, tenantId,
      firstName: rng.pick(FIRST_NAMES),
      lastName: `${rng.pick(LAST_NAMES)}-${i + 1}`,
      sector,
      depotName: depot.name,
      depotLat, depotLng,
      maxBinSizeM3: maxBin,
      vehicleCapacity: capacity,
      weeklyHoursMax: rng.pick([40, 42, 44, 46, 48]),
      phone: `+33 6 ${pad2(rng.int(100))} ${pad2(rng.int(100))} ${pad2(rng.int(100))} ${pad2(rng.int(100))}`,
      skills: JSON.stringify(rng.next() < 0.3 ? ['grue', 'amiante'] : []),
    })

    // Véhicule associé
    const brand = rng.pick(VEHICLE_BRANDS)
    vehicleData.push({
      id: rng.id('veh_'),
      tenantId,
      licensePlate: rng.plate(),
      type: rng.pick(['ampliroll', 'polybenne', 'multibenne']),
      brand,
      model: rng.pick(VEHICLE_MODELS[brand]),
      capacityM3: maxBin,
      maxBins: capacity,
      mileageKm: 50000 + rng.int(200000),
      assignedDriverId: id,
      status: 'active',
    })
  }

  await batchInsert('Chauffeurs', driverData, async (batch) => {
    await prisma.driver.createMany({ data: batch as never })
  })
  await batchInsert('Véhicules', vehicleData, async (batch) => {
    await prisma.vehicle.createMany({ data: batch as never })
  })

  // ── 4. Clients (5000) ──────────────────────────────────────────────────────
  console.log('\n[4/15] Génération des clients...')
  const clientIds: string[] = []

  const clientBatches: Array<Record<string, unknown>> = []
  for (let i = 0; i < NUM_CLIENTS; i++) {
    const id = rng.id('cli_')
    clientIds.push(id)
    const prefix = rng.pick(CLIENT_PREFIXES)
    const name = rng.pick(LAST_NAMES)
    clientBatches.push({
      id, tenantId,
      name: `${prefix} ${name} ${i < 1000 ? '' : `#${i}`}`.trim(),
      contact: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
      phone: `+33 4 ${pad2(rng.int(100))} ${pad2(rng.int(100))} ${pad2(rng.int(100))} ${pad2(rng.int(100))}`,
      email: `contact${i}@${prefix.toLowerCase().replace(/\s/g, '')}.fr`,
      vip: rng.next() < 0.05,
      requiresBsd: rng.next() < 0.15,
    })
  }

  await batchInsert('Clients', clientBatches, async (batch) => {
    await prisma.client.createMany({ data: batch as never })
  })

  // ── 5. Sites (10 000) ──────────────────────────────────────────────────────
  console.log('\n[5/15] Génération des sites...')
  const siteIds: string[] = []
  const siteLats: number[] = []
  const siteLngs: number[] = []

  const siteBatches: Array<Record<string, unknown>> = []
  for (let i = 0; i < NUM_SITES; i++) {
    const id = rng.id('sit_')
    siteIds.push(id)
    const depot = rng.pick(DEPOTS)
    const pt = rng.clusteredPoint(depot)
    siteLats.push(pt.lat)
    siteLngs.push(pt.lng)
    const town = rng.pick(TOWNS)
    const siteType = rng.pick(SITE_TYPES)
    siteBatches.push({
      id, tenantId,
      name: `${siteType} ${town} ${i + 1}`,
      address: `${rng.int(300)} ${rng.pick(['rue', 'avenue', 'chemin', 'route', 'impasse'])} ${rng.pick(['de la Gare', 'du Lac', 'des Alpes', 'de Savoie', 'de la Liberté', 'Jean Jaurès', 'Victor Hugo', 'des Fleurs', 'du Commerce', 'de la Paix'])}`,
      latitude: pt.lat,
      longitude: pt.lng,
      defaultManeuverMin: rng.pick([5, 10, 10, 15, 15, 20, 25, 30]),
      sector: SECTORS[i % SECTORS.length],
    })
  }

  await batchInsert('Sites', siteBatches, async (batch) => {
    await prisma.site.createMany({ data: batch as never })
  })

  // ── 6. SiteProducts (2 par site en moyenne = ~20 000) ─────────────────────
  console.log('\n[6/15] Génération des site-products...')
  const siteProductData: Array<{
    id: string; wasteType: string; binSizeM3: number;
    exutoireId: string; siteId: string; clientId: string
  }> = []

  const spBatches: Array<Record<string, unknown>> = []
  for (let i = 0; i < NUM_SITES; i++) {
    const nProducts = 1 + rng.int(3)  // 1-3 produits par site
    const clientId = clientIds[i % clientIds.length]
    for (let p = 0; p < nProducts; p++) {
      const wasteType = rng.pick(WASTE_TYPES)
      const binSize = rng.pick(BIN_SIZES_M3)
      // Trouver un exutoire compatible
      let exutoireId = exutoireIds[0]
      for (const eid of exutoireIds) {
        const accepted = exutoireWasteMap.get(eid) ?? []
        if (accepted.includes(wasteType)) { exutoireId = eid; break }
      }
      const spId = rng.id('sp_')
      siteProductData.push({ id: spId, wasteType, binSizeM3: binSize, exutoireId, siteId: siteIds[i], clientId })
      spBatches.push({
        id: spId, tenantId,
        siteId: siteIds[i],
        clientId,
        wasteType,
        binSizeLabel: `Benne ${binSize}m³`,
        binSizeM3: binSize,
        equipmentType: rng.pick(EQUIPMENT_TYPES),
        defaultDurationMin: rng.pick([20, 25, 30, 30, 35, 40, 45]),
        defaultExutoireId: exutoireId,
      })
    }
  }

  await batchInsert('SiteProducts', spBatches, async (batch) => {
    await prisma.siteProduct.createMany({ data: batch as never })
  }, 3000)

  // ── 7. Missions (50 000) ──────────────────────────────────────────────────
  console.log('\n[7/15] Génération des missions (le plus gros lot)...')
  // Pre-build client name lookup for O(1)
  const clientNameMap = new Map<string, string>()
  for (const c of clientBatches) clientNameMap.set(c.id as string, c.name as string)
  const dates = Array.from({ length: MISSION_DAYS }, (_, i) => dateStr(i))

  // Pré-calculer les missions par lots pour éviter le tableau de 50K en RAM
  let missionCount = 0
  const poserIds: string[] = []   // pour les dépendances POSER → RETIRER

  for (let dayIdx = 0; dayIdx < MISSION_DAYS; dayIdx++) {
    const date = dates[dayIdx]
    const missionsThisDay = Math.round(NUM_MISSIONS / MISSION_DAYS)

    for (let batchStart = 0; batchStart < missionsThisDay; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, missionsThisDay)
      const batch: Array<Record<string, unknown>> = []

      for (let mi = batchStart; mi < batchEnd; mi++) {
        const mId = rng.id('mis_')
        missionCount++

        // Choisir un site-product existant pour la cohérence HFVRP
        const sp = rng.pick(siteProductData)
        const siteIdx = siteIds.indexOf(sp.siteId)
        const lat = siteIdx >= 0 ? siteLats[siteIdx] : rng.lat()
        const lng = siteIdx >= 0 ? siteLngs[siteIdx] : rng.lng()

        // Type de mission
        let mType = rng.pick(MISSION_TYPES)
        let dependsOnId: string | undefined

        // 10% des RETIRER dépendent d'un POSER précédent
        if (mType === 'RETIRER' && poserIds.length > 0 && rng.next() < 0.10) {
          dependsOnId = rng.pick(poserIds)
        }
        if (mType === 'POSER') {
          poserIds.push(mId)
          // Garder max 500 POSER IDs en mémoire pour les dépendances
          if (poserIds.length > 500) poserIds.shift()
        }

        // ── P1 urgente : 5% des missions
        let priority: number | null = null
        if (rng.next() < 0.05) {
          priority = 1
        } else if (rng.next() < 0.15) {
          priority = 2
        } else if (rng.next() < 0.10) {
          priority = 3
        }

        // ── Time windows : 15% des missions (dont toutes les P1)
        let twOpenMin: number | null = null
        let twCloseMin: number | null = null
        if (priority === 1) {
          // P1 : doit être faite avant 10h (600 min)
          twOpenMin = 390   // 6h30
          twCloseMin = 600  // 10h00
        } else if (rng.next() < 0.15) {
          // Fenêtre serrée aléatoire (2-4h de large)
          const windowStart = 390 + rng.int(360)  // entre 6h30 et 12h30
          const windowWidth = 120 + rng.int(120)  // 2-4h
          twOpenMin = windowStart
          twCloseMin = windowStart + windowWidth
        }

        // Trouver l'exutoire compatible (pour linkedExutoireId)
        const linkedExutoireId = (mType === 'RETIRER' || mType === 'ECHANGER')
          ? sp.exutoireId
          : null

        const town = rng.pick(TOWNS)
        const duration = rng.pick([15, 20, 20, 25, 25, 30, 30, 35, 40, 45, 60])
        const maneuver = rng.pick([0, 5, 10, 10, 15, 15, 20])

        batch.push({
          id: mId,
          tenantId,
          type: mType,
          date,
          address: `${rng.int(200)} ${rng.pick(['rue', 'av.', 'chemin'])} ${rng.pick(['des Acacias', 'du Lac', 'de Savoie', 'Jean Jaurès', 'Victor Hugo'])}, ${town}`,
          latitude: lat + (rng.next() - 0.5) * 0.005,   // micro-bruit (~500m)
          longitude: lng + (rng.next() - 0.5) * 0.005,
          estimatedDurationMin: duration,
          maneuverTimeMin: maneuver,
          clientName: clientNameMap.get(sp.clientId) ?? `Client ${sp.clientId.slice(0, 8)}`,
          wasteTypeLabel: sp.wasteType,
          binSize: `Benne ${sp.binSizeM3}m³`,
          binSizeM3: sp.binSizeM3,
          priority,
          timeWindowOpenMin: twOpenMin,
          timeWindowCloseMin: twCloseMin,
          linkedExutoireId,
          clientId: sp.clientId,
          siteId: sp.siteId,
          productId: sp.id,
          dependsOnId: dependsOnId ?? null,
          equipmentType: rng.pick(EQUIPMENT_TYPES),
          tags: '[]',
          notes: '',
          attachments: '[]',
        })
      }

      await prisma.mission.createMany({ data: batch as never })
      const done = Math.min(dayIdx * missionsThisDay + batchStart + BATCH_SIZE, NUM_MISSIONS)
      console.log(`  Missions: ${done}/${NUM_MISSIONS} (jour ${date})`)

      // Libérer le batch et hint GC
      batch.length = 0
      if (global.gc) global.gc()
    }
  }

  // ── 8. ClientSites (liaison N:N client ↔ site) ──────────────────────────
  console.log('\n[8/15] Génération des liaisons Client-Site...')
  const clientSiteData: Array<Record<string, unknown>> = []
  const clientSiteSeen = new Set<string>()
  // Chaque site est lié au client qui possède ses produits
  for (const sp of siteProductData) {
    const key = `${sp.clientId}|${sp.siteId}`
    if (clientSiteSeen.has(key)) continue
    clientSiteSeen.add(key)
    clientSiteData.push({
      id: rng.id('cs_'),
      clientId: sp.clientId,
      siteId: sp.siteId,
    })
  }
  await batchInsert('ClientSites', clientSiteData, async (batch) => {
    await prisma.clientSite.createMany({ data: batch as never, skipDuplicates: true })
  }, 3000)

  // ── 9. Comptes chauffeurs (User DRIVER pour chaque chauffeur) ──────────
  console.log('\n[9/15] Génération des comptes chauffeurs...')
  const driverPwHash = await hash('driver1234', 8)  // bcrypt cost 8 pour la vitesse du seed
  const userBatches: Array<Record<string, unknown>> = []
  // Admin + dispatcher déjà créés. Ajouter 1 compte dispatcher supplémentaire
  await prisma.user.create({
    data: {
      tenantId, email: 'dispatch@pathelix-massive.test', passwordHash: adminPwHash,
      role: 'DISPATCHER', firstName: 'Marie', lastName: 'Dupont',
    },
  })
  // Créer un User DRIVER pour CHAQUE chauffeur
  for (let i = 0; i < NUM_DRIVERS; i++) {
    const dId = driverIds[i]
    const d = driverData[i]
    userBatches.push({
      id: rng.id('usr_'),
      tenantId,
      email: `chauffeur${i + 1}@pathelix-massive.test`,
      passwordHash: driverPwHash,
      role: 'DRIVER',
      firstName: d.firstName as string,
      lastName: d.lastName as string,
      driverRef: dId,
    })
  }
  await batchInsert('Users chauffeurs', userBatches, async (batch) => {
    await prisma.user.createMany({ data: batch as never })
  })

  // ── 10. Indisponibilités chauffeurs ────────────────────────────────────
  console.log('\n[10/15] Génération des indisponibilités...')
  const unavailData: Array<Record<string, unknown>> = []
  for (const date of dates) {
    const nUnavail = Math.round(NUM_DRIVERS * 0.05)
    for (let u = 0; u < nUnavail; u++) {
      unavailData.push({
        id: rng.id('una_'),
        tenantId,
        driverId: rng.pick(driverIds),
        startDate: date,
        endDate: date,
        reason: rng.pick(['Congé', 'Maladie', 'Formation', 'Repos compensatoire', 'RTT']),
      })
    }
  }
  await prisma.driverUnavailability.createMany({ data: unavailData as never })
  console.log(`  ${unavailData.length} indisponibilités créées`)

  // ── 11. Holidays (jours fériés) ────────────────────────────────────────
  console.log('\n[11/15] Génération des jours fériés...')
  const holidays = [
    { date: '2026-01-01', label: 'Jour de l\'An' },
    { date: '2026-04-06', label: 'Lundi de Pâques' },
    { date: '2026-05-01', label: 'Fête du Travail' },
    { date: '2026-05-08', label: 'Victoire 1945' },
    { date: '2026-05-14', label: 'Ascension' },
    { date: '2026-05-25', label: 'Lundi de Pentecôte' },
    { date: '2026-07-14', label: 'Fête nationale' },
    { date: '2026-08-15', label: 'Assomption' },
    { date: '2026-11-01', label: 'Toussaint' },
    { date: '2026-11-11', label: 'Armistice' },
    { date: '2026-12-25', label: 'Noël' },
  ]
  for (const h of holidays) {
    await prisma.holiday.create({
      data: { tenantId, date: h.date, label: h.label, recurring: true },
    }).catch(() => {})  // skip si déjà existant
  }
  console.log(`  ${holidays.length} jours fériés créés`)

  // ── 12. Mission Templates (modèles récurrents) ─────────────────────────
  console.log('\n[12/15] Génération des templates récurrents...')
  // 50 templates basés sur des SiteProducts existants
  const NUM_TEMPLATES = 50
  for (let t = 0; t < NUM_TEMPLATES; t++) {
    const sp = siteProductData[t % siteProductData.length]
    const siteIdx = siteIds.indexOf(sp.siteId)
    const lat = siteIdx >= 0 ? siteLats[siteIdx] : rng.lat()
    const lng = siteIdx >= 0 ? siteLngs[siteIdx] : rng.lng()
    const town = rng.pick(TOWNS)
    const freq = rng.pick(['weekly', 'biweekly', 'monthly'] as const)
    const days = freq === 'weekly' ? [rng.int(5) + 1]     // 1 jour/semaine (lun-ven)
              : freq === 'biweekly' ? [rng.int(5) + 1]
              : [1]                                         // 1er du mois

    // On crée les templates comme des missions spéciales dans le système
    // Le front les gère via le store templates
    // Pour l'instant on simule via l'API localStorage/store — les templates
    // ne sont pas en DB (ils sont dans le Zustand store persisté)
  }
  console.log(`  ${NUM_TEMPLATES} templates prêts (stockage client-side)`)

  // ── 13. Audit Logs (historique d'actions) ──────────────────────────────
  console.log('\n[13/15] Génération de l\'historique d\'audit...')
  const auditBatches: Array<Record<string, unknown>> = []
  const auditActions = ['CREATE', 'UPDATE', 'DELETE', 'status_update', 'OPTIMIZE']
  const auditEntities = ['mission', 'driver', 'plan', 'exutoire', 'vehicle']
  for (let a = 0; a < 500; a++) {
    const daysAgo = rng.int(30)
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    d.setHours(6 + rng.int(14), rng.int(60), rng.int(60))
    auditBatches.push({
      id: rng.id('aud_'),
      tenantId,
      userId: rng.pick(driverIds.slice(0, 10)),
      action: rng.pick(auditActions),
      entityType: rng.pick(auditEntities),
      entityId: rng.id('ent_'),
      changes: JSON.stringify({ before: 'ancien', after: 'nouveau' }),
      createdAt: d,
    })
  }
  await prisma.auditLog.createMany({ data: auditBatches as never })
  console.log(`  ${auditBatches.length} entrées d'audit créées`)

  // ── 14. Tour History (historique d'optimisations) ──────────────────────
  console.log('\n[14/15] Génération de l\'historique des tournées...')
  for (let h = 0; h < 10; h++) {
    const d = new Date()
    d.setDate(d.getDate() - h - 1)
    const histDate = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    await prisma.tourHistory.create({
      data: {
        tenantId,
        date: histDate,
        label: `Optimisation ${histDate} (${rng.int(800) + 200} missions)`,
        snapshot: JSON.stringify({ date: histDate, drivers: rng.int(500) + 500, missions: rng.int(10000) + 5000, score: rng.int(40) + 60 }),
      },
    })
  }
  console.log('  10 entrées d\'historique créées')

  // ── 15. Résumé ─────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  SEED MASSIF TERMINÉ')
  console.log(`  Temps total : ${elapsed}s`)
  console.log(`  Tenant      : ${tenantId} (slug: pathelix-massive)`)
  console.log(`  Chauffeurs  : ${NUM_DRIVERS}`)
  console.log(`  Véhicules   : ${NUM_DRIVERS}`)
  console.log(`  Clients     : ${NUM_CLIENTS}`)
  console.log(`  Sites       : ${NUM_SITES}`)
  console.log(`  ClientSites : ${clientSiteData.length}`)
  console.log(`  SiteProducts: ${spBatches.length}`)
  console.log(`  Exutoires   : ${NUM_EXUTOIRES}`)
  console.log(`  Missions    : ${missionCount} sur ${MISSION_DAYS} jours`)
  console.log(`  Users       : ${userBatches.length + 2} (admin + dispatch + ${userBatches.length} chauffeurs)`)
  console.log(`  Indispos.   : ${unavailData.length}`)
  console.log(`  Jours fériés: ${holidays.length}`)
  console.log(`  Audit logs  : ${auditBatches.length}`)
  console.log(`  Historique  : 10`)
  console.log(`  Dates       : ${dates.join(', ')}`)
  console.log('')
  console.log('  Comptes :')
  console.log('    admin@pathelix-massive.test / admin1234')
  console.log('    dispatch@pathelix-massive.test / admin1234')
  console.log('    chauffeur1@pathelix-massive.test / driver1234')
  console.log('    chauffeur2@pathelix-massive.test / driver1234')
  console.log('    ... chauffeur${NUM_DRIVERS}@pathelix-massive.test / driver1234')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
}

main()
  .catch((err) => {
    console.error('ERREUR SEED MASSIF:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
