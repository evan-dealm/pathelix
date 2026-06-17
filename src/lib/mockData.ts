import type { Driver, Mission, Exutoire } from '@/lib/types'

function makeRng(seed: number) {
  let s = seed >>> 0
  return {
    next(): number {
      s = (Math.imul(s, 1664525) + 1013904223) | 0
      return (s >>> 0) / 4294967296
    },
    int(min: number, max: number): number {
      return Math.floor(this.next() * (max - min + 1)) + min
    },
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(this.next() * arr.length)]
    },
    coord(center: number, spread: number): number {
      const v = center + (this.next() * 2 - 1) * spread
      return Math.round(v * 10000) / 10000
    },
  }
}

const FIRST_NAMES = [
  'Jean', 'Marc', 'Pierre', 'Thomas', 'Luc', 'Nicolas', 'Julien', 'Antoine',
  'Christophe', 'Sébastien', 'David', 'Laurent', 'Maxime', 'Kevin', 'Stéphane',
  'Benoît', 'Gilles', 'Philippe', 'Thierry', 'Yann', 'Damien', 'Franck', 'Romain',
  'Alexandre', 'Guillaume', 'Mathieu', 'Vincent', 'Cédric', 'Alexis', 'Grégory',
  'Sophie', 'Marie', 'Claire', 'Isabelle', 'Nathalie', 'Sandrine', 'Valérie',
  'Aurélie', 'Julie', 'Karine', 'Laure', 'Céline', 'Anne', 'Sylvie', 'Stéphanie',
] as const

const LAST_NAMES = [
  'Dupont', 'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard',
  'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel',
  'Girard', 'André', 'Mercier', 'Blanc', 'Guérin', 'Boyer', 'Garnier', 'Chevalier',
  'François', 'Legrand', 'Gauthier', 'Perrin', 'Robin', 'Clément', 'Morin',
  'Nicolas', 'Henry', 'Rousseau', 'Mathieu', 'Fontaine', 'Picard', 'Renard',
  'Barbier', 'Renaud', 'Fleury', 'Carpentier', 'Colin', 'Lemaire', 'Masson',
] as const

const CLIENT_PFX = [
  'Chantier', 'Résidence', 'Copropriété', 'SCI', 'ZI', 'ZA', 'Entrepôt',
  'Bâtiment', 'Hôtel', 'Restaurant', 'Centre comm.', 'Supermarché', 'Usine',
  'Maison', 'Villa', 'Clinique', 'École', 'Gymnase', 'Lycée', 'Salle',
] as const

const CLIENT_SFX = [
  'du Centre', 'les Pins', 'du Lac', 'Bellevue', 'du Stade', 'Horizon',
  'les Tilleuls', 'des Alpes', 'Neuf', 'Moderne', 'du Parc', 'Lumière',
  'Prestige', 'des Cimes', 'du Torrent', 'la Forêt', 'des Savoies', 'du Mont',
] as const

const WASTE_TYPES = [
  'Gravats', 'DIB', 'Ferraille', 'Déchets verts', 'Encombrants',
  'Papiers/Cartons', 'Déchets industriels', 'Bois',
] as const

const BIN_SIZES = [
  { label: '5m³',  m3: 5  },
  { label: '7m³',  m3: 7  },
  { label: '8m³',  m3: 8  },
  { label: '10m³', m3: 10 },
  { label: '12m³', m3: 12 },
  { label: '15m³', m3: 15 },
  { label: '20m³', m3: 20 },
] as const

const MISSION_TYPES = [
  'POSER', 'POSER', 'POSER',
  'RETIRER', 'RETIRER', 'RETIRER',
  'ECHANGER', 'ECHANGER', 'ECHANGER',
  'VIDER', 'VIDER',
] as const

const TIME_WINDOWS = [
  { openMin: 420,  closeMin: 600  },
  { openMin: 480,  closeMin: 660  },
  { openMin: 540,  closeMin: 720  },
  { openMin: 600,  closeMin: 840  },
  { openMin: 780,  closeMin: 1020 },
] as const

const MAX_BIN_SIZES = [8, 10, 12, 15, 15, 15, 20, 20, 25] as const

