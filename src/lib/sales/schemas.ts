import { z } from 'zod'
import { RULE_CODES } from '@/lib/pricing/engine'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const money = z.number().min(-10_000_000).max(10_000_000)
const MISSION_TYPES = ['POSER', 'RETIRER', 'ECHANGER', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR'] as const

export const SalesLineSchema = z.object({
  label:           z.string().trim().min(1).max(300),
  description:     z.string().max(2000).optional(),
  quantity:        z.number().min(-100_000).max(100_000),
  unit:            z.enum(['UNIT', 'KM', 'DAY', 'TON', 'PCT', 'FLAT', 'HOUR', 'M3']).optional(),
  unitPrice:       money,
  discountPct:     z.number().min(0).max(100).optional(),
  vatRate:         z.number().min(0).max(30).optional(),
  explanation:     z.string().max(1000).optional(),
  missionType:     z.enum(MISSION_TYPES).nullable().optional(),
  containerTypeId: z.string().nullable().optional(),
  materialId:      z.string().nullable().optional(),
  plannedDate:     day.nullable().optional(),
})
export type SalesLineInput = z.infer<typeof SalesLineSchema>

export const QuoteSchema = z.object({
  clientId:   z.string().min(1),
  siteId:     z.string().nullable().optional(),
  title:      z.string().max(200).optional(),
  issueDate:  day.optional(),
  validUntil: day.optional(),
  notes:      z.string().max(5000).optional(),
  terms:      z.string().max(10_000).optional(),
  lines:      z.array(SalesLineSchema).max(200),
})

export const QuoteDecisionSchema = z.object({
  decision: z.enum(['ACCEPTED', 'REFUSED']),
  by:       z.string().max(120).optional(),
  reason:   z.string().max(1000).optional(),
})

export const ConvertQuoteSchema = z.object({
  kind:      z.enum(['ONE_OFF', 'POSE_RETRAIT', 'ROTATION', 'RECURRING', 'LONG_RENTAL']).optional(),
  startDate: day.optional(),
  endDate:   day.nullable().optional(),
  /** Create the missions of the operational lines right away. */
  createMissions: z.boolean().optional(),
})

export const OrderSchema = z.object({
  clientId:   z.string().min(1),
  siteId:     z.string().nullable().optional(),
  contractId: z.string().nullable().optional(),
  kind:       z.enum(['ONE_OFF', 'POSE_RETRAIT', 'ROTATION', 'RECURRING', 'LONG_RENTAL']).optional(),
  title:      z.string().max(200).optional(),
  startDate:  day,
  endDate:    day.nullable().optional(),
  notes:      z.string().max(5000).optional(),
  lines:      z.array(SalesLineSchema).max(200),
  createMissions: z.boolean().optional(),
})

export const OrderUpdateSchema = z.object({
  status: z.enum(['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  title:  z.string().max(200).optional(),
  notes:  z.string().max(5000).optional(),
  endDate: day.nullable().optional(),
})

export const ContractSchema = z.object({
  clientId:         z.string().min(1),
  siteId:           z.string().nullable().optional(),
  priceListId:      z.string().nullable().optional(),
  status:           z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'ENDED']).optional(),
  title:            z.string().max(200).optional(),
  startDate:        day,
  endDate:          day.nullable().optional(),
  renewal:          z.enum(['NONE', 'TACIT']).optional(),
  noticeDays:       z.number().int().min(0).max(365).optional(),
  billingFrequency: z.enum(['PER_OPERATION', 'MONTHLY']).optional(),
  rentalFreeDays:   z.number().int().min(0).max(365).optional(),
  paymentTermsDays: z.number().int().min(0).max(180).optional(),
  notes:            z.string().max(5000).optional(),
})

export const InvoiceDraftSchema = z.object({
  clientId:    z.string().min(1),
  orderId:     z.string().nullable().optional(),
  contractId:  z.string().nullable().optional(),
  periodStart: day.optional(),
  periodEnd:   day.optional(),
  /** Build the lines from the field data (done missions, rentals, weighings) not yet invoiced. */
  fromFieldData: z.boolean().optional(),
  notes:       z.string().max(5000).optional(),
  lines:       z.array(SalesLineSchema).max(500).optional(),
})

export const InvoiceUpdateSchema = z.object({
  notes:       z.string().max(5000).optional(),
  dueDate:     day.optional(),
  lines:       z.array(SalesLineSchema).max(500).optional(),
})

export const PaymentSchema = z.object({
  clientId:   z.string().min(1),
  invoiceId:  z.string().nullable().optional(),
  amount:     z.number().positive().max(10_000_000),
  method:     z.enum(['TRANSFER', 'CHECK', 'CARD', 'CASH', 'DIRECT_DEBIT', 'OTHER']).optional(),
  reference:  z.string().max(200).optional(),
  receivedAt: day,
  notes:      z.string().max(2000).optional(),
})

export const PriceListSchema = z.object({
  name:      z.string().trim().min(1).max(120),
  isDefault: z.boolean().optional(),
  clientId:  z.string().nullable().optional(),
  validFrom: day.nullable().optional(),
  validTo:   day.nullable().optional(),
})

export const PriceRuleSchema = z.object({
  code:       z.enum(RULE_CODES),
  label:      z.string().trim().min(1).max(200),
  unit:       z.enum(['UNIT', 'KM', 'DAY', 'TON', 'PCT', 'FLAT']).optional(),
  amount:     money,
  vatRate:    z.number().min(0).max(30).optional(),
  conditions: z.object({
    containerTypeId: z.string().optional(),
    materialId:      z.string().optional(),
    missionType:     z.enum(MISSION_TYPES).optional(),
    zipPrefix:       z.string().max(60).optional(),
    freeDays:        z.number().int().min(0).max(365).optional(),
    minQty:          z.number().min(0).optional(),
  }).optional(),
  priority:   z.number().int().min(-100).max(100).optional(),
  active:     z.boolean().optional(),
})

export const WeighingSchema = z.object({
  missionId:    z.string().nullable().optional(),
  exutoireId:   z.string().nullable().optional(),
  containerId:  z.string().nullable().optional(),
  materialId:   z.string().nullable().optional(),
  clientId:     z.string().nullable().optional(),
  ticketNumber: z.string().max(80).optional(),
  grossKg:      z.number().min(0).max(100_000).nullable().optional(),
  tareKg:       z.number().min(0).max(100_000).nullable().optional(),
  netKg:        z.number().min(0).max(100_000),
  weighedAt:    z.string().datetime({ offset: true }).optional(),
  notes:        z.string().max(2000).optional(),
})

export const WeighingReviewSchema = WeighingSchema.partial().extend({
  status: z.enum(['VALIDATED', 'REJECTED']).optional(),
})

/** Sending a quote or an invoice: e-mail it, or only mark it as sent. */
export const SendDocumentSchema = z.object({ email: z.string().email().optional(), message: z.string().max(5000).optional(), markOnly: z.boolean().optional() })

export const CreditNoteSchema = z.object({ lines: z.array(SalesLineSchema).max(500).optional() })

export const InvoicePreviewSchema = z.object({ clientId: z.string().min(1), contractId: z.string().nullable().optional(), orderId: z.string().nullable().optional(), periodStart: day, periodEnd: day })

export const PaymentAllocateSchema = z.object({ invoiceId: z.string().nullable() })
