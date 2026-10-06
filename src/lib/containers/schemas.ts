import { z } from 'zod'
import { CONTAINER_STATUSES } from './lifecycle'

export const ContainerTypeSchema = z.object({
  name:             z.string().trim().min(1).max(80),
  capacityM3:       z.number().positive().max(100),
  lengthM:          z.number().positive().max(20).nullable().optional(),
  widthM:           z.number().positive().max(5).nullable().optional(),
  heightM:          z.number().positive().max(6).nullable().optional(),
  tareKg:           z.number().min(0).max(20_000).nullable().optional(),
  allowedMaterials: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  dailyRentalPrice: z.number().min(0).max(100_000).nullable().optional(),
  purchaseCost:     z.number().min(0).max(10_000_000).nullable().optional(),
})

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** One bin, or a batch: `count` bins numbered from `startNumber` with `prefix`. */
export const ContainerCreateSchema = z.object({
  typeId:       z.string().min(1),
  number:       z.string().trim().min(1).max(40).optional(),
  count:        z.number().int().min(1).max(500).optional(),
  prefix:       z.string().trim().max(10).optional(),
  condition:    z.enum(['good', 'worn', 'damaged']).optional(),
  purchaseDate: day.nullable().optional(),
  purchaseCost: z.number().min(0).max(10_000_000).nullable().optional(),
  notes:        z.string().max(2000).optional(),
  locationLabel: z.string().max(120).optional(),
}).refine(v => v.number || v.count, { message: 'Numéro ou nombre de bennes requis' })

export const ContainerUpdateSchema = z.object({
  number:       z.string().trim().min(1).max(40).optional(),
  typeId:       z.string().min(1).optional(),
  condition:    z.enum(['good', 'worn', 'damaged']).optional(),
  purchaseDate: day.nullable().optional(),
  purchaseCost: z.number().min(0).max(10_000_000).nullable().optional(),
  notes:        z.string().max(2000).optional(),
})

export const ContainerStatusSchema = z.object({
  status: z.enum(CONTAINER_STATUSES),
  notes:  z.string().max(1000).optional(),
})

export const ContainerRelocateSchema = z.object({
  clientId:      z.string().nullable().optional(),
  siteId:        z.string().nullable().optional(),
  locationLabel: z.string().max(120).optional(),
  placedAt:      day.optional(),
  notes:         z.string().max(1000).optional(),
})

export const MissionContainerSchema = z.object({ containerId: z.string().min(1).nullable() })
