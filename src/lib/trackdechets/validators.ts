import { z } from 'zod'

const siretSchema        = z.string().regex(/^\d{14}$/, 'SIRET invalide (14 chiffres requis)')
const processingOpSchema = z.string().regex(/^[DR]\d+$/, 'Code opération invalide (ex: D9, R1)')

const companySchema = z.object({
  siret:    siretSchema,
  name:     z.string().min(1),
  address:  z.string().min(1),
  contact:  z.string().optional(),
  phone:    z.string().optional(),
  mail:     z.string().email().optional().or(z.literal('')),
})

const transporterSchema = z.object({
  company:              companySchema,
  isExemptedOfReceipt:  z.boolean().optional(),
  receipt:              z.string().optional(),
  department:           z.string().regex(/^\d{2,3}$/, 'Département invalide').optional(),
  validityLimit:        z.string().optional(),
  numberPlate:          z.string().optional(),
}).optional()

export const BsddCreateSchema = z.object({
  missionId: z.string().optional(),

  emitter: z.object({
    type:    z.enum(['PRODUCER', 'OTHER']).optional(),
    company: companySchema,
    workSite: z.object({
      name:       z.string().optional(),
      address:    z.string().optional(),
      city:       z.string().optional(),
      postalCode: z.string().optional(),
      infos:      z.string().optional(),
    }).optional(),
  }),

  recipient: z.object({
    processingOperation: processingOpSchema,
    company:             companySchema,
    isTempStorage:       z.boolean().optional(),
  }),

  transporter: transporterSchema,

  wasteDetails: z.object({
    code:            z.string().min(2, 'Code déchet requis'),
    name:            z.string().optional(),
    onuCode:         z.string().optional(),
    quantity:        z.number().nonnegative().optional(),
    quantityType:    z.enum(['REAL', 'ESTIMATED']).optional(),
    consistence:     z.enum(['SOLID', 'LIQUID', 'GASEOUS', 'DOUGHY']).optional(),
    packagingInfos:  z.array(z.object({
      type:     z.string().min(1),
      quantity: z.number().int().positive(),
    })).optional(),
  }),
})

export const BsddSignSchema = z.object({
  signatureType:   z.enum(['PRODUCER', 'TRANSPORTER']),
  signatureAuthor: z.string().min(1),
  signatureDate:   z.string().optional(),
})

export const AccountCreateSchema = z.object({
  token: z.string().min(20, 'Token trop court (minimum 20 caractères)'),
})

export type BsddCreateInput = z.infer<typeof BsddCreateSchema>
export type BsddSignInput   = z.infer<typeof BsddSignSchema>
export type AccountCreateInput = z.infer<typeof AccountCreateSchema>
