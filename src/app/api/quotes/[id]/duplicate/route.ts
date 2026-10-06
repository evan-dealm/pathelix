import { apiRoute } from '@/lib/api/route'
import { duplicateQuote } from '@/lib/sales/quotes'

export const POST = apiRoute({ name: '/api/quotes/[id]/duplicate', permission: 'manage_sales' }, async ({ db, tenantId, userId, params }) => {
  return duplicateQuote(db, tenantId, userId, params.id)
})
