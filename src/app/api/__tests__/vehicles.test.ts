import { describe, it, expect } from 'vitest'
import { VehicleSchema } from '@/lib/schemas'

describe('Vehicle API — validation schema', () => {

  it('accepte un véhicule minimal valide', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'ampliroll',
    })
    expect(result.success).toBe(true)
  })

  it('rejette sans licensePlate', () => {
    const result = VehicleSchema.safeParse({ type: 'benne' })
    expect(result.success).toBe(false)
  })

  it('rejette sans type', () => {
    const result = VehicleSchema.safeParse({ licensePlate: 'AB-123-CD' })
    expect(result.success).toBe(false)
  })

  it('accepte le gabaritProfile', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      gabaritProfile: 'pl_26t',
    })
    expect(result.success).toBe(true)
  })

  it('accepte les dimensions gabarit', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      gabaritProfile: 'pl_26t',
      weightTon: 26,
      heightM: 4.0,
      widthM: 2.55,
      lengthM: 12.0,
      axleCount: 3,
      hazmat: false,
    })
    expect(result.success).toBe(true)
  })

  it('rejette poids négatif', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      weightTon: -5,
    })
    expect(result.success).toBe(false)
  })

  it('rejette poids > 100', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      weightTon: 150,
    })
    expect(result.success).toBe(false)
  })

  it('rejette hauteur > 6m', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      heightM: 7.0,
    })
    expect(result.success).toBe(false)
  })

  it('rejette largeur > 4m', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      widthM: 5.0,
    })
    expect(result.success).toBe(false)
  })

  it('rejette longueur > 30m', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      lengthM: 35,
    })
    expect(result.success).toBe(false)
  })

  it('rejette essieux > 10', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      axleCount: 12,
    })
    expect(result.success).toBe(false)
  })

  it('rejette essieux < 2', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      axleCount: 1,
    })
    expect(result.success).toBe(false)
  })

  it('accepte hazmat boolean', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      hazmat: true,
    })
    expect(result.success).toBe(true)
  })

  it('accepte statut valide', () => {
    for (const s of ['active', 'maintenance', 'decommissioned']) {
      const result = VehicleSchema.safeParse({
        licensePlate: 'AB-123-CD',
        type: 'benne',
        status: s,
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejette statut invalide', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      status: 'broken',
    })
    expect(result.success).toBe(false)
  })

  it('accepte les champs péage', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',

    })
    expect(result.success).toBe(true)
  })

  it('accepte un véhicule complet', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'ampliroll',
      brand: 'Renault',
      model: 'T480',
      capacityM3: 35,
      maxBins: 1,
      mileageKm: 85000,
      nextInspection: '2025-12-15',
      status: 'active',
      notes: 'RAS',
      assignedDriverId: 'drv-1',
      archived: false,
      gabaritProfile: 'pl_26t',
      weightTon: 26,
      heightM: 4.0,
      widthM: 2.55,
      lengthM: 12.0,
      axleCount: 3,
      hazmat: false,
    })
    expect(result.success).toBe(true)
  })
})

describe('Vehicle API — gabarit profile validation', () => {
  it('gabaritProfile accepte n\'importe quelle chaîne', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      gabaritProfile: 'custom',
    })
    expect(result.success).toBe(true)
  })

  it('gabaritProfile optionnel', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
    })
    expect(result.success).toBe(true)
    expect(result.data?.gabaritProfile).toBeUndefined()
  })

  it('dimensions optionnelles avec gabaritProfile', () => {
    const result = VehicleSchema.safeParse({
      licensePlate: 'AB-123-CD',
      type: 'benne',
      gabaritProfile: 'pl_19t',

    })
    expect(result.success).toBe(true)
  })
})
