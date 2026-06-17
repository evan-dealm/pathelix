import { describe, it, expect } from 'vitest'
import {
  MISSION_TYPE_LABELS,
  MISSION_TYPE_ICONS,
  MISSION_TYPE_COLORS,
  MISSION_TYPE_HEX,
} from '../types'
import type { MissionType, Mission, Driver, Vehicle, Exutoire, TenantSettings } from '../types'

const ALL_MISSION_TYPES: MissionType[] = [
  'POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE',
  'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR',
]

describe('MissionType — complétude des constantes', () => {
  it('10 types de missions', () => {
    expect(ALL_MISSION_TYPES).toHaveLength(10)
  })

  it('MISSION_TYPE_LABELS couvre tous les types', () => {
    for (const t of ALL_MISSION_TYPES) {
      expect(MISSION_TYPE_LABELS[t]).toBeDefined()
      expect(typeof MISSION_TYPE_LABELS[t]).toBe('string')
      expect(MISSION_TYPE_LABELS[t].length).toBeGreaterThan(0)
    }
  })

  it('MISSION_TYPE_ICONS couvre tous les types', () => {
    for (const t of ALL_MISSION_TYPES) {
      expect(MISSION_TYPE_ICONS[t]).toBeDefined()
      expect(MISSION_TYPE_ICONS[t].length).toBeGreaterThan(0)
    }
  })

  it('MISSION_TYPE_COLORS couvre tous les types', () => {
    for (const t of ALL_MISSION_TYPES) {
      expect(MISSION_TYPE_COLORS[t]).toBeDefined()
      expect(MISSION_TYPE_COLORS[t]).toContain('bg-')
      expect(MISSION_TYPE_COLORS[t]).toContain('text-')
    }
  })

  it('MISSION_TYPE_HEX couvre tous les types', () => {
    for (const t of ALL_MISSION_TYPES) {
      expect(MISSION_TYPE_HEX[t]).toBeDefined()
      expect(MISSION_TYPE_HEX[t]).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('pas de doublons dans les couleurs hex', () => {
    const hexValues = Object.values(MISSION_TYPE_HEX)
    expect(new Set(hexValues).size).toBe(hexValues.length)
  })

  it('labels sont en français', () => {
    expect(MISSION_TYPE_LABELS.POSER).toBe('Pose')
    expect(MISSION_TYPE_LABELS.RETIRER).toBe('Enlèvement')
    expect(MISSION_TYPE_LABELS.ECHANGER).toBe('Rotation')
    expect(MISSION_TYPE_LABELS.PAUSE).toBe('Pause')
  })
})

describe('Mission interface — structure', () => {
  const validMission: Mission = {
    id: 'm-1',
    type: 'POSER',
    date: '2025-06-15',
    address: '1 rue test',
    latitude: 45.9,
    longitude: 6.1,
    estimatedDurationMin: 30,
    maneuverTimeMin: 10,
  }

  it('mission minimale valide', () => {
    expect(validMission.id).toBeDefined()
    expect(validMission.type).toBe('POSER')
    expect(validMission.latitude).toBeGreaterThan(0)
    expect(validMission.longitude).toBeGreaterThan(0)
  })

  it('mission avec tous les champs optionnels', () => {
    const full: Mission = {
      ...validMission,
      clientName: 'Client A',
      outletName: 'Chantier X',
      wasteTypeLabel: 'DIB',
      binSize: '30m3',
      binSizeM3: 30,
      accessNotes: 'Portail code 1234',
      priority: 1,
      timeWindow: { openMin: 480, closeMin: 720 },
      linkedExutoireId: 'exu-1',
      archived: false,
      tags: ['urgent', 'vip'],
      notes: 'RAS',
      dependsOnId: 'm-0',
      requiredSkills: ['permis_C', 'CACES'],
      clientId: 'cli-1',
      siteId: 'site-1',
      productId: 'prod-1',
      voucherDelivered: true,
      equipmentType: 'benne',
    }
    expect(full.requiredSkills).toEqual(['permis_C', 'CACES'])
    expect(full.priority).toBe(1)
    expect(full.timeWindow?.openMin).toBe(480)
  })

  it('priority ne peut être que 1, 2 ou 3', () => {
    const m1: Mission = { ...validMission, priority: 1 }
    const m2: Mission = { ...validMission, priority: 2 }
    const m3: Mission = { ...validMission, priority: 3 }
    expect(m1.priority).toBe(1)
    expect(m2.priority).toBe(2)
    expect(m3.priority).toBe(3)
  })
})

describe('Driver interface — structure', () => {
  it('driver minimal valide', () => {
    const d: Driver = {
      id: 'd-1',
      firstName: 'Jean',
      lastName: 'Dupont',
      sector: 'Nord',
      depotName: 'Depot',
      depotLat: 45.9,
      depotLng: 6.1,
    }
    expect(d.firstName).toBe('Jean')
    expect(d.vehicleDimensions).toBeUndefined()
  })

  it('driver avec vehicleDimensions', () => {
    const d: Driver = {
      id: 'd-1',
      firstName: 'Jean',
      lastName: 'Dupont',
      sector: 'Nord',
      depotName: 'Depot',
      depotLat: 45.9,
      depotLng: 6.1,
      vehicleDimensions: {
        weightTon: 26,
        heightM: 4.0,
        widthM: 2.55,
        lengthM: 12.0,
        axleCount: 3,
        hazmat: false,
      },
    }
    expect(d.vehicleDimensions!.weightTon).toBe(26)
  })

  it('driver avec skills', () => {
    const d: Driver = {
      id: 'd-1',
      firstName: 'Jean',
      lastName: 'Dupont',
      sector: 'Nord',
      depotName: 'Depot',
      depotLat: 45.9,
      depotLng: 6.1,
      skills: ['permis_C', 'CACES', 'ADR'],
    }
    expect(d.skills).toHaveLength(3)
    expect(d.skills).toContain('ADR')
  })
})

describe('Vehicle interface — gabaritProfile', () => {
  it('vehicle avec gabaritProfile', () => {
    const v: Vehicle = {
      id: 'v-1',
      licensePlate: 'AB-123-CD',
      type: 'ampliroll',
      brand: 'Renault',
      model: 'T480',
      mileageKm: 85000,
      status: 'active',
      notes: '',
      weightTon: 26,
      heightM: 4.0,
      widthM: 2.55,
      lengthM: 12.0,
      axleCount: 3,
      hazmat: false,
      gabaritProfile: 'pl_26t',
    }
    expect(v.gabaritProfile).toBe('pl_26t')
    expect(v.weightTon).toBe(26)
  })

  it('vehicle custom gabarit', () => {
    const v: Vehicle = {
      id: 'v-2',
      licensePlate: 'EF-456-GH',
      type: 'special',
      brand: 'Custom',
      model: 'X1',
      mileageKm: 0,
      status: 'active',
      notes: '',
      weightTon: 15,
      heightM: 3.3,
      widthM: 2.4,
      lengthM: 9.0,
      axleCount: 2,
      hazmat: true,
      gabaritProfile: 'custom',
    }
    expect(v.gabaritProfile).toBe('custom')
    expect(v.hazmat).toBe(true)
  })

  it('statut possible : active, maintenance, decommissioned', () => {
    const statuts: Vehicle['status'][] = ['active', 'maintenance', 'decommissioned']
    for (const s of statuts) {
      expect(s).toBeDefined()
    }
  })
})

describe('Exutoire interface — structure', () => {
  it('exutoire minimal valide', () => {
    const e: Exutoire = {
      id: 'exu-1',
      name: 'Centre de tri',
      address: 'ZI Rumilly',
      lat: 45.867,
      lng: 5.944,
      openingHoursOpen: 360,
      openingHoursClose: 1080,
      closedDays: [0],
      acceptedWasteTypes: ['DIB', 'Gravats'],
      serviceTimeMin: 15,
    }
    expect(e.openingHoursOpen).toBe(360)
    expect(e.closedDays).toContain(0)
    expect(e.acceptedWasteTypes).toHaveLength(2)
  })

  it('horaires en minutes depuis minuit', () => {
    const e: Exutoire = {
      id: 'exu-1',
      name: 'Test',
      address: 'Test',
      lat: 45.9,
      lng: 6.1,
      openingHoursOpen: 7 * 60,
      openingHoursClose: 18 * 60,
      closedDays: [0, 6],
      acceptedWasteTypes: [],
      serviceTimeMin: 10,
    }
    expect(e.openingHoursOpen).toBe(420)
    expect(e.openingHoursClose).toBe(1080)
  })
})

describe('TenantSettings — valeurs typiques', () => {
  it('settings typiques valides', () => {
    const s: TenantSettings = {
      id: 'ts-1',
      defaultSpeedKmh: 40,
      defaultStartTime: '08:00',
      maxWorkDayMin: 600,
      pauseAfterMin: 270,
      pauseDurationMin: 45,
      costPerKm: 0.5,
      fuelCostPerLiter: 1.8,
      consumptionLPer100: 30,
      primaryColor: '#0055A4',
      logoUrl: '',
      companyDisplayName: 'Pathélix',
    }
    expect(s.defaultSpeedKmh).toBe(40)
    expect(s.maxWorkDayMin).toBe(600)
    expect(s.pauseAfterMin).toBe(270)
    expect(s.pauseDurationMin).toBe(45)
  })
})
