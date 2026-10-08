// ─── Seed complet — Pathélix ─────────────────────────────────────────────────
// Crée un jeu de données réaliste pour tester TOUTES les fonctionnalités.

import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg }     from '@prisma/adapter-pg'
import { hash }          from 'bcryptjs'
import { config } from 'dotenv'
config({ path: '.env.local' })
config()

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pathelix',
})
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Seed complet démarré')

  // ── Nettoyage ─────────────────────────────────────────────────────────────
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
  await prisma.driver.deleteMany()
  await prisma.exutoire.deleteMany()
  await prisma.site.deleteMany()
  await prisma.client.deleteMany()
  await prisma.user.deleteMany()
  await prisma.tenant.deleteMany()
  console.log('  ✓ Tables nettoyées')

  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.create({
    data: { name: 'Pathélix', slug: 'pathelix', plan: 'ENTERPRISE' },
  })
  const T = tenant.id
  console.log(`  ✓ Tenant : ${tenant.slug} (${T})`)

  // ── Utilisateurs (admin + dispatcher + chauffeur) ─────────────────────────
  const pwd = process.env.ADMIN_PASSWORD || 'admin'
  const hashed = await hash(pwd, 12)

  await prisma.user.create({
    data: { tenantId: T, email: 'admin@pathelix.fr', passwordHash: hashed, role: 'ADMIN', firstName: 'Admin', lastName: 'Pathélix' },
  })
  await prisma.user.create({
    data: { tenantId: T, email: 'dispatch@pathelix.fr', passwordHash: hashed, role: 'DISPATCHER', firstName: 'Marie', lastName: 'Dupont' },
  })
  console.log('  ✓ Users : admin, dispatcher')

  // ── TenantSettings ────────────────────────────────────────────────────────
  await prisma.tenantSettings.create({
    data: {
      tenantId: T, defaultSpeedKmh: 50, defaultStartTime: '07:00',
      maxWorkDayMin: 600, pauseAfterMin: 270, pauseDurationMin: 45,
      costPerKm: 0.38, fuelCostPerLiter: 1.85, consumptionLPer100: 32,
      primaryColor: '#0055A4', logoUrl: '', companyDisplayName: 'Pathélix',
    },
  })
  console.log('  ✓ TenantSettings')

  // ── Chauffeurs (3) ────────────────────────────────────────────────────────
  const gabin = await prisma.driver.create({
    data: { tenantId: T, firstName: 'Gabin', lastName: 'Martin', sector: 'Ain', depotName: 'La Semine', depotLat: 46.0682, depotLng: 5.9245, vehicleCapacity: 2, maxBinSizeM3: 35, skills: ['permis_C', 'CACES'] },
  })
  const lucas = await prisma.driver.create({
    data: { tenantId: T, firstName: 'Lucas', lastName: 'Perrin', sector: 'Haute-Savoie', depotName: 'Dépôt Annecy', depotLat: 45.8992, depotLng: 6.1294, vehicleCapacity: 2, maxBinSizeM3: 35, skills: ['permis_C', 'grue'] },
  })
  const romain = await prisma.driver.create({
    data: { tenantId: T, firstName: 'Romain', lastName: 'Favre', sector: 'Ain', depotName: 'Dépôt Bellegarde', depotLat: 46.1082, depotLng: 5.8285, vehicleCapacity: 1, maxBinSizeM3: 20, skills: ['permis_C'] },
  })
  console.log('  ✓ 3 chauffeurs : Gabin, Lucas, Romain')

  // Comptes chauffeurs liés
  await prisma.user.create({
    data: { tenantId: T, email: 'gabin@pathelix.fr', passwordHash: hashed, role: 'DRIVER', firstName: 'Gabin', lastName: 'Martin', driverRef: gabin.id },
  })
  await prisma.user.create({
    data: { tenantId: T, email: 'lucas@pathelix.fr', passwordHash: hashed, role: 'DRIVER', firstName: 'Lucas', lastName: 'Perrin', driverRef: lucas.id },
  })
  await prisma.user.create({
    data: { tenantId: T, email: 'romain@pathelix.fr', passwordHash: hashed, role: 'DRIVER', firstName: 'Romain', lastName: 'Favre', driverRef: romain.id },
  })
  console.log('  ✓ 3 comptes chauffeurs')

  // ── Véhicules (3) ─────────────────────────────────────────────────────────
  await prisma.vehicle.create({
    data: { tenantId: T, licensePlate: 'GP-169-FF', type: 'ampliroll', brand: 'Scania', model: 'P410', capacityM3: 35, maxBins: 2, mileageKm: 124000, status: 'active', assignedDriverId: gabin.id },
  })
  await prisma.vehicle.create({
    data: { tenantId: T, licensePlate: 'LU-234-AB', type: 'grue', brand: 'Volvo', model: 'FMX', capacityM3: 35, maxBins: 2, mileageKm: 87000, status: 'active', assignedDriverId: lucas.id },
  })
  await prisma.vehicle.create({
    data: { tenantId: T, licensePlate: 'RO-567-CD', type: 'benne', brand: 'Renault', model: 'D-Wide', capacityM3: 20, maxBins: 1, mileageKm: 56000, status: 'active', assignedDriverId: romain.id },
  })
  console.log('  ✓ 3 véhicules')

  // ── Exutoires (4) ─────────────────────────────────────────────────────────
  const exCareiro = await prisma.exutoire.create({
    data: { tenantId: T, name: 'Carneiro', address: 'ZI Valserhône, 01200', lat: 46.1064, lng: 5.8236, openingHoursOpen: 420, openingHoursClose: 1080, closedDays: [0], acceptedWasteTypes: ['Gravats', 'DIB', 'Bois', 'Ferraille'], serviceTimeMin: 30 },
  })
  const exSemine = await prisma.exutoire.create({
    data: { tenantId: T, name: 'La Semine', address: 'La Semine, 01200 Châtillon', lat: 46.0656, lng: 5.8666, openingHoursOpen: 420, openingHoursClose: 1080, closedDays: [0], acceptedWasteTypes: ['Gravats', 'DIB', 'Terre', 'Bois', 'Carton', 'Ferraille', 'Papier Carton'], serviceTimeMin: 20 },
  })
  const exSivalor = await prisma.exutoire.create({
    data: { tenantId: T, name: 'Sivalor Saint-Genis', address: 'Route de Gex, 01630 Saint-Genis-Pouilly', lat: 46.2437, lng: 6.0250, openingHoursOpen: 480, openingHoursClose: 1020, closedDays: [0], acceptedWasteTypes: ['Gravats', 'DIB', 'Bois', 'Ferraille', 'Carton', 'Papier Carton'], serviceTimeMin: 30 },
  })
  await prisma.exutoire.create({
    data: { tenantId: T, name: 'ISDND Bellegarde', address: 'Route de Lancrans, 01200 Bellegarde', lat: 46.1150, lng: 5.8100, openingHoursOpen: 420, openingHoursClose: 1020, closedDays: [0, 6], acceptedWasteTypes: ['DIB', 'Encombrants'], serviceTimeMin: 45 },
  })
  console.log('  ✓ 4 exutoires')

  // ── Clients (6) ───────────────────────────────────────────────────────────
  const clCareiro = await prisma.client.create({ data: { tenantId: T, name: 'Carneiro BTP', contact: 'M. Silva', phone: '04 50 12 34 56', requiresBsd: true } })
  const clCarrefour = await prisma.client.create({ data: { tenantId: T, name: 'Carrefour Divonne', contact: 'Service technique', phone: '04 50 20 00 00', vip: true } })
  const clSSC = await prisma.client.create({ data: { tenantId: T, name: 'SSC Les Vues', contact: 'Chef de chantier' } })
  const clSivalor = await prisma.client.create({ data: { tenantId: T, name: 'Sivalor', ecoResponsable: true } })
  const clBouygues = await prisma.client.create({ data: { tenantId: T, name: 'Bouygues Construction', contact: 'M. Leblanc', phone: '04 50 33 44 55', vip: true, requiresBsd: true } })
  const clParticulier = await prisma.client.create({ data: { tenantId: T, name: 'M. Durand (particulier)', contact: 'Pierre Durand', phone: '06 12 34 56 78' } })
  console.log('  ✓ 6 clients')

  // ── Sites (7) ─────────────────────────────────────────────────────────────
  const sCareiro = await prisma.site.create({ data: { tenantId: T, name: 'ZI Valserhône', address: 'Zone Industrielle, 01200 Valserhône', latitude: 46.310, longitude: 6.068, sector: 'Ain', accessNotes: 'Portail principal, badge requis' } })
  const sCarrefour = await prisma.site.create({ data: { tenantId: T, name: 'Carrefour Divonne', address: 'Avenue des Alpes, 01220 Divonne', latitude: 46.343, longitude: 6.141, sector: 'Ain', accessNotes: 'Quai de livraison arrière' } })
  const sLesVues = await prisma.site.create({ data: { tenantId: T, name: 'Chantier Les Vues', address: 'Les Vues, 01200 Confort', latitude: 46.244, longitude: 5.979, sector: 'Ain' } })
  const sSivalor = await prisma.site.create({ data: { tenantId: T, name: 'Déchetterie Saint-Genis', address: 'Route de Gex, 01630 Saint-Genis-Pouilly', latitude: 46.255, longitude: 6.049, sector: 'Ain' } })
  const sAnnecy = await prisma.site.create({ data: { tenantId: T, name: 'Chantier Annecy Centre', address: 'Rue Royale, 74000 Annecy', latitude: 45.899, longitude: 6.129, sector: 'Haute-Savoie', accessNotes: 'Accès restreint 7h-9h, rue piétonne' } })
  const sCran = await prisma.site.create({ data: { tenantId: T, name: 'Lotissement Cran-Gevrier', address: 'Avenue de la République, 74960 Cran-Gevrier', latitude: 45.905, longitude: 6.103, sector: 'Haute-Savoie' } })
  const sDurand = await prisma.site.create({ data: { tenantId: T, name: 'Maison Durand', address: '12 Chemin des Prés, 01200 Bellegarde', latitude: 46.108, longitude: 5.828, sector: 'Ain', accessNotes: 'Impasse étroite, pas de retournement' } })
  console.log('  ✓ 7 sites')

  // ── Liens Client-Site ─────────────────────────────────────────────────────
  await prisma.clientSite.createMany({
    data: [
      { clientId: clCareiro.id, siteId: sCareiro.id },
      { clientId: clCarrefour.id, siteId: sCarrefour.id },
      { clientId: clSSC.id, siteId: sLesVues.id },
      { clientId: clSivalor.id, siteId: sSivalor.id },
      { clientId: clBouygues.id, siteId: sAnnecy.id },
      { clientId: clBouygues.id, siteId: sCran.id },
      { clientId: clBouygues.id, siteId: sCareiro.id },  // Bouygues aussi sur ZI Valserhône
      { clientId: clParticulier.id, siteId: sDurand.id },
    ],
  })
  console.log('  ✓ 8 liens client-site')

  // ── Produits catalogue (10) ───────────────────────────────────────────────
  await prisma.siteProduct.createMany({
    data: [
      { tenantId: T, siteId: sCareiro.id, clientId: clCareiro.id, wasteType: 'DIB', binSizeLabel: 'Benne 35m³', binSizeM3: 35, equipmentType: 'ampliroll', defaultDurationMin: 20, defaultExutoireId: exCareiro.id },
      { tenantId: T, siteId: sCareiro.id, clientId: clCareiro.id, wasteType: 'Gravats', binSizeLabel: 'Benne 35m³', binSizeM3: 35, equipmentType: 'ampliroll', defaultDurationMin: 20, defaultExutoireId: exCareiro.id },
      { tenantId: T, siteId: sCareiro.id, clientId: clBouygues.id, wasteType: 'Bois', binSizeLabel: 'Benne 20m³', binSizeM3: 20, defaultDurationMin: 15, defaultExutoireId: exSemine.id },
      { tenantId: T, siteId: sCarrefour.id, clientId: clCarrefour.id, wasteType: 'Papier Carton', binSizeLabel: 'Benne 20m³', binSizeM3: 20, defaultDurationMin: 20 },
      { tenantId: T, siteId: sLesVues.id, clientId: clSSC.id, wasteType: 'Gravats', binSizeLabel: 'Benne 35m³', binSizeM3: 35, equipmentType: 'ampliroll', defaultDurationMin: 10, defaultExutoireId: exSemine.id },
      { tenantId: T, siteId: sSivalor.id, clientId: clSivalor.id, wasteType: 'Papier Carton', binSizeLabel: 'Benne 20m³', binSizeM3: 20, defaultDurationMin: 20 },
      { tenantId: T, siteId: sAnnecy.id, clientId: clBouygues.id, wasteType: 'Gravats', binSizeLabel: 'Benne 35m³', binSizeM3: 35, equipmentType: 'ampliroll', defaultDurationMin: 25, defaultExutoireId: exSivalor.id },
      { tenantId: T, siteId: sAnnecy.id, clientId: clBouygues.id, wasteType: 'DIB', binSizeLabel: 'Benne 20m³', binSizeM3: 20, defaultDurationMin: 20, defaultExutoireId: exSivalor.id },
      { tenantId: T, siteId: sCran.id, clientId: clBouygues.id, wasteType: 'Terre', binSizeLabel: 'Benne 35m³', binSizeM3: 35, equipmentType: 'ampliroll', defaultDurationMin: 15, defaultExutoireId: exSemine.id },
      { tenantId: T, siteId: sDurand.id, clientId: clParticulier.id, wasteType: 'Gravats', binSizeLabel: 'Benne 15m³', binSizeM3: 15, defaultDurationMin: 30, notes: 'Impasse étroite — petit camion obligatoire' },
    ],
  })
  console.log('  ✓ 10 produits catalogue')

  // ── Missions (12 sur aujourd'hui, 6 sur demain) ───────────────────────────
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

  await prisma.mission.createMany({
    data: [
      // === AUJOURD'HUI ===
      // Careiro
      { tenantId: T, type: 'ECHANGER', date: today, clientName: 'Carneiro BTP', address: 'ZI Valserhône', latitude: 46.310, longitude: 6.068, estimatedDurationMin: 20, maneuverTimeMin: 10, wasteTypeLabel: 'DIB', binSize: '35', binSizeM3: 35, priority: 3, linkedExutoireId: exCareiro.id },
      { tenantId: T, type: 'ECHANGER', date: today, clientName: 'Carneiro BTP', address: 'ZI Valserhône', latitude: 46.310, longitude: 6.068, estimatedDurationMin: 20, maneuverTimeMin: 10, wasteTypeLabel: 'Gravats', binSize: '35', binSizeM3: 35, priority: 3, linkedExutoireId: exCareiro.id },
      { tenantId: T, type: 'RETIRER', date: today, clientName: 'Carneiro BTP', address: 'ZI Valserhône', latitude: 46.310, longitude: 6.068, estimatedDurationMin: 15, maneuverTimeMin: 10, wasteTypeLabel: 'Gravats', binSize: '35', binSizeM3: 35, priority: 2, linkedExutoireId: exCareiro.id },
      // Carrefour Divonne
      { tenantId: T, type: 'ECHANGER', date: today, clientName: 'Carrefour Divonne', address: 'Avenue des Alpes, Divonne', latitude: 46.343, longitude: 6.141, estimatedDurationMin: 20, maneuverTimeMin: 10, wasteTypeLabel: 'Papier Carton', binSize: '20', binSizeM3: 20, priority: 3 },
      // SSC Les Vues
      { tenantId: T, type: 'ECHANGER', date: today, clientName: 'SSC Les Vues', address: 'Les Vues, Confort', latitude: 46.244, longitude: 5.979, estimatedDurationMin: 10, maneuverTimeMin: 5, wasteTypeLabel: 'Gravats', binSize: '35', binSizeM3: 35, priority: 3, linkedExutoireId: exSemine.id },
      // Sivalor
      { tenantId: T, type: 'ECHANGER', date: today, clientName: 'Sivalor', address: 'Saint-Genis-Pouilly', latitude: 46.255, longitude: 6.049, estimatedDurationMin: 20, maneuverTimeMin: 10, wasteTypeLabel: 'Papier Carton', binSize: '20', binSizeM3: 20, priority: 3 },
      // Bouygues Annecy
      { tenantId: T, type: 'POSER', date: today, clientName: 'Bouygues Construction', address: 'Rue Royale, Annecy', latitude: 45.899, longitude: 6.129, estimatedDurationMin: 25, maneuverTimeMin: 15, wasteTypeLabel: 'Gravats', binSize: '35', binSizeM3: 35, priority: 2, linkedExutoireId: exSivalor.id },
      { tenantId: T, type: 'RETIRER', date: today, clientName: 'Bouygues Construction', address: 'Rue Royale, Annecy', latitude: 45.899, longitude: 6.129, estimatedDurationMin: 20, maneuverTimeMin: 10, wasteTypeLabel: 'DIB', binSize: '20', binSizeM3: 20, priority: 2, linkedExutoireId: exSivalor.id },
      // Bouygues Cran-Gevrier
      { tenantId: T, type: 'ECHANGER', date: today, clientName: 'Bouygues Construction', address: 'Cran-Gevrier', latitude: 45.905, longitude: 6.103, estimatedDurationMin: 15, maneuverTimeMin: 10, wasteTypeLabel: 'Terre', binSize: '35', binSizeM3: 35, priority: 3, linkedExutoireId: exSemine.id },
      // Particulier Durand — PRIORITÉ 1 (urgent)
      { tenantId: T, type: 'POSER', date: today, clientName: 'M. Durand', address: '12 Chemin des Prés, Bellegarde', latitude: 46.108, longitude: 5.828, estimatedDurationMin: 30, maneuverTimeMin: 15, wasteTypeLabel: 'Gravats', binSize: '15', binSizeM3: 15, priority: 1, accessNotes: 'Impasse étroite' },
      // Missions supplémentaires
      { tenantId: T, type: 'CHARGER_IMMEDIAT', date: today, clientName: 'Carneiro BTP', address: 'ZI Valserhône', latitude: 46.310, longitude: 6.068, estimatedDurationMin: 30, maneuverTimeMin: 10, wasteTypeLabel: 'Ferraille', binSize: '20', binSizeM3: 20, priority: 2 },
      { tenantId: T, type: 'DEPLACER', date: today, clientName: 'SSC Les Vues', address: 'Les Vues, Confort', latitude: 46.244, longitude: 5.979, estimatedDurationMin: 15, maneuverTimeMin: 5, wasteTypeLabel: 'Gravats', binSize: '35', binSizeM3: 35, priority: 3 },

      // === DEMAIN ===
      { tenantId: T, type: 'ECHANGER', date: tomorrow, clientName: 'Carneiro BTP', address: 'ZI Valserhône', latitude: 46.310, longitude: 6.068, estimatedDurationMin: 20, maneuverTimeMin: 10, wasteTypeLabel: 'DIB', binSize: '35', binSizeM3: 35, priority: 3 },
      { tenantId: T, type: 'ECHANGER', date: tomorrow, clientName: 'Carrefour Divonne', address: 'Avenue des Alpes, Divonne', latitude: 46.343, longitude: 6.141, estimatedDurationMin: 20, maneuverTimeMin: 10, wasteTypeLabel: 'Papier Carton', binSize: '20', binSizeM3: 20, priority: 3 },
      { tenantId: T, type: 'POSER', date: tomorrow, clientName: 'Bouygues Construction', address: 'Rue Royale, Annecy', latitude: 45.899, longitude: 6.129, estimatedDurationMin: 25, maneuverTimeMin: 15, wasteTypeLabel: 'Bois', binSize: '20', binSizeM3: 20, priority: 3 },
      { tenantId: T, type: 'RETIRER', date: tomorrow, clientName: 'M. Durand', address: '12 Chemin des Prés, Bellegarde', latitude: 46.108, longitude: 5.828, estimatedDurationMin: 30, maneuverTimeMin: 15, wasteTypeLabel: 'Gravats', binSize: '15', binSizeM3: 15, priority: 2 },
      { tenantId: T, type: 'ECHANGER', date: tomorrow, clientName: 'SSC Les Vues', address: 'Les Vues, Confort', latitude: 46.244, longitude: 5.979, estimatedDurationMin: 10, maneuverTimeMin: 5, wasteTypeLabel: 'Gravats', binSize: '35', binSizeM3: 35, priority: 3 },
      { tenantId: T, type: 'TASSER', date: tomorrow, clientName: 'Bouygues Construction', address: 'Cran-Gevrier', latitude: 45.905, longitude: 6.103, estimatedDurationMin: 20, maneuverTimeMin: 5, wasteTypeLabel: 'Terre', binSize: '35', binSizeM3: 35, priority: 3 },
    ],
  })
  console.log(`  ✓ 12 missions (${today}) + 6 missions (${tomorrow})`)

  // ── Jours fériés ──────────────────────────────────────────────────────────
  await prisma.holiday.createMany({
    data: [
      { tenantId: T, date: '2026-05-01', label: 'Fête du Travail' },
      { tenantId: T, date: '2026-05-14', label: 'Ascension' },
      { tenantId: T, date: '2026-07-14', label: 'Fête Nationale' },
      { tenantId: T, date: '2026-12-25', label: 'Noël' },
    ],
  })
  console.log('  ✓ 4 jours fériés')

  // ── Indisponibilités chauffeurs ───────────────────────────────────────────
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  const nextWeek2 = new Date(Date.now() + 9 * 86400000).toISOString().split('T')[0]
  await prisma.driverUnavailability.create({
    data: { tenantId: T, driverId: lucas.id, startDate: nextWeek, endDate: nextWeek2, reason: 'conge', notes: 'Congés annuels' },
  })
  console.log(`  ✓ Indisponibilité Lucas : ${nextWeek} → ${nextWeek2}`)

  // ── Résumé ────────────────────────────────────────────────────────────────
  await seedSuperAdmin()

  console.log('')
  console.log('✅ Seed complet terminé !')
  console.log(`   Tenant     : ${T}`)
  console.log(`   Admin      : admin@pathelix.fr`)
  console.log(`   Dispatcher : dispatch@pathelix.fr`)
  console.log(`   Chauffeurs : gabin@pathelix.fr, lucas@pathelix.fr, romain@pathelix.fr`)
  console.log(`   SuperAdmin : ${process.env.SUPERADMIN_EMAIL} (tenant admin-corp)`)
  console.log(`   Données    : 3 chauffeurs, 3 véhicules, 4 exutoires, 6 clients, 7 sites, 10 produits, 18 missions, 4 fériés`)
}

