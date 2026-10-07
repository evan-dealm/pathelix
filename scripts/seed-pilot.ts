/**
 * A fictitious but realistic skip-hire company, created the way a real one would be: the tenant
 * and its first admin directly in the database, then EVERYTHING ELSE THROUGH THE HTTP API with
 * that admin's session — users, drivers, trucks, bins, outlets, customers, sites, prices,
 * contracts, missions, quotes, orders, invoices, payments. If a route refuses a sensible
 * payload, this script fails: it is a seed and an end-to-end check of the creation paths.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --tsconfig tsconfig.json scripts/seed-pilot.ts
 *   npx tsx --tsconfig tsconfig.json scripts/seed-pilot.ts --clean
 *
 * Refuses a database that is not a test sandbox unless PILOT_DB=<exact database name>.
 * Prints the admin credentials at the end (password: PILOT_PASSWORD or the default below —
 * fictitious data only, never use this tenant for real customers).
 */
import { hash } from 'bcryptjs'
import { unscopedPrisma } from '@/lib/tenantDb'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SLUG = 'bennes-dauphine'
const ADMIN_EMAIL = 'direction@bennes-dauphine.example'
const PASSWORD = process.env.PILOT_PASSWORD ?? 'Pilote-Dauphine-2026!'
const DEPOT = { name: 'Dépôt Saint-Égrève', lat: 45.2312, lng: 5.6803 }

