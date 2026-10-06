import { z } from 'zod'
import { apiRoute } from '@/lib/api/route'
import { markQuoteSent } from '@/lib/sales/quotes'
import { deliverSalesDocument } from '@/lib/sales/delivery'

const SendSchema = z.object({ email: z.string().email().optional(), message: z.string().max(5000).optional(), markOnly: z.boolean().optional() })

/** Marks the quote as sent and e-mails it (PDF attached) when e-mail is configured. */
export const POST = apiRoute({ name: '/api/quotes/[id]/send', permission: 'manage_sales', schema: SendSchema }, async ({ db, tenantId, body, params }) => {
  const quote = await markQuoteSent(db, params.id)
  const mail = body.markOnly ? null : await deliverSalesDocument(db, tenantId, 'QUOTE', params.id, body.email, body.message)
  return { status: quote.status, mail }
})
