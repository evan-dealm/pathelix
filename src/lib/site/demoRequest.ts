import { z } from 'zod'
import { FLEET_SIZES } from './config'

/**
 * Body of POST /api/demo-requests. The form (DemoForm.tsx) sends exactly these fields and runs
 * the same required/e-mail checks before submitting. `website` is a honeypot:
 * the field is hidden from people, so only an automated submission fills it.
 */
export const DemoRequestSchema = z.object({
  firstName: z.string().trim().min(1, 'Indiquez votre prénom').max(80),
  lastName: z.string().trim().min(1, 'Indiquez votre nom').max(80),
  company: z.string().trim().min(1, 'Indiquez votre entreprise').max(160),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(200),
  phone: z.string().trim().max(40).optional().default(''),
  fleetSize: z
    .union([z.enum(FLEET_SIZES), z.literal('')])
    .optional()
    .default(''),
  message: z
    .string()
    .trim()
    .max(2000, 'Message trop long (2 000 caractères au plus)')
    .optional()
    .default(''),
  website: z.string().max(200).optional().default(''),
})

export type DemoRequestInput = z.infer<typeof DemoRequestSchema>
