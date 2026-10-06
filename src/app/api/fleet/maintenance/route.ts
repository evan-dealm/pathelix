import { apiRoute } from '@/lib/api/route'
import { fleetOverview } from '@/lib/fleet/service'

/** Maintenance board: every truck, its plans (due / overdue), open defects and immobilisations. */
export const GET = apiRoute({ name: '/api/fleet/maintenance', permission: 'manage_vehicles' }, async ({ db, req }) => {
  const day = req.nextUrl.searchParams.get('date')
  const today = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date().toISOString().slice(0, 10)
  return { date: today, vehicles: await fleetOverview(db, today) }
})