const SECTORS = [
  {
    name: 'Annecy',        depotName: 'Dépôt Annecy',
    depotLat: 45.8992, depotLng: 6.1294,
    cLat: 45.8992, cLng: 6.1294, spread: 0.06,
    driverCount: 12, missionCount: 65,
    pc: '74000', city: 'Annecy',
    exuIdx: [0, 1, 2],
    streets: [
      'Rue Carnot', 'Avenue de Genève', 'Rue de la République', 'Chemin du Pré Bénit',
      "Route d'Albigny", 'Rue des Marquisats', 'Boulevard du Fier', 'Chemin des Fins',
      'Route de Chavanod', 'Impasse des Érables', 'Avenue du Parmelan', 'Rue Jean Jaurès',
      'Boulevard du Lac', 'Rue Royale', 'Avenue de Cran',
    ],
  },
  {
    name: 'Chambéry',      depotName: 'Dépôt Chambéry',
    depotLat: 45.5646, depotLng: 5.9178,
    cLat: 45.5646, cLng: 5.9178, spread: 0.06,
    driverCount: 12, missionCount: 65,
    pc: '73000', city: 'Chambéry',
    exuIdx: [3, 4],
    streets: [
      'Rue Nicolas Chorier', 'Avenue de la Boisse', 'Boulevard du Centenaire',
      'Rue des Landiers', 'Avenue de Bissy', 'Route de Lyon', 'Chemin de Monterban',
      'Rue de la Tuilerie', 'Avenue du Comte Vert', "Rue Croix d'Or",
      'Boulevard Denfert-Rochereau', 'Impasse des Charmilles', 'Rue Basse du Château',
      'Avenue Pierre Lanfrey', 'Rue de Boigne',
    ],
  },
  {
    name: 'Rumilly',       depotName: 'Dépôt Rumilly',
    depotLat: 45.8681, depotLng: 5.9446,
    cLat: 45.8681, cLng: 5.9446, spread: 0.04,
    driverCount: 8, missionCount: 35,
    pc: '74150', city: 'Rumilly',
    exuIdx: [6],
    streets: [
      "Place de l'Hôtel de Ville", 'Route de Frangy', 'Rue du Commerce',
      'Chemin des Grandes Terres', 'Avenue Jean Jaurès', "Route d'Annecy",
      'Impasse des Artisans', 'Zone Industrielle Sud', 'Rue du Pont-Neuf',
    ],
  },
  {
    name: 'Aix-les-Bains', depotName: 'Dépôt Aix-les-Bains',
    depotLat: 45.6886, depotLng: 5.9196,
    cLat: 45.6886, cLng: 5.9196, spread: 0.04,
    driverCount: 8, missionCount: 35,
    pc: '73100', city: 'Aix-les-Bains',
    exuIdx: [5],
    streets: [
      'Avenue du Rivage', 'Rue George I', 'Boulevard Wilson',
      'Avenue Charles de Gaulle', 'Route du Bord du Lac', 'Chemin des Combes',
      'Avenue de Marlioz', 'Rue de Genève', 'Boulevard des Côtes',
    ],
  },
  {
    name: 'Albertville',   depotName: 'Dépôt Albertville',
    depotLat: 45.6752, depotLng: 6.3935,
    cLat: 45.6752, cLng: 6.3935, spread: 0.04,
    driverCount: 8, missionCount: 35,
    pc: '73200', city: 'Albertville',
    exuIdx: [7],
    streets: [
      'Avenue des Chasseurs Alpins', 'Rue des Iles', 'Route de Moutiers',
      'Rue Gabriel Péri', 'Boulevard de Tarentaise', 'Chemin du Faubourg',
      'Avenue Paul Langevin', 'Rue de la République',
    ],
  },
  {
    name: 'Cluses',        depotName: 'Dépôt Cluses',
    depotLat: 46.0636, depotLng: 6.5799,
    cLat: 46.0636, cLng: 6.5799, spread: 0.04,
    driverCount: 6, missionCount: 25,
    pc: '74300', city: 'Cluses',
    exuIdx: [8],
    streets: [
      'Avenue Adrien Bonnevie', 'Route de Scionzier', 'Zone Industrielle Cluses',
      'Rue du Pré Bénit', 'Chemin des Bourgeons', 'Rue de Châtillon',
    ],
  },
  {
    name: 'Thonon',        depotName: 'Dépôt Thonon-les-Bains',
    depotLat: 46.3700, depotLng: 6.4751,
    cLat: 46.3700, cLng: 6.4751, spread: 0.04,
    driverCount: 4, missionCount: 20,
    pc: '74200', city: 'Thonon-les-Bains',
    exuIdx: [9],
    streets: [
      'Avenue du Général de Gaulle', 'Rue des Granges', "Route d'Évian",
      'Boulevard de la Corniche', 'Chemin du Lac', 'Rue du Commerce',
    ],
  },
  {
    name: 'Bonneville',    depotName: 'Dépôt Bonneville',
    depotLat: 46.0783, depotLng: 6.4026,
    cLat: 46.0783, cLng: 6.4026, spread: 0.03,
    driverCount: 2, missionCount: 20,
    pc: '74130', city: 'Bonneville',
    exuIdx: [8],
    streets: [
      'Avenue de la Gare', 'Rue du Pont', 'Chemin des Vergers',
      'Zone Artisanale', 'Route de Genève', 'Impasse des Marronniers',
    ],
  },
] as const

