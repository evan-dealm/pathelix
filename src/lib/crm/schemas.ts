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
