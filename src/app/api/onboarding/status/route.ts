import { apiRoute } from '@/lib/api/route'

/**
 * Where the account stands in its set-up, from what is actually recorded: each step is done
 * when its data exists. Drives the "Mise en route" checklist.
 */
export const GET = apiRoute({ name: '/api/onboarding/status', permission: 'manage_settings' }, async ({ db, tenantId }) => {
  const [settings, drivers, vehicles, exutoires, clients, sites, containerTypes, containers, priceLists, missions, plans] = await Promise.all([
    db.tenantSettings.findUnique({ where: { tenantId }, select: { companyDisplayName: true, driverHourlyCostEur: true } }),
    db.driver.count({ where: { archived: false } }),
    db.vehicle.count({ where: { archived: false } }),
    db.exutoire.count(),
    db.client.count({ where: { archived: false } }),
    db.site.count({ where: { archived: false } }),
    db.containerType.count(),
    db.container.count({ where: { archived: false } }),
    db.priceList.count(),
    db.mission.count({ where: { archived: false } }),
    db.plan.count(),
  ])
  const steps = [
    { id: 'company', done: !!settings?.companyDisplayName, count: null, tab: 'settings' },
    { id: 'drivers', done: drivers > 0, count: drivers, tab: 'drivers' },
    { id: 'vehicles', done: vehicles > 0, count: vehicles, tab: 'vehicles' },
    { id: 'exutoires', done: exutoires > 0, count: exutoires, tab: 'exutoires' },
    { id: 'clients', done: clients > 0 && sites > 0, count: clients, tab: 'catalogue' },
    { id: 'containers', done: containerTypes > 0 && containers > 0, count: containers, tab: 'containers' },
    { id: 'pricing', done: priceLists > 0, count: priceLists, tab: 'sales' },
    { id: 'missions', done: missions > 0, count: missions, tab: 'missions' },
    { id: 'first-plan', done: plans > 0, count: plans, tab: 'tours' },
  ]
  return { steps, complete: steps.every(s => s.done) }
})
