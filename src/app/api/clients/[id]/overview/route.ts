import { apiRoute } from '@/lib/api/route'
import { hasPermission } from '@/lib/permissions'
import { customerOverview } from '@/lib/crm/overview'

/** Customer record: identity, contacts, sites, bins, contracts, money (billing rights) and timeline. */
export const GET = apiRoute({ name: '/api/clients/[id]/overview' }, async ({ db, userId, role, params }) => {
  const withFinance = await hasPermission(userId, role, 'manage_billing') || await hasPermission(userId, role, 'view_costs')
  return customerOverview(db, params.id, { withFinance })
})
