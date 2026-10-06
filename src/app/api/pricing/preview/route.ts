import { z } from 'zod'
import { apiRoute } from '@/lib/api/route'
import { priceItems } from '@/lib/pricing/engine'
import { loadRules } from '@/lib/pricing/load'
import { commercialSettings } from '@/lib/sales/quotes'

const PreviewSchema = z.object({
  clientId:   z.string().nullable().optional(),
  contractId: z.string().nullable().optional(),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  urgent:     z.boolean().optional(),
  zip:        z.string().max(10).optional(),
  items: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('OPERATION'), missionType: z.string().max(30), containerTypeId: z.string().optional(), materialId: z.string().optional(), quantity: z.number().min(0).max(1000).optional() }),
    z.object({ kind: z.literal('RENTAL'), containerTypeId: z.string().optional(), days: z.number().min(0).max(3650) }),
    z.object({ kind: z.literal('TREATMENT'), materialId: z.string().optional(), tons: z.number().min(0).max(10_000) }),
    z.object({ kind: z.literal('KM'), km: z.number().min(0).max(100_000) }),
  ])).min(1).max(100),
})

/** Prices what is being sold (quote editor, portal request) with the customer's grids — explained line by line. */
export const POST = apiRoute({ name: '/api/pricing/preview', permission: 'manage_sales', schema: PreviewSchema }, async ({ db, tenantId, body }) => {
  const [rules, s] = await Promise.all([
    loadRules(db, { clientId: body.clientId, contractId: body.contractId, date: body.date }),
    commercialSettings(db, tenantId),
  ])
  return priceItems(body.items.map(i => i.kind === 'OPERATION' ? { ...i, zip: body.zip } : i), rules, { date: body.date, urgent: body.urgent, defaultVatRate: s.defaultVatRate })
})