let _cachedExutoires: Exutoire[] | null = null

export function getMockExutoires(): Exutoire[] {
  if (_cachedExutoires) return _cachedExutoires

  _cachedExutoires = [
    {
      id: 'exutoire-1',
      name: 'Centre Tri Annecy-le-Vieux',
      address: '12 Route du Grand Quartier, 74940 Annecy-le-Vieux',
      lat: 45.9230, lng: 6.1612,
      openingHoursOpen: 420, openingHoursClose: 1020, closedDays: [0],
      acceptedWasteTypes: ['Gravats', 'Ferraille', 'Encombrants', 'DIB', 'Déchets industriels'],
      serviceTimeMin: 20,
    },
    {
      id: 'exutoire-2',
      name: 'Déchetterie Seynod',
      address: "5 Rue de l'Artisanat, 74600 Seynod",
      lat: 45.8710, lng: 6.0880,
      openingHoursOpen: 480, openingHoursClose: 1080, closedDays: [0, 6],
      acceptedWasteTypes: ['Déchets verts', 'Papiers/Cartons', 'Encombrants', 'Bois'],
      serviceTimeMin: 15,
    },
    {
      id: 'exutoire-3',
      name: 'Plateforme Chavanod',
      address: 'ZA Les Grandes Terres, 74650 Chavanod',
      lat: 45.8780, lng: 6.0760,
      openingHoursOpen: 420, openingHoursClose: 990, closedDays: [0],
      acceptedWasteTypes: ['Gravats', 'DIB', 'Ferraille', 'Bois', 'Encombrants'],
      serviceTimeMin: 25,
    },
    {
      id: 'exutoire-4',
      name: 'Centre Recyclage Chambéry',
      address: '88 Rue des Landiers, 73000 Chambéry',
      lat: 45.5520, lng: 5.9280,
      openingHoursOpen: 420, openingHoursClose: 1020, closedDays: [0],
      acceptedWasteTypes: ['Gravats', 'Ferraille', 'DIB', 'Déchets industriels', 'Encombrants'],
      serviceTimeMin: 20,
    },
    {
      id: 'exutoire-5',
      name: 'Déchetterie Bissy',
      address: "3 Impasse des Ateliers, 73000 Chambéry",
      lat: 45.5880, lng: 5.9120,
      openingHoursOpen: 480, openingHoursClose: 1080, closedDays: [0, 6],
      acceptedWasteTypes: ['Déchets verts', 'Papiers/Cartons', 'Bois', 'Encombrants'],
      serviceTimeMin: 15,
    },
    {
      id: 'exutoire-6',
      name: 'Centre Valorisation Aix-les-Bains',
      address: '15 Avenue de Marlioz, 73100 Aix-les-Bains',
      lat: 45.6870, lng: 5.9110,
      openingHoursOpen: 450, openingHoursClose: 990, closedDays: [0],
      acceptedWasteTypes: ['Papiers/Cartons', 'Déchets verts', 'Encombrants', 'Bois'],
      serviceTimeMin: 25,
    },
    {
      id: 'exutoire-7',
      name: 'Déchetterie Rumilly',
      address: 'Zone Artisanale du Pont-Neuf, 74150 Rumilly',
      lat: 45.8740, lng: 5.9520,
      openingHoursOpen: 480, openingHoursClose: 1020, closedDays: [0, 6],
      acceptedWasteTypes: ['Gravats', 'Ferraille', 'DIB', 'Déchets verts', 'Encombrants'],
      serviceTimeMin: 20,
    },
    {
      id: 'exutoire-8',
      name: 'Centre Tri Albertville',
      address: 'Route de Moutiers, 73200 Albertville',
      lat: 45.6700, lng: 6.3910,
      openingHoursOpen: 420, openingHoursClose: 1020, closedDays: [0],
      acceptedWasteTypes: ['Gravats', 'Ferraille', 'DIB', 'Déchets industriels', 'Encombrants'],
      serviceTimeMin: 20,
    },
    {
      id: 'exutoire-9',
      name: 'Déchetterie Bonneville-Cluses',
      address: 'Zone Industrielle, 74130 Bonneville',
      lat: 46.0720, lng: 6.4000,
      openingHoursOpen: 480, openingHoursClose: 1020, closedDays: [0, 6],
      acceptedWasteTypes: ['Gravats', 'DIB', 'Ferraille', 'Bois', 'Encombrants'],
      serviceTimeMin: 20,
    },
    {
      id: 'exutoire-10',
      name: 'Plateforme Thonon-les-Bains',
      address: 'Route du Port, 74200 Thonon-les-Bains',
      lat: 46.3680, lng: 6.4730,
      openingHoursOpen: 480, openingHoursClose: 1020, closedDays: [0, 6],
      acceptedWasteTypes: ['Déchets verts', 'DIB', 'Encombrants', 'Papiers/Cartons'],
      serviceTimeMin: 20,
    },
  ]

  return _cachedExutoires
}

