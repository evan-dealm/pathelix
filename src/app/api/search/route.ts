import { apiRoute } from '@/lib/api/route'
import { hasPermission, type Permission } from '@/lib/permissions'

interface SearchHit { kind: 'mission' | 'client' | 'site' | 'container' | 'driver' | 'vehicle' | 'quote' | 'order' | 'invoice'; id: string; label: string; sub: string; tab: string }

const PER_KIND = 5

/**
 * Global search (Ctrl/Cmd+K) across the tenant's records — each family only for users allowed
 * to see it (the same permissions as the screens). Case- and accent-insensitive "contains".
 */
export const GET = apiRoute({ name: '/api/search' }, async ({ db, userId, role, req }) => {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80)
  if (q.length < 2) return { hits: [] }
  const can = async (p: Permission) => hasPermission(userId, role, p)
  const [missions, sales, billing, drivers, vehicles] = await Promise.all([can('manage_missions'), can('manage_sales'), can('manage_billing'), can('manage_drivers'), can('manage_vehicles')])
  const like = { contains: q, mode: 'insensitive' as const }
  const fr = (d: string | null | undefined) => (d ? d.split('-').reverse().join('/') : '')

  const [ms, cl, si, co, dr, ve, qu, or, inv] = await Promise.all([
    missions ? db.mission.findMany({ where: { archived: false, OR: [{ clientName: like }, { address: like }, { notes: like }] }, orderBy: { date: 'desc' }, take: PER_KIND, select: { id: true, type: true, date: true, clientName: true, address: true } }) : [],
    db.client.findMany({ where: { archived: false, OR: [{ name: like }, { email: like }, { phone: like }, { siret: like }] }, take: PER_KIND, select: { id: true, name: true, email: true, phone: true } }),
    db.site.findMany({ where: { archived: false, OR: [{ name: like }, { address: like }, { city: like }] }, take: PER_KIND, select: { id: true, name: true, address: true, city: true } }),
    db.container.findMany({ where: { archived: false, number: like }, take: PER_KIND, select: { id: true, number: true, status: true, type: { select: { name: true } } } }),
    drivers ? db.driver.findMany({ where: { archived: false, OR: [{ firstName: like }, { lastName: like }, { phone: like }] }, take: PER_KIND, select: { id: true, firstName: true, lastName: true, sector: true } }) : [],
    vehicles ? db.vehicle.findMany({ where: { archived: false, OR: [{ licensePlate: like }, { brand: like }, { model: like }] }, take: PER_KIND, select: { id: true, licensePlate: true, brand: true, model: true } }) : [],
    sales ? db.quote.findMany({ where: { OR: [{ number: like }, { title: like }] }, orderBy: { createdAt: 'desc' }, take: PER_KIND, select: { id: true, number: true, title: true, status: true } }) : [],
    sales ? db.order.findMany({ where: { OR: [{ number: like }, { title: like }] }, orderBy: { createdAt: 'desc' }, take: PER_KIND, select: { id: true, number: true, title: true, status: true } }) : [],
    billing ? db.invoice.findMany({ where: { OR: [{ number: like }, { clientName: like }] }, orderBy: { createdAt: 'desc' }, take: PER_KIND, select: { id: true, number: true, clientName: true, kind: true, status: true, totalTTC: true } }) : [],
  ])

  const hits: SearchHit[] = [
    ...ms.map(m => ({ kind: 'mission' as const, id: m.id, label: m.clientName || m.address, sub: [m.type, fr(m.date), m.clientName ? m.address : ''].filter(Boolean).join(' · '), tab: 'missions' })),
    ...cl.map(c => ({ kind: 'client' as const, id: c.id, label: c.name, sub: [c.email, c.phone].filter(Boolean).join(' · '), tab: 'catalogue' })),
    ...si.map(s => ({ kind: 'site' as const, id: s.id, label: s.name, sub: [s.address, s.city].filter(Boolean).join(', '), tab: 'catalogue' })),
    ...co.map(c => ({ kind: 'container' as const, id: c.id, label: `Benne ${c.number}`, sub: `${c.type.name} · ${c.status}`, tab: 'containers' })),
    ...dr.map(d => ({ kind: 'driver' as const, id: d.id, label: `${d.firstName} ${d.lastName}`.trim(), sub: d.sector, tab: 'drivers' })),
    ...ve.map(v => ({ kind: 'vehicle' as const, id: v.id, label: v.licensePlate, sub: [v.brand, v.model].filter(Boolean).join(' '), tab: 'vehicles' })),
    ...qu.map(x => ({ kind: 'quote' as const, id: x.id, label: `Devis ${x.number}`, sub: [x.title, x.status].filter(Boolean).join(' · '), tab: 'sales' })),
    ...or.map(x => ({ kind: 'order' as const, id: x.id, label: `Commande ${x.number}`, sub: [x.title, x.status].filter(Boolean).join(' · '), tab: 'sales' })),
    ...inv.map(x => ({ kind: 'invoice' as const, id: x.id, label: `${x.kind === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'} ${x.number ?? '(brouillon)'}`, sub: `${x.clientName} · ${x.totalTTC.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`, tab: 'billing' })),
  ]
  return { hits }
})
