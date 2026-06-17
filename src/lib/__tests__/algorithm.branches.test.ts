import { describe, it, expect } from 'vitest'
import { calcTour } from '@/lib/algorithm'
import type { PlannedMission, Exutoire } from '@/lib/types'

// Uses REAL travelTimeMin (no mock) — same coords → 0 travel time

const DEPOT_LAT = 45.9
const DEPOT_LNG = 6.1

function mission(id: string, overrides: Partial<PlannedMission> = {}): PlannedMission {
  return {
    id, type: 'POSER', date: '2025-06-15',
    address: 'Addr', latitude: DEPOT_LAT, longitude: DEPOT_LNG,
    estimatedDurationMin: 30, maneuverTimeMin: 0,
    sequenceOrder: 0,
    ...overrides,
  }
}

const ex: Exutoire = {
  id: 'ex-1', name: 'Déchetterie', address: '1 Route',
  lat: DEPOT_LAT, lng: DEPOT_LNG,
  openingHoursOpen: 300, openingHoursClose: 1200,
  closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 15,
}

describe('calcTour — precomputedTravelMin', () => {
  it('uses precomputedTravelMin instead of computing real distance', () => {
    const m = mission('m-1', {
      precomputedTravelMin: 50,
      estimatedDurationMin: 0,
    })
    const result = calcTour([m], DEPOT_LAT, DEPOT_LNG, '07:00', 50)
    // arrivalMin = 420 (start) + 50 (precomputed) = 470
    expect(result.steps[0].arrivalMin).toBe(470)
  })

  it('contributes precomputedTravelMin to totalDrivingMin', () => {
    const m = mission('m-1', { precomputedTravelMin: 100, estimatedDurationMin: 0 })
    const result = calcTour([m], DEPOT_LAT, DEPOT_LNG, '07:00', 50)
    expect(result.totalDrivingMin).toBe(100)
  })
})

describe('calcTour — manualStartMin', () => {
  it('delays arrival to manualStartMin when it is after computed arrival', () => {
    const m = mission('m-1', {
      precomputedTravelMin: 10,
      manualStartMin: 600,
      estimatedDurationMin: 0,
    })
    // computed arrival = 420 + 10 = 430 < 600 → use manualStartMin
    const result = calcTour([m], DEPOT_LAT, DEPOT_LNG, '07:00', 50)
    expect(result.steps[0].arrivalMin).toBe(600)
  })

  it('does not use manualStartMin when arrival is already later', () => {
    const m = mission('m-1', {
      precomputedTravelMin: 200,
      manualStartMin: 100, // earlier than computed arrival
      estimatedDurationMin: 0,
    })
    // computed arrival = 420 + 200 = 620 > 100 → manualStartMin not applied
    const result = calcTour([m], DEPOT_LAT, DEPOT_LNG, '07:00', 50)
    expect(result.steps[0].arrivalMin).toBe(620)
  })
})

describe('calcTour — missing linked exutoire', () => {
  it('warns when linkedExutoireId points to non-existent exutoire', () => {
    const m = mission('m-1', {
      type: 'RETIRER',
      linkedExutoireId: 'ex-missing',
    })
    const result = calcTour([m], DEPOT_LAT, DEPOT_LNG, '07:00', 50, [])
    const w = result.warnings.find(w => w.message.includes('exutoire lié introuvable'))
    expect(w).toBeDefined()
    expect(w!.severity).toBe('warning')
  })
})

describe('calcTour — exutoire late arrival', () => {
  it('warns when arrival at exutoire is after closing time', () => {
    // Mission starts 07:00 (420), duration 30 min → exutoire arrival at 450
    // exutoire open 360-440 → closed at 440 < 450 → warning
    const lateEx: Exutoire = {
      ...ex,
      openingHoursOpen: 360,
      openingHoursClose: 440, // closes before mission can get there (arrival=450)
    }
    const m = mission('m-1', {
      type: 'RETIRER',
      linkedExutoireId: 'ex-1',
      estimatedDurationMin: 30,
    })
    const result = calcTour([m], DEPOT_LAT, DEPOT_LNG, '07:00', 50, [lateEx])
    const w = result.warnings.find(w => w.message.includes('après la fermeture'))
    expect(w).toBeDefined()
    expect(w!.severity).toBe('warning')
  })
})

