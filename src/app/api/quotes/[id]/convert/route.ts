import { apiRoute } from '@/lib/api/route'
import { ConvertQuoteSchema } from '@/lib/sales/schemas'
import { convertQuote } from '@/lib/sales/quotes'

/** Accepted quote → order, with its missions created from the operational lines. */
export const POST = apiRoute({ name: '/api/quotes/[id]/convert', permission: 'manage_sales', schema: ConvertQuoteSchema }, async ({ db, tenantId, userId, body, params }) => {
  return convertQuote(db, tenantId, userId, params.id, body)
})