let _cachedDrivers: Driver[] | null = null

export function getMockDrivers(): Driver[] {
  if (_cachedDrivers) return _cachedDrivers

  const rng = makeRng(2026)
  const drivers: Driver[] = []
  let fnIdx = 0, lnIdx = 0, driverNum = 1

  for (const s of SECTORS) {
    for (let i = 0; i < s.driverCount; i++) {
      drivers.push({
        id:              `driver-${driverNum}`,
        firstName:       FIRST_NAMES[fnIdx % FIRST_NAMES.length],
        lastName:        LAST_NAMES[lnIdx  % LAST_NAMES.length],
        sector:          s.name,
        depotName:       s.depotName,
        depotLat:        s.depotLat,
        depotLng:        s.depotLng,
        vehicleCapacity: rng.int(1, 2),
        maxBinSizeM3:    rng.pick(MAX_BIN_SIZES),
      })
      fnIdx += 3
      lnIdx += 7
      driverNum++
    }
  }

  _cachedDrivers = drivers
  return drivers
}

let _cachedMissions: { date: string; missions: Mission[] } | null = null

export function getMockMissions(date?: string): Mission[] {
  const d = date ?? new Date().toISOString().slice(0, 10)

  if (_cachedMissions && _cachedMissions.date === d) {
    return _cachedMissions.missions
  }

  const exutoires = getMockExutoires()
  const rng = makeRng(4052)
  const missions: Mission[] = []
  let missionNum = 1

  const sectorExuIds: Record<string, string[]> = {
    'Annecy':        ['exutoire-1', 'exutoire-2', 'exutoire-3'],
    'Chambéry':      ['exutoire-4', 'exutoire-5'],
    'Rumilly':       ['exutoire-7'],
    'Aix-les-Bains': ['exutoire-6'],
    'Albertville':   ['exutoire-8'],
    'Cluses':        ['exutoire-9'],
    'Thonon':        ['exutoire-10'],
    'Bonneville':    ['exutoire-9'],
  }
  void exutoires

  for (const s of SECTORS) {
    const exuIds = sectorExuIds[s.name] ?? ['exutoire-1']

    for (let i = 0; i < s.missionCount; i++) {
      const type    = rng.pick(MISSION_TYPES)
      const waste   = rng.pick(WASTE_TYPES)
      const bin     = rng.pick(BIN_SIZES)
      const street  = rng.pick(s.streets)
      const num     = rng.int(1, 120)
      const address = `${num} ${street}, ${s.pc} ${s.city}`
      const lat     = rng.coord(s.cLat, s.spread)
      const lng     = rng.coord(s.cLng, s.spread)

      const dur = type === 'VIDER'    ? rng.int(10, 20)
                : type === 'ECHANGER' ? rng.int(30, 55)
                : rng.int(15, 45)

      const prioPick = rng.next()
      const priority: 1 | 2 | 3 | undefined =
        prioPick < 0.10 ? 1 :
        prioPick < 0.35 ? 2 :
        prioPick < 0.70 ? 3 : undefined

      let timeWindow: { openMin: number; closeMin: number } | undefined
      const twChance = (priority !== undefined && priority <= 2) ? 0.40 : 0.08
      if (rng.next() < twChance) {
        timeWindow = rng.pick(TIME_WINDOWS)
      }

      let linkedExutoireId: string | undefined
      if (type === 'VIDER') {
        linkedExutoireId = rng.pick(exuIds)
      } else if ((type === 'RETIRER' || type === 'ECHANGER') && rng.next() < 0.15) {
        linkedExutoireId = rng.pick(exuIds)
      }

      const clientName = `${rng.pick(CLIENT_PFX)} ${rng.pick(CLIENT_SFX)}`

      missions.push({
        id:                   `mission-${missionNum}`,
        type,
        date:                 d,
        address,
        latitude:             lat,
        longitude:            lng,
        estimatedDurationMin: dur,
        maneuverTimeMin:      rng.int(5, 20),
        clientName,
        wasteTypeLabel:       waste,
        binSize:              bin.label,
        binSizeM3:            bin.m3,
        priority,
        timeWindow,
        linkedExutoireId,
      })
      missionNum++
    }
  }

  _cachedMissions = { date: d, missions }
  return missions
}