describe('calcTour — ALLER_RETOUR', () => {
  it('adds return-to-site step after exutoire for ALLER_RETOUR', () => {
    const m = mission('m-1', {
      type: 'ALLER_RETOUR',
      linkedExutoireId: 'ex-1',
      estimatedDurationMin: 30,
      maneuverTimeMin: 10,
    })
    const result = calcTour([m], DEPOT_LAT, DEPOT_LNG, '07:00', 50, [ex])
    // Steps: original mission, exutoire visit, return POSER step
    expect(result.steps.length).toBeGreaterThanOrEqual(3)
    const poserReturn = result.steps.find(s => s.mission.type === 'POSER' && s.mission.isSynthetic)
    expect(poserReturn).toBeDefined()
    expect(poserReturn!.mission.id).toContain('_pose_ar_')
  })

  it('ALLER_RETOUR returns to original mission location after exutoire', () => {
    const m = mission('m-1', {
      type: 'ALLER_RETOUR',
      linkedExutoireId: 'ex-1',
      estimatedDurationMin: 30,
      maneuverTimeMin: 10,
    })
    const result = calcTour([m], DEPOT_LAT, DEPOT_LNG, '07:00', 50, [ex])
    const poserReturn = result.steps.find(s => s.mission.type === 'POSER' && s.mission.isSynthetic)
    expect(poserReturn!.mission.latitude).toBe(m.latitude)
    expect(poserReturn!.mission.longitude).toBe(m.longitude)
  })
})

describe('calcTour — driving time warnings', () => {
  it('warns when totalDriving exceeds WARN_WORK_MIN (480 min)', () => {
    // 10 missions × precomputedTravelMin=50 = 500 min driving
    const missions = Array.from({ length: 10 }, (_, i) =>
      mission(`m-${i}`, { precomputedTravelMin: 50, estimatedDurationMin: 0 }),
    )
    const result = calcTour(missions, DEPOT_LAT, DEPOT_LNG, '07:00', 50)
    const w = result.warnings.find(w => w.message.includes("seuil d'alerte"))
    expect(w).toBeDefined()
    expect(w!.severity).toBe('warning')
  })

  it('errors when totalDriving exceeds MAX_DRIVING_MIN (540 min)', () => {
    // 11 missions × precomputedTravelMin=55 = 605 min driving
    const missions = Array.from({ length: 11 }, (_, i) =>
      mission(`m-${i}`, { precomputedTravelMin: 55, estimatedDurationMin: 0 }),
    )
    const result = calcTour(missions, DEPOT_LAT, DEPOT_LNG, '07:00', 50)
    const w = result.warnings.find(w => w.message.includes('maximum légal') && w.message.includes('conduite'))
    expect(w).toBeDefined()
    expect(w!.severity).toBe('error')
  })
})

describe('calcTour — total work time warnings', () => {
  it('warns when totalDurationMin exceeds WARN_WORK_TOTAL_MIN (540 min) but not MAX_WORK_MIN', () => {
    // 5 missions × precomputedTravelMin=20 + estimatedDurationMin=90 = 100 min/mission × 5 = 500 min total
    // Wait: totalDriving = 5×20 = 100 < WARN_WORK_MIN → no driving warning
    // totalDurationMin = 5×(20+90) = 550 → 540 < 550 ≤ 600 → WARN_WORK_TOTAL
    const missions = Array.from({ length: 5 }, (_, i) =>
      mission(`m-${i}`, { precomputedTravelMin: 20, estimatedDurationMin: 90, maneuverTimeMin: 0 }),
    )
    const result = calcTour(missions, DEPOT_LAT, DEPOT_LNG, '07:00', 50)
    const w = result.warnings.find(w => w.message.includes('approche du maximum légal'))
    expect(w).toBeDefined()
    expect(w!.severity).toBe('warning')
  })

  it('errors when totalDurationMin exceeds MAX_WORK_MIN (600 min)', () => {
    // 6 missions × precomputedTravelMin=20 + estimatedDurationMin=90 = 110 × 6 = 660 min
    // totalDriving = 6×20 = 120 < WARN_WORK_MIN → no driving warning
    // totalDurationMin ≈ 660 > 600 → MAX_WORK error
    const missions = Array.from({ length: 6 }, (_, i) =>
      mission(`m-${i}`, { precomputedTravelMin: 20, estimatedDurationMin: 90, maneuverTimeMin: 0 }),
    )
    const result = calcTour(missions, DEPOT_LAT, DEPOT_LNG, '07:00', 50)
    const w = result.warnings.find(w => w.message.includes('Durée de travail totale') && w.severity === 'error')
    expect(w).toBeDefined()
  })
})
