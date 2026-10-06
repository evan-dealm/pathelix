import { getTenantDb, unscopedPrisma } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { notify } from './index'

const log = createLogger('daily-checks')

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

function isoDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + n))
}

/**
 * Morning digest of what needs attention, one grouped notification per subject (never one per
 * invoice or per bin): overdue invoices, quotes about to expire, contracts ending, bins on site
 * for a long time, absent drivers, immobilised trucks, failing integrations.
 */
export async function checkTenant(tenantId: string, today = isoDay()): Promise<number> {
  const db = getTenantDb(tenantId)
  let n = 0
  const day = `:${today}`

  const overdue = await db.invoice.findMany({
    where: { status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] }, dueDate: { lt: today } },
    select: { totalTTC: true, amountPaid: true },
  })
  if (overdue.length > 0) {
    const due = overdue.reduce((a, i) => a + i.totalTTC - i.amountPaid, 0)
    n += await notify(tenantId, { kind: 'INVOICE_OVERDUE', title: `${plural(overdue.length, 'facture en retard', 'factures en retard')} — ${eur(due)} TTC à encaisser`, link: 'billing', dedupeKey: `INVOICE_OVERDUE${day}` })
  }

  const expiring = await db.quote.count({ where: { status: 'SENT', validUntil: { gte: today, lte: plusDays(today, 3) } } })
  if (expiring > 0) n += await notify(tenantId, { kind: 'QUOTE_EXPIRING', title: `${plural(expiring, 'devis expire', 'devis expirent')} dans moins de 3 jours`, body: 'Relancez le client ou prolongez la validité.', link: 'sales', dedupeKey: `QUOTE_EXPIRING${day}` })

  const ending = await db.contract.count({ where: { status: 'ACTIVE', renewal: 'NONE', endDate: { gte: today, lte: plusDays(today, 30) } } })
  if (ending > 0) n += await notify(tenantId, { kind: 'CONTRACT_ENDING', title: `${plural(ending, 'contrat arrive', 'contrats arrivent')} à échéance dans 30 jours`, link: 'sales', dedupeKey: `CONTRACT_ENDING${day}` })

  const longStay = await db.container.count({ where: { status: { in: ['AT_CUSTOMER', 'FULL', 'TO_COLLECT'] }, placedAt: { lte: new Date(Date.now() - 30 * 86_400_000) } } })
  if (longStay > 0) n += await notify(tenantId, { kind: 'CONTAINER_LONG_STAY', title: `${plural(longStay, 'benne est', 'bennes sont')} chez un client depuis plus de 30 jours`, body: 'À facturer en location ou à faire retirer.', link: 'containers', dedupeKey: `CONTAINER_LONG_STAY${day}` })

  const absent = await db.driverUnavailability.count({ where: { startDate: { lte: today }, endDate: { gte: today } } })
  if (absent > 0) n += await notify(tenantId, { kind: 'DRIVER_ABSENT', title: `${plural(absent, 'chauffeur absent', 'chauffeurs absents')} aujourd'hui`, body: 'Ils ne sont pas proposés à l\'optimisation.', link: 'drivers', dedupeKey: `DRIVER_ABSENT${day}` })

  const down = await db.vehicleUnavailability.count({ where: { startDate: { lte: today }, endDate: { gte: today } } })
  if (down > 0) n += await notify(tenantId, { kind: 'VEHICLE_DOWN', title: `${plural(down, 'camion immobilisé', 'camions immobilisés')} aujourd'hui`, link: 'vehicles', dedupeKey: `VEHICLE_DOWN${day}` })

  const failing = await db.webhookEndpoint.count({ where: { active: true, consecutiveFailures: { gte: 5 } } })
  if (failing > 0) n += await notify(tenantId, { kind: 'WEBHOOK_FAILING', title: `${plural(failing, 'webhook ne répond plus', 'webhooks ne répondent plus')}`, body: 'Les événements sont conservés et renvoyés : vérifiez l\'URL du destinataire.', link: 'settings', dedupeKey: `WEBHOOK_FAILING${day}` })

  return n
}

/** Every active tenant (cross-tenant worker job). */
export async function runDailyBusinessChecks(): Promise<number> {
  const tenants = await unscopedPrisma.tenant.findMany({ where: { suspendedAt: null }, select: { id: true } })
  let total = 0
  for (const t of tenants) {
    try { total += await checkTenant(t.id) } catch (err) {
      log.error('Daily checks failed for tenant', { tenantId: t.id, err: err instanceof Error ? err.message : String(err) })
    }
  }
  return total
}
