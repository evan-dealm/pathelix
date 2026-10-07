import { z } from 'zod'

export const ContactSchema = z.object({
  name:             z.string().trim().min(1).max(120),
  role:             z.string().max(120).optional(),
  email:            z.string().email().or(z.literal('')).optional(),
  phone:            z.string().max(40).optional(),
  isPrimary:        z.boolean().optional(),
  receivesInvoices: z.boolean().optional(),
})

export const CustomerNoteSchema = z.object({
  kind:    z.enum(['NOTE', 'CALL', 'EMAIL', 'MEETING']).optional(),
  content: z.string().trim().min(1).max(5000),
  at:      z.string().datetime({ offset: true }).optional(),
})

export const ClientCreateSchema = z.object({
  name:             z.string().min(1).max(200),
  contact:          z.string().max(200).optional(),
  phone:            z.string().max(50).optional(),
  email:            z.string().max(200).optional(),
  vip:              z.boolean().optional(),
  requiresDeposit:  z.boolean().optional(),
  ecoResponsable:   z.boolean().optional(),
  requiresBsd:      z.boolean().optional(),
  voucherRequired:  z.boolean().optional(),
  notes:            z.string().max(2000).optional(),

  siret:            z.string().max(100).optional(),
  billingAddress:   z.string().max(500).optional(),
  externalRef:      z.string().max(200).optional(),
  sector:           z.string().max(100).optional(),
  contractStart:    z.string().datetime({ offset: true }).optional().nullable(),
  contractEnd:      z.string().datetime({ offset: true }).optional().nullable(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  siteIds:          z.array(z.string().max(100)).max(100).optional(),
})

export const ClientUpdateSchema = z.object({
  name:             z.string().min(1).max(200).optional(),
  contact:          z.string().max(200).optional(),
  phone:            z.string().max(50).optional(),
  email:            z.string().max(200).optional(),
  vip:              z.boolean().optional(),
  requiresDeposit:  z.boolean().optional(),
  ecoResponsable:   z.boolean().optional(),
  requiresBsd:      z.boolean().optional(),
  voucherRequired:  z.boolean().optional(),
  notes:            z.string().max(2000).optional(),
  archived:         z.boolean().optional(),

  siret:            z.string().max(100).optional(),
  billingAddress:   z.string().max(500).optional(),
  externalRef:      z.string().max(200).optional(),
  sector:           z.string().max(100).optional(),
  contractStart:    z.string().datetime({ offset: true }).optional().nullable(),
  contractEnd:      z.string().datetime({ offset: true }).optional().nullable(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  siteIds:          z.array(z.string().max(100)).max(100).optional(),
})

export const SiteCreateSchema = z.object({
  name:               z.string().min(1).max(200),
  address:            z.string().max(500).optional(),
  latitude:           z.number().min(-90).max(90).optional(),
  longitude:          z.number().min(-180).max(180).optional(),
  accessNotes:        z.string().max(2000).optional(),
  defaultManeuverMin: z.number().int().min(0).max(120).optional(),
  sector:             z.string().max(100).optional(),

  city:               z.string().max(100).optional(),
  zipCode:            z.string().max(20).optional(),
  country:            z.string().max(10).optional(),
  siteType:           z.enum(['chantier', 'entrepot', 'usine', 'bureau', 'autre', '']).optional(),

  openingHoursOpen:   z.number().int().min(0).max(1439).optional().nullable(),
  openingHoursClose:  z.number().int().min(0).max(1439).optional().nullable(),
  clientIds:          z.array(z.string().max(100)).max(100).optional(),
})

export const SiteUpdateSchema = z.object({
  name:              z.string().min(1).max(200).optional(),
  address:           z.string().max(500).optional(),
  latitude:          z.number().min(-90).max(90).optional(),
  longitude:         z.number().min(-180).max(180).optional(),
  accessNotes:       z.string().max(2000).optional(),
  defaultManeuverMin: z.number().int().min(0).max(480).optional(),
  sector:            z.string().max(100).optional(),
  archived:          z.boolean().optional(),
  clientIds:         z.array(z.string()).optional(),
})
