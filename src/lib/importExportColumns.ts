import type { ExportColumn } from './exportUtils'
import type { Mission }      from './types'

export type ParsedDriver = {
  firstName: string
  lastName:  string
  sector:    string
  depotName: string
  depotLat:  number
  depotLng:  number
  maxBinSizeM3?:    number
  vehicleCapacity?: number
  phone?:    string
  notes?:    string
}

export type ParsedMission = {
  type:                 string
  date:                 string
  address:              string
  latitude:             number
  longitude:            number
  estimatedDurationMin: number
  maneuverTimeMin:      number
  clientName?:          string
  wasteTypeLabel?:      string
  binSize?:             string
  binSizeM3?:           number
  equipmentType?:       string
  accessNotes?:         string
  priority?:            1 | 2 | 3
  timeWindow?:          { openMin: number; closeMin: number }
}

export type ParsedVehicle = {
  licensePlate: string
  type:         string
  brand:        string
  model:        string
  capacityM3:   number
  maxBins?:     number
  mileageKm:    number
  status:       string
  weightTon:    number
  heightM:      number
  widthM:       number
  lengthM:      number
  axleCount:    number
  hazmat:       boolean
  notes:        string
}

export type ParsedExutoire = {
  name:               string
  address:            string
  lat:                number
  lng:                number
  openingHoursOpen:   number
  openingHoursClose:  number
  serviceTimeMin:     number
  acceptedWasteTypes: string[]
  closedDays:         number[]
}

export type ParsedClient = {
  name:        string
  contact:     string
  phone:       string
  email:       string
  vip:         boolean
  requiresBsd: boolean
  notes:       string
}

export type ParsedSite = {
  name:               string
  address:            string
  latitude:           number
  longitude:          number
  sector:             string
  defaultManeuverMin: number
  accessNotes:        string
}

function col(row: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = row[n]
    if (v !== undefined && v !== '') return v.trim()
  }
  return ''
}

function parseNum(s: string, fallback = 0): number {
  const n = parseFloat(s.replace(',', '.'))
  return isNaN(n) ? fallback : n
}

function parseBool(s: string): boolean {
  return ['oui', 'true', '1', 'yes', 'vrai'].includes(s.toLowerCase())
}