async function seedSuperAdmin() {
  // ── Tenant platform (admin-corp) ───────────────────────────────────────────
  let platformTenant = await prisma.tenant.findUnique({ where: { slug: 'admin-corp' } })
  if (!platformTenant) {
    platformTenant = await prisma.tenant.create({
      data: { name: 'Platform Admin', slug: 'admin-corp', plan: 'ENTERPRISE' },
    })
  }

  // ── SuperAdmin ─────────────────────────────────────────────────────────────
  const superPwd = process.env.SUPERADMIN_PASSWORD
  if (!superPwd) {
    throw new Error(
      '[seed] SUPERADMIN_PASSWORD est requis. Définissez-le dans .env avant de lancer le seed.',
    )
  }
  // No default address: a seed must never create a platform account for an email nobody chose.
  const superEmail = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase()
  if (!superEmail) {
    throw new Error(
      '[seed] SUPERADMIN_EMAIL est requis. Définissez-le dans .env avant de lancer le seed.',
    )
  }
  const superHash  = await hash(superPwd, 12)

  const existing = await prisma.user.findFirst({
    where: { email: superEmail, tenantId: platformTenant.id },
  })
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: superHash, role: 'SUPERADMIN' },
    })
  } else {
    await prisma.user.create({
      data: {
        tenantId:     platformTenant.id,
        email:        superEmail,
        passwordHash: superHash,
        role:         'SUPERADMIN',
        firstName:    'Admin',
        lastName:     'Platform',
      },
    })
  }
  console.log(`  ✓ SuperAdmin : ${superEmail} (tenant admin-corp)`)
}

main()
  .catch(e => { console.error('❌ Erreur seed :', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