const day = (offset: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d)
}
const TODAY = day(0)
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function assertSafeDatabase(): void {
  const dbName = (process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop() ?? ''
  if (!dbName) throw new Error('DATABASE_URL is not set')
  if (dbName.includes('manualtest_sandbox') || process.env.PILOT_DB === dbName) return
  throw new Error(`Refusing to create the pilot company in "${dbName}". If that is really intended: PILOT_DB=${dbName}`)
}

// ─── HTTP ──────────────────────────────────────────────────────────────────────
let cookie = ''
type Json = Record<string, unknown>

async function api<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
  const send = () => fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let res = await send()
  // The application limits writes per organisation (e.g. 100 mission writes a minute): wait, as
  // any well-behaved client must, instead of asking for the limits to be lifted.
  for (let attempt = 0; res.status === 429 && attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5_000))
    res = await send()
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`)
  try { return JSON.parse(text) as T } catch { return {} as T }
}

/** Id of a created object, whatever envelope the route answers with. */
function idOf(r: Json, ...keys: string[]): string {
  for (const k of ['', ...keys, 'data']) {
    const o = (k ? r[k] : r) as Json | undefined
    if (o && typeof o.id === 'string') return o.id
  }
  throw new Error(`no id in ${JSON.stringify(r).slice(0, 200)}`)
}

async function login(): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`login → ${res.status} ${(await res.text()).slice(0, 200)}`)
  const session = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('session='))
  if (!session) throw new Error('login did not set a session cookie')
  cookie = session
}

// ─── Reference data ────────────────────────────────────────────────────────────
const DRIVER_NAMES: Array<[string, string]> = [
  ['Mathieu', 'Garnier'], ['Karim', 'Benali'], ['Lucas', 'Perrin'], ['Sébastien', 'Roche'], ['Julien', 'Marchand'],
  ['Thomas', 'Giraud'], ['Nicolas', 'Fabre'], ['Antoine', 'Lemoine'], ['Yanis', 'Haddad'], ['Cédric', 'Blanc'],
  ['Romain', 'Chevalier'], ['Olivier', 'Mercier'],
]
const CUSTOMERS: Array<{ name: string; sector: string; sites: Array<[string, string, string, string, number, number]> }> = [
  { name: 'Bâtir Isère Construction', sector: 'BTP', sites: [
    ['Chantier Presqu\'île', '12 rue Pierre Sémard', 'Grenoble', '38000', 45.2005, 5.7106],
    ['Chantier Bouchayer', '48 rue Ampère', 'Grenoble', '38000', 45.1895, 5.7020],
    ['Dépôt Fontaine', '9 rue de la Liberté', 'Fontaine', '38600', 45.1930, 5.6870] ] },
  { name: 'Rénov\'Alpes', sector: 'Rénovation', sites: [
    ['Immeuble Jaurès', '120 cours Jean Jaurès', 'Grenoble', '38000', 45.1780, 5.7190],
    ['Villa Meylan', '14 chemin des Buclos', 'Meylan', '38240', 45.2110, 5.7790] ] },
  { name: 'Menuiserie du Grésivaudan', sector: 'Artisanat', sites: [
    ['Atelier Crolles', '310 rue Charles de Gaulle', 'Crolles', '38920', 45.2850, 5.8830] ] },
  { name: 'Mairie de Voreppe', sector: 'Collectivité', sites: [
    ['Services techniques', '1 place Charles de Gaulle', 'Voreppe', '38340', 45.2980, 5.6370],
    ['Stade municipal', 'Avenue Henri Chapays', 'Voreppe', '38340', 45.2935, 5.6330] ] },
  { name: 'Carrosserie Vercors', sector: 'Automobile', sites: [
    ['Garage Sassenage', '22 rue de l\'Argentière', 'Sassenage', '38360', 45.2060, 5.6640] ] },
  { name: 'Paysages Belledonne', sector: 'Espaces verts', sites: [
    ['Plateforme Domène', '5 rue des Glairons', 'Domène', '38420', 45.2020, 5.8390],
    ['Chantier Gières', 'Rue de la Libération', 'Gières', '38610', 45.1810, 5.7900] ] },
  { name: 'Logistique Alpine', sector: 'Logistique', sites: [
    ['Entrepôt Moirans', '80 rue de la Coste', 'Moirans', '38430', 45.3260, 5.5640] ] },
  { name: 'Démolition Rhône-Alpes', sector: 'BTP', sites: [
    ['Friche Pont-de-Claix', 'Avenue du Maquis de l\'Oisans', 'Le Pont-de-Claix', '38800', 45.1250, 5.6990],
    ['Chantier Échirolles', '15 avenue de Grugliasco', 'Échirolles', '38130', 45.1440, 5.7180] ] },
  { name: 'Supermarché du Drac', sector: 'Commerce', sites: [
    ['Magasin Seyssinet', '2 rue de la Tuilerie', 'Seyssinet-Pariset', '38170', 45.1790, 5.6880] ] },
  { name: 'Résidence Les Charmilles', sector: 'Syndic', sites: [
    ['Copropriété Saint-Martin-d\'Hères', '30 avenue Gabriel Péri', 'Saint-Martin-d\'Hères', '38400', 45.1760, 5.7570] ] },
  { name: 'Industrie Mécanique Voiron', sector: 'Industrie', sites: [
    ['Usine Voiron', '70 boulevard Denfert-Rochereau', 'Voiron', '38500', 45.3640, 5.5920] ] },
  { name: 'Couverture Chartreuse', sector: 'Artisanat', sites: [
    ['Chantier Saint-Égrève', '18 rue de la Monta', 'Saint-Égrève', '38120', 45.2330, 5.6850] ] },
]

async function main(): Promise<void> {
  assertSafeDatabase()

  if (process.argv.includes('--clean')) {
    const del = await unscopedPrisma.tenant.deleteMany({ where: { slug: SLUG } })
    console.log(del.count > 0 ? 'Pilot company removed.' : 'No pilot company to remove.')
    return
  }
  if (await unscopedPrisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } })) {
    throw new Error('The pilot company already exists — run with --clean first.')
  }

  // 1. The tenant and its first admin: what the superadmin console does.
  const tenant = await unscopedPrisma.tenant.create({
    data: { name: 'Bennes du Dauphiné', slug: SLUG, plan: 'ENTERPRISE', trade: 'collecte_recyclage', contactEmail: ADMIN_EMAIL },
    select: { id: true },
  })
  await unscopedPrisma.user.create({
    data: { tenantId: tenant.id, email: ADMIN_EMAIL, passwordHash: await hash(PASSWORD, 12), role: 'ADMIN', firstName: 'Claire', lastName: 'Dumont' },
  })
  await unscopedPrisma.tenantSettings.create({ data: { tenantId: tenant.id } })
  await login()
  const count: Record<string, number> = {}
  const made = (k: string, n = 1) => { count[k] = (count[k] ?? 0) + n }

  // 2. Outlets, materials, bin types, bins.
  const exutoires: string[] = []
  for (const e of [
    { name: 'Centre de tri de La Tronche', address: 'Chemin de la Carronnerie, 38700 La Tronche', lat: 45.2090, lng: 5.7410, acceptedWasteTypes: ['DIB', 'Bois', 'Cartons', 'Ferraille'], feePerTonneEur: 95 },
    { name: 'Plateforme gravats du Fontanil', address: 'ZI du Fontanil, 38120 Le Fontanil-Cornillon', lat: 45.2540, lng: 5.6640, acceptedWasteTypes: ['Gravats', 'Terre'], feePerTonneEur: 18 },
    { name: 'Déchets verts de Domène', address: 'Route de Murianette, 38420 Domène', lat: 45.1990, lng: 5.8310, acceptedWasteTypes: ['Déchets verts', 'Bois'], feePerTonneEur: 42 },
  ]) {
    exutoires.push(idOf(await api('POST', '/api/exutoires', { ...e, openingHoursOpen: 7 * 60, openingHoursClose: 17 * 60, closedDays: [0], serviceTimeMin: 15 }), 'exutoire'))
    made('exutoires')
  }

  const materials: Record<string, string> = {}
  for (const m of [
    { name: 'DIB', wasteCode: '20 03 01', densityKgM3: 150 },
    { name: 'Gravats', wasteCode: '17 01 07', densityKgM3: 1400 },
    { name: 'Bois', wasteCode: '17 02 01', densityKgM3: 250 },
    { name: 'Déchets verts', wasteCode: '20 02 01', densityKgM3: 200 },
    { name: 'Ferraille', wasteCode: '17 04 05', densityKgM3: 400 },
  ]) {
    materials[m.name] = idOf(await api('POST', '/api/materials', m), 'material')
    made('matériaux')
  }

  const types: Record<string, string> = {}
  for (const t of [
    { name: 'Benne 8 m³', capacityM3: 8, tareKg: 900, dailyRentalPrice: 4.5 },
    { name: 'Benne 15 m³', capacityM3: 15, tareKg: 1400, dailyRentalPrice: 6 },
    { name: 'Benne 20 m³', capacityM3: 20, tareKg: 1800, dailyRentalPrice: 7.5 },
    { name: 'Benne 30 m³', capacityM3: 30, tareKg: 2300, dailyRentalPrice: 9 },
  ]) {
    types[t.name] = idOf(await api('POST', '/api/container-types', t), 'type')
    made('types de bennes')
  }
  for (const [name, n, prefix] of [['Benne 8 m³', 30, 'B08'], ['Benne 15 m³', 30, 'B15'], ['Benne 20 m³', 15, 'B20'], ['Benne 30 m³', 10, 'B30']] as const) {
    await api('POST', '/api/containers', { typeId: types[name], count: n, prefix, locationLabel: DEPOT.name })
    made('bennes', n)
  }

  // 3. Drivers (one with an expired licence), their accounts, trucks (one in maintenance).
  const drivers: string[] = []
  for (const [i, [firstName, lastName]] of DRIVER_NAMES.entries()) {
    const id = idOf(await api('POST', '/api/drivers', {
      firstName, lastName, sector: i < 6 ? 'Grenoble Nord' : 'Grenoble Sud', depotName: DEPOT.name, depotLat: DEPOT.lat, depotLng: DEPOT.lng,
      maxBinSizeM3: i % 4 === 3 ? 15 : 30, phone: `06 12 34 ${pad(10 + i)} ${pad(20 + i)}`, employeeNumber: `CH-${pad(i + 1, 3)}`,
      licenseCategories: ['C', 'CE'],
      licenseExpiry: i === 11 ? `${day(-20)}T00:00:00.000Z` : `${day(400 + i * 30)}T00:00:00.000Z`,
    }), 'driver')
    drivers.push(id)
    made('chauffeurs')
    await api('POST', '/api/users', {
      email: `${firstName.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.${lastName.toLowerCase()}@bennes-dauphine.example`,
      password: PASSWORD, role: 'DRIVER', firstName, lastName, driverRef: id,
    })
    made('comptes chauffeur')
  }
  for (const [firstName, lastName] of [['Hélène', 'Vasseur'], ['Marc', 'Tissot']]) {
    await api('POST', '/api/users', { email: `${firstName.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.${lastName.toLowerCase()}@bennes-dauphine.example`, password: PASSWORD, role: 'DISPATCHER', firstName, lastName })
    made('exploitants')
  }

  const vehicles: string[] = []
  for (let i = 0; i < 14; i++) {
    vehicles.push(idOf(await api('POST', '/api/vehicles', {
      licensePlate: `G${String.fromCharCode(65 + (i % 26))}-${pad(100 + i * 37, 3)}-D${String.fromCharCode(65 + ((i * 7) % 26))}`,
      type: i % 3 === 0 ? 'Ampliroll 26 t' : 'Ampliroll 19 t', brand: i % 2 === 0 ? 'Renault Trucks' : 'Volvo', model: i % 2 === 0 ? 'D Wide' : 'FE',
      maxBins: 1, tareKg: i % 3 === 0 ? 12_500 : 9_800, payloadKg: i % 3 === 0 ? 13_500 : 9_200, weightTon: i % 3 === 0 ? 26 : 19,
      assignedDriverId: i < drivers.length ? drivers[i] : null, status: i === 13 ? 'maintenance' : 'active',
      nextInspection: day(60 + i * 12), mileageKm: 80_000 + i * 11_000, fuelType: 'diesel', year: 2017 + (i % 7),
    }), 'vehicle'))
    made('véhicules')
  }
  await api('POST', '/api/driver-unavailability', { driverId: drivers[10], startDate: TODAY, endDate: day(2), reason: 'conge', notes: 'Congés posés' })
  await api('POST', '/api/vehicle-unavailability', { vehicleId: vehicles[9], startDate: TODAY, endDate: day(1), reason: 'breakdown', notes: 'Flexible hydraulique à remplacer' })

  // 4. Customers, contacts, sites.
  const sites: Array<{ id: string; clientId: string; clientName: string; name: string; address: string; lat: number; lng: number }> = []
  const clients: string[] = []
  for (const [i, c] of CUSTOMERS.entries()) {
    const clientId = idOf(await api('POST', '/api/clients', {
      name: c.name, sector: c.sector, siret: `8${pad(i + 10)} ${pad(100 + i * 3, 3)} ${pad(200 + i * 7, 3)} 000${pad(10 + i)}`,
      email: `compta@${c.name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '').slice(0, 18)}.example`, phone: `04 76 ${pad(10 + i)} ${pad(30 + i)} ${pad(50 + i)}`,
      billingAddress: `${c.sites[0][1]}, ${c.sites[0][3]} ${c.sites[0][2]}`, externalRef: `CLI-${pad(i + 1, 4)}`, paymentTermsDays: i % 3 === 0 ? 45 : 30,
    }), 'client')
    clients.push(clientId)
    made('clients')
    await api('POST', `/api/clients/${clientId}/contacts`, { name: ['Sophie Martin', 'Paul Reynaud', 'Nadia Colin', 'Éric Faure'][i % 4], role: 'Conducteur de travaux', email: `contact${i + 1}@client.example`, phone: `06 45 ${pad(11 + i)} ${pad(22 + i)} ${pad(33 + i)}`, isPrimary: true, receivesInvoices: true })
    made('contacts')
    for (const [name, street, city, zip, lat, lng] of c.sites) {
      const siteId = idOf(await api('POST', '/api/sites', { name, address: street, city, zipCode: zip, latitude: lat, longitude: lng, siteType: 'chantier', clientIds: [clientId], accessNotes: 'Accès poids lourds par le portail principal' }), 'site')
      sites.push({ id: siteId, clientId, clientName: c.name, name, address: `${street}, ${zip} ${city}`, lat, lng })
      made('sites')
    }
  }

  // 5. Prices and contracts.
  const priceList = idOf(await api('POST', '/api/price-lists', { name: 'Tarif général 2026', isDefault: true }), 'priceList')
  for (const r of [
    { code: 'POSE', label: 'Pose de benne', unit: 'UNIT', amount: 85 },
    { code: 'RETRAIT', label: 'Retrait de benne', unit: 'UNIT', amount: 85 },
    { code: 'ECHANGE', label: 'Échange de benne', unit: 'UNIT', amount: 120 },
    { code: 'RENTAL_DAY', label: 'Location journalière', unit: 'DAY', amount: 6, conditions: { freeDays: 7 } },
    { code: 'TREATMENT_TON', label: 'Traitement DIB à la tonne', unit: 'TON', amount: 145, conditions: { materialId: materials.DIB } },
    { code: 'TREATMENT_TON', label: 'Traitement gravats à la tonne', unit: 'TON', amount: 32, conditions: { materialId: materials.Gravats } },
    { code: 'FUEL_PCT', label: 'Indexation gazole', unit: 'PCT', amount: 4 },
  ]) {
    await api('POST', `/api/price-lists/${priceList}/rules`, { vatRate: 20, ...r })
    made('règles tarifaires')
  }
  for (const i of [0, 3, 7]) {
    await api('POST', '/api/contracts', { clientId: clients[i], priceListId: priceList, status: 'ACTIVE', title: `Contrat cadre ${CUSTOMERS[i].name}`, startDate: day(-200), renewal: 'TACIT', billingFrequency: 'MONTHLY', rentalFreeDays: 7, paymentTermsDays: 30 })
    made('contrats')
  }

  // 6. Missions: last week (history), today (a real day, with its difficulties), next days.
  const TYPES = ['POSER', 'RETIRER', 'ECHANGER', 'ECHANGER', 'RETIRER', 'POSER'] as const
  const MATS = ['DIB', 'Gravats', 'Bois', 'Déchets verts', 'DIB', 'Ferraille'] as const
  const mission = (s: typeof sites[number], date: string, i: number, extra: Json = {}): Json => {
    const type = TYPES[i % TYPES.length]
    const mat = MATS[i % MATS.length]
    // Rubble goes in small bins: a 15 m³ bin of rubble weighs more than any truck may carry.
    const size = mat === 'Gravats' ? 8 : [8, 15, 15, 20, 30, 8][i % 6]
    return {
      type, date, address: s.address, latitude: s.lat, longitude: s.lng, estimatedDurationMin: 15, maneuverTimeMin: 5,
      clientId: s.clientId, siteId: s.id, clientName: s.clientName, wasteTypeLabel: mat, binSize: `${size} m³`, binSizeM3: size,
      materialId: materials[mat], containerTypeId: types[`Benne ${size} m³`], ...extra,
    }
  }
  const todayIds: string[] = []
  for (let d = -6; d <= 3; d++) {
    if (d === 0) continue
    const n = d < 0 ? 12 : 8
    for (let i = 0; i < n; i++) {
      await api('POST', '/api/missions', mission(sites[(i * 3 + d + 60) % sites.length], day(d), i + d + 60))
      made(d < 0 ? 'missions passées' : 'missions à venir')
    }
  }
  for (let i = 0; i < 38; i++) {
    const s = sites[i % sites.length]
    const extra: Json = {}
    if (i % 9 === 0) extra.priority = 1                                              // urgent
    if (i % 5 === 1) extra.timeWindow = { openMin: 8 * 60, closeMin: 10 * 60 }       // morning slot
    if (i % 7 === 2) extra.timeWindow = { openMin: 14 * 60, closeMin: 16 * 60 }      // afternoon slot
    if (i % 4 === 0) { extra.weightKg = 1800 + i * 90; extra.weightSource = 'ESTIMATED' }
    if (i === 20) { extra.weightKg = 24_000; extra.weightSource = 'DECLARED'; extra.notes = 'Gravats très denses — poids déclaré par le client' } // heavier than any truck's payload
    if (i === 21) extra.timeWindow = { openMin: 5 * 60, closeMin: 5 * 60 + 20 }      // before the drivers start
    if (i === 22) extra.requiredSkills = ['ADR']                                      // nobody holds it
    todayIds.push(idOf(await api('POST', '/api/missions', mission(s, TODAY, i, extra)), 'mission'))
    made('missions du jour')
  }
  // A pickup that must come after a drop at the same site.
  const dropId = idOf(await api('POST', '/api/missions', mission(sites[1], TODAY, 0, { notes: 'Pose avant le retrait de l\'ancienne benne' })), 'mission')
  await api('POST', '/api/missions', mission(sites[1], TODAY, 1, { dependsOnId: dropId, notes: 'Après la pose de la nouvelle benne' }))
  made('missions du jour', 2)

  // 7. Commercial: quotes (draft, sent, accepted → order), a direct order, invoices, payments.
  const line = (label: string, quantity: number, unitPrice: number, extra: Json = {}): Json => ({ label, quantity, unitPrice, vatRate: 20, ...extra })
  const quoteLines = (site: typeof sites[number]) => [
    line('Pose benne 15 m³', 1, 85, { missionType: 'POSER', containerTypeId: types['Benne 15 m³'], plannedDate: day(2) }),
    line('Location benne 15 m³', 14, 6, { unit: 'DAY' }),
    line('Traitement DIB', 2.4, 145, { unit: 'TON', materialId: materials.DIB }),
    line('Retrait benne 15 m³', 1, 85, { missionType: 'RETIRER', containerTypeId: types['Benne 15 m³'], plannedDate: day(16), description: site.name }),
  ]
  await api('POST', '/api/quotes', { clientId: sites[5].clientId, siteId: sites[5].id, title: 'Évacuation atelier — brouillon', validUntil: day(30), lines: quoteLines(sites[5]) })
  const sentQuote = idOf(await api('POST', '/api/quotes', { clientId: sites[8].clientId, siteId: sites[8].id, title: 'Entretien plateforme', validUntil: day(30), lines: quoteLines(sites[8]) }), 'quote')
  await api('POST', `/api/quotes/${sentQuote}/send`, { markOnly: true })
  const wonQuote = idOf(await api('POST', '/api/quotes', { clientId: sites[0].clientId, siteId: sites[0].id, title: 'Chantier Presqu\'île — lot démolition', validUntil: day(30), lines: quoteLines(sites[0]) }), 'quote')
  await api('POST', `/api/quotes/${wonQuote}/send`, { markOnly: true })
  await api('POST', `/api/quotes/${wonQuote}/decision`, { decision: 'ACCEPTED', by: 'Sophie Martin' })
  await api('POST', `/api/quotes/${wonQuote}/convert`, { kind: 'POSE_RETRAIT', startDate: day(2), createMissions: true })
  made('devis', 3); made('commandes')
  await api('POST', '/api/orders', { clientId: sites[12].clientId, siteId: sites[12].id, kind: 'ONE_OFF', title: 'Enlèvement ferraille', startDate: day(1), createMissions: true, lines: [line('Retrait benne 20 m³', 1, 95, { missionType: 'RETIRER', containerTypeId: types['Benne 20 m³'], plannedDate: day(1) })] })
  made('commandes')

  const invoice = async (clientId: string, lines: Json[], issue: boolean): Promise<{ id: string; totalTTC: number }> => {
    const id = idOf(await api('POST', '/api/invoices', { clientId, lines }), 'invoice')
    made('factures')
    if (!issue) return { id, totalTTC: 0 }
    await api('POST', `/api/invoices/${id}/issue`)
    const inv = await api<Json>('GET', `/api/invoices/${id}`)
    const o = (inv.invoice ?? inv.data ?? inv) as Json
    return { id, totalTTC: Number(o.totalTTC ?? o.totalTtc ?? 0) }
  }
  const monthly = [line('Rotations benne 15 m³ — septembre', 6, 120), line('Location bennes — septembre', 60, 6, { unit: 'DAY' }), line('Traitement DIB — septembre', 11.2, 145, { unit: 'TON' })]
  await invoice(clients[4], [line('Pose benne 8 m³', 1, 85)], false)                                   // draft
  const paid = await invoice(clients[0], monthly, true)
  const partly = await invoice(clients[3], monthly, true)
  const unpaid = await invoice(clients[7], [line('Échange benne 30 m³', 3, 140), line('Traitement gravats', 21.5, 32, { unit: 'TON' })], true)
  if (paid.totalTTC > 0) { await api('POST', '/api/payments', { clientId: clients[0], invoiceId: paid.id, amount: paid.totalTTC, method: 'TRANSFER', reference: 'VIR SEPA BATIR ISERE', receivedAt: day(-3) }); made('paiements') }
  if (partly.totalTTC > 0) { await api('POST', '/api/payments', { clientId: clients[3], invoiceId: partly.id, amount: Math.round(partly.totalTTC * 40) / 100, method: 'CHECK', reference: 'Chèque n° 4410233', receivedAt: day(-1) }); made('paiements') }
  await api('POST', `/api/invoices/${unpaid.id}/credit-note`, { lines: [line('Geste commercial — retard de rotation', 1, 140)] })
  made('avoirs (brouillon)')

  console.log('\nBennes du Dauphiné — entreprise pilote créée :')
  for (const [k, v] of Object.entries(count)) console.log(`  ${String(v).padStart(4)}  ${k}`)
  console.log(`\nConnexion : ${ADMIN_EMAIL}  /  ${PASSWORD}`)
  console.log('Exploitants : helene.vasseur@… et marc.tissot@… — chauffeurs : prenom.nom@bennes-dauphine.example (même mot de passe).')
  console.log(`Aujourd'hui (${TODAY}) : ${todayIds.length + 2} missions dont des urgences, des créneaux, une dépendance, et trois volontairement impossibles (poids, horaire, habilitation).`)
}

// Explicit exit: the tenant client keeps a pool (and a Redis subscription) open.
main().then(() => unscopedPrisma.$disconnect()).then(() => process.exit(0)).catch(async err => {
  console.error(err instanceof Error ? err.message : err)
  await unscopedPrisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