function minToHHMM(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function hhmmToMin(s: string): number {
  const parts = s.split(':').map(Number)
  return (parts[0] || 0) * 60 + (parts[1] || 0)
}

export const DRIVER_COLUMNS: ExportColumn[] = [
  { key: 'firstName', header: 'Prenom' },
  { key: 'lastName', header: 'Nom' },
  { key: 'phone', header: 'Telephone' },
  { key: 'sector', header: 'Secteur' },
  { key: 'depotName', header: 'Depot' },
  { key: 'depotLat', header: 'Latitude' },
  { key: 'depotLng', header: 'Longitude' },
  { key: 'vehicleCapacity', header: 'Capacite_bennes' },
  { key: 'maxBinSizeM3', header: 'Benne_m3' },
  { key: 'weeklyHoursMax', header: 'Heures_semaine' },
  { key: 'notes', header: 'Notes' },
  { key: 'skills', header: 'Competences', format: v => Array.isArray(v) ? (v as string[]).join(', ') : '' },
]

export function parseDriverRows(rows: Record<string, string>[]): ParsedDriver[] {
  return rows
    .map((r): ParsedDriver | null => {
      const firstName = col(r, 'prenom', 'firstname', 'first_name')
      const lastName = col(r, 'nom', 'lastname', 'last_name', 'nom_famille')
      if (!firstName && !lastName) return null
      return {
        firstName,
        lastName: lastName || '',
        sector: col(r, 'secteur', 'sector', 'zone', 'agence'),
        depotName: col(r, 'depot', 'depotname', 'depot_name', 'nom_depot') || col(r, 'secteur', 'sector'),
        depotLat: parseNum(col(r, 'lat', 'latitude', 'depotlat', 'depot_lat')),
        depotLng: parseNum(col(r, 'lng', 'longitude', 'depotlng', 'depot_lng')),
        maxBinSizeM3: parseNum(col(r, 'benne_m3', 'maxbinsizem3', 'max_benne', 'taille_benne', 'capacite_benne')) || undefined,
        vehicleCapacity: parseInt(col(r, 'capacite', 'vehiclecapacity', 'nb_bennes', 'vehicle_capacity', 'capacite_bennes')) || undefined,
        phone: col(r, 'telephone', 'phone', 'tel', 'mobile', 'portable') || undefined,
        notes: col(r, 'notes', 'commentaire', 'remarque') || undefined,
      }
    })
    .filter((x): x is ParsedDriver => x !== null)
}

export const MISSION_COLUMNS: ExportColumn[] = [
  { key: 'date', header: 'Date' },
  { key: 'type', header: 'Type' },
  { key: 'clientName', header: 'Client' },
  { key: 'address', header: 'Adresse' },
  { key: 'latitude', header: 'Latitude' },
  { key: 'longitude', header: 'Longitude' },
  { key: 'estimatedDurationMin', header: 'Duree_min' },
  { key: 'maneuverTimeMin', header: 'Manoeuvre_min' },
  { key: 'priority', header: 'Priorite' },
  { key: 'wasteTypeLabel', header: 'Type_dechet' },
  { key: 'binSize', header: 'Taille_benne' },
  { key: 'binSizeM3', header: 'Benne_m3' },
  { key: 'equipmentType', header: 'Equipement' },
  { key: 'accessNotes', header: 'Notes_acces' },
  { key: 'notes', header: 'Notes' },
  { key: 'timeWindow', header: 'Fenetre_ouverture', format: v => {
    const tw = v as { openMin?: number; closeMin?: number } | undefined
    return tw?.openMin !== undefined ? minToHHMM(tw.openMin) : ''
  }},
  { key: '_twClose', header: 'Fenetre_fermeture', format: (_v) => '' },
]

export function parseMissionRows(rows: Record<string, string>[]): ParsedMission[] {
  return rows
    .map((r): ParsedMission | null => {
      const type = col(r, 'type').toUpperCase() || 'POSER'
      const date = col(r, 'date')
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

      const twOpen  = col(r, 'ouverture', 'fenetre_ouverture', 'timewindowopen', 'tw_open', 'creneau_debut')
      const twClose = col(r, 'fermeture', 'fenetre_fermeture', 'timewindowclose', 'tw_close', 'creneau_fin')
      const prio    = col(r, 'priorite', 'priority', 'prio')

      const m: ParsedMission = {
        type,
        date,
        address:              col(r, 'adresse', 'address', 'addr', 'lieu') || '',
        latitude:             parseNum(col(r, 'latitude', 'lat')),
        longitude:            parseNum(col(r, 'longitude', 'lng', 'long')),
        estimatedDurationMin: parseInt(col(r, 'duree_min', 'duree', 'duration', 'estimateddurationmin', 'temps')) || 30,
        maneuverTimeMin:      parseInt(col(r, 'manoeuvre_min', 'manoeuvre', 'maneuver', 'maneuvre', 'maneuvretimemin')) || 15,
        clientName:     col(r, 'client', 'clientname', 'client_name', 'nom_client') || undefined,
        wasteTypeLabel: col(r, 'type_dechet', 'dechet', 'dechets', 'wastetypelabel', 'waste', 'matiere') || undefined,
        binSize:        col(r, 'taille_benne', 'benne', 'binsize', 'bin_size', 'volume') || undefined,
        binSizeM3:      parseNum(col(r, 'benne_m3', 'binsizem3', 'bennem3', 'volume_m3')) || undefined,
        equipmentType:  col(r, 'equipement', 'equipmenttype', 'equipment', 'materiel') || undefined,
        accessNotes:    col(r, 'notes_acces', 'acces', 'accessnotes', 'access_notes', 'notes', 'commentaire') || undefined,
        priority:       prio === '1' ? 1 : prio === '2' ? 2 : prio === '3' ? 3 : undefined,
      }
      if (twOpen && twClose) {
        m.timeWindow = { openMin: hhmmToMin(twOpen), closeMin: hhmmToMin(twClose) }
      }
      return m
    })
    .filter((x): x is ParsedMission => x !== null)
}

export function missionExportData(missions: Mission[]): (Mission & { _twClose: string })[] {
  return missions.map(m => ({
    ...m,
    _twClose: m.timeWindow?.closeMin !== undefined ? minToHHMM(m.timeWindow.closeMin) : '',
  }))
}

export const VEHICLE_COLUMNS: ExportColumn[] = [
  { key: 'licensePlate', header: 'Immatriculation' },
  { key: 'type', header: 'Type' },
  { key: 'brand', header: 'Marque' },
  { key: 'model', header: 'Modele' },
  { key: 'capacityM3', header: 'Capacite_m3' },
  { key: 'maxBins', header: 'Max_bennes' },
  { key: 'mileageKm', header: 'Kilometrage' },
  { key: 'status', header: 'Statut' },
  { key: 'weightTon', header: 'Poids_tonnes' },
  { key: 'heightM', header: 'Hauteur_m' },
  { key: 'widthM', header: 'Largeur_m' },
  { key: 'lengthM', header: 'Longueur_m' },
  { key: 'axleCount', header: 'Essieux' },
  { key: 'hazmat', header: 'Hazmat', format: v => v ? 'Oui' : 'Non' },
  { key: 'notes', header: 'Notes' },
]

export function parseVehicleRows(rows: Record<string, string>[]): ParsedVehicle[] {
  return rows
    .map((r): ParsedVehicle | null => {
      const plate = col(r, 'immatriculation', 'plaque', 'licenseplate', 'license_plate', 'plate')
      if (!plate) return null
      return {
        licensePlate: plate,
        type:         col(r, 'type', 'categorie', 'vehicletype') || 'PL',
        brand:        col(r, 'marque', 'brand', 'constructeur') || '',
        model:        col(r, 'modele', 'model') || '',
        capacityM3:   parseNum(col(r, 'capacite', 'capacity', 'capacitym3', 'capacite_m3', 'volume')),
        maxBins:      parseInt(col(r, 'bennes', 'maxbins', 'max_bins', 'nb_bennes', 'max_bennes')) || undefined,
        mileageKm:    parseNum(col(r, 'kilometrage', 'mileage', 'km', 'mileagekm')),
        status:       col(r, 'statut', 'status') || 'active',
        weightTon:    parseNum(col(r, 'poids', 'poids_tonnes', 'weightton', 'weight')),
        heightM:      parseNum(col(r, 'hauteur', 'hauteur_m', 'heightm', 'height')),
        widthM:       parseNum(col(r, 'largeur', 'largeur_m', 'widthm', 'width')),
        lengthM:      parseNum(col(r, 'longueur', 'longueur_m', 'lengthm', 'length')),
        axleCount:    parseInt(col(r, 'essieux', 'nb_essieux', 'axlecount', 'axles')) || 2,
        hazmat:       parseBool(col(r, 'hazmat', 'adr', 'matieres_dangereuses', 'matdang')),
        notes:        col(r, 'notes', 'commentaire', 'remarque') || '',
      }
    })
    .filter((x): x is ParsedVehicle => x !== null)
}

export const EXUTOIRE_COLUMNS: ExportColumn[] = [
  { key: 'name', header: 'Nom' },
  { key: 'address', header: 'Adresse' },
  { key: 'lat', header: 'Latitude' },
  { key: 'lng', header: 'Longitude' },
  { key: 'openingHoursOpen', header: 'Ouverture', format: v => typeof v === 'number' ? minToHHMM(v as number) : '' },
  { key: 'openingHoursClose', header: 'Fermeture', format: v => typeof v === 'number' ? minToHHMM(v as number) : '' },
  { key: 'serviceTimeMin', header: 'Duree_service_min' },
  { key: 'acceptedWasteTypes', header: 'Dechets_acceptes', format: v => Array.isArray(v) ? (v as string[]).join(', ') : '' },
  { key: 'closedDays', header: 'Jours_fermes', format: v => {
    const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
    return Array.isArray(v) ? (v as number[]).map(d => days[d] || d).join(', ') : ''
  }},
]

export function parseExutoireRows(rows: Record<string, string>[]): ParsedExutoire[] {
  return rows
    .map((r): ParsedExutoire | null => {
      const name = col(r, 'nom', 'name', 'exutoire', 'centre_tri', 'plateforme')
      if (!name) return null
      const wasteRaw = col(r, 'dechets', 'types_dechets', 'waste', 'wastetypes', 'dechets_acceptes')
      return {
        name,
        address:            col(r, 'adresse', 'address', 'addr', 'lieu') || '',
        lat:                parseNum(col(r, 'latitude', 'lat')),
        lng:                parseNum(col(r, 'longitude', 'lng', 'long', 'lon')),
        openingHoursOpen:   hhmmToMin(col(r, 'ouverture', 'open', 'heure_ouverture', 'opening') || '06:00'),
        openingHoursClose:  hhmmToMin(col(r, 'fermeture', 'close', 'heure_fermeture', 'closing') || '18:00'),
        serviceTimeMin:     parseInt(col(r, 'duree_service', 'service', 'service_min', 'duree', 'duree_service_min')) || 15,
        acceptedWasteTypes: wasteRaw ? wasteRaw.split(/[|,;]/).map(s => s.trim()).filter(Boolean) : [],
        closedDays:         [],
      }
    })
    .filter((x): x is ParsedExutoire => x !== null)
}

export const CLIENT_COLUMNS: ExportColumn[] = [
  { key: 'name', header: 'Nom' },
  { key: 'contact', header: 'Contact' },
  { key: 'phone', header: 'Telephone' },
  { key: 'email', header: 'Email' },
  { key: 'vip', header: 'VIP', format: v => v ? 'Oui' : 'Non' },
  { key: 'requiresBsd', header: 'BSD', format: v => v ? 'Oui' : 'Non' },
  { key: 'notes', header: 'Notes' },
]

export function parseClientRows(rows: Record<string, string>[]): ParsedClient[] {
  return rows
    .map((r): ParsedClient | null => {
      const name = col(r, 'nom', 'name', 'client', 'raison_sociale', 'societe')
      if (!name) return null
      return {
        name,
        contact:     col(r, 'contact', 'interlocuteur', 'responsable') || '',
        phone:       col(r, 'telephone', 'phone', 'tel', 'mobile') || '',
        email:       col(r, 'email', 'mail', 'courriel') || '',
        vip:         parseBool(col(r, 'vip', 'prioritaire')),
        requiresBsd: parseBool(col(r, 'bsd', 'requiresbsd', 'bordereau')),
        notes:       col(r, 'notes', 'commentaire', 'remarque') || '',
      }
    })
    .filter((x): x is ParsedClient => x !== null)
}

export const SITE_COLUMNS: ExportColumn[] = [
  { key: 'name', header: 'Nom' },
  { key: 'address', header: 'Adresse' },
  { key: 'latitude', header: 'Latitude' },
  { key: 'longitude', header: 'Longitude' },
  { key: 'sector', header: 'Secteur' },
  { key: 'defaultManeuverMin', header: 'Manoeuvre_min' },
  { key: 'accessNotes', header: 'Notes_acces' },
]

export function parseSiteRows(rows: Record<string, string>[]): ParsedSite[] {
  return rows
    .map((r): ParsedSite | null => {
      const name = col(r, 'nom', 'name', 'site', 'chantier', 'lieu')
      if (!name) return null
      return {
        name,
        address:            col(r, 'adresse', 'address', 'addr') || '',
        latitude:           parseNum(col(r, 'latitude', 'lat')),
        longitude:          parseNum(col(r, 'longitude', 'lng', 'long', 'lon')),
        sector:             col(r, 'secteur', 'sector', 'zone') || '',
        defaultManeuverMin: parseInt(col(r, 'manoeuvre', 'manoeuvre_min', 'maneuver')) || 15,
        accessNotes:        col(r, 'acces', 'notes_acces', 'accessnotes', 'notes', 'commentaire') || '',
      }
    })
    .filter((x): x is ParsedSite => x !== null)
}
