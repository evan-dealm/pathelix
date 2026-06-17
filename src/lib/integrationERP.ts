import { createLogger } from '@/lib/logger'

const log = createLogger('integrationERP')

interface MissionBillingData {
  tenantId: string
  missionId: string
  missionType: string
  clientName: string
  clientId?: string
  date: string
  wasteType?: string
  weightTons?: number
  driverName: string
  exutoire?: string
  durationMin: number
}

export async function syncMissionToERP(data: MissionBillingData): Promise<void> {
  try {
    const prisma = (await import('@/lib/db')).default
    const integrations = await prisma.integration.findMany({
      where: { tenantId: data.tenantId, enabled: true, type: { in: ['sage', 'sap'] } },
      select: { type: true, config: true, id: true },
    })

    for (const integ of integrations) {
      const config = (integ.config ?? {}) as Record<string, unknown>
      try {
        if (integ.type === 'sage') {
          await syncToSage(config, data)
        } else if (integ.type === 'sap') {
          await syncToSAP(config, data)
        }
        await prisma.integration.update({ where: { id: integ.id }, data: { lastSyncAt: new Date(), lastError: null } })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await prisma.integration.update({ where: { id: integ.id }, data: { lastError: msg } }).catch(() => {})
        log.warn('ERP sync failed', { type: integ.type, err: msg })
      }
    }
  } catch (err) {
    log.error('ERP sync error (non-fatal)', { err: err instanceof Error ? err.message : String(err) })
  }
}

async function syncToSage(config: Record<string, unknown>, data: MissionBillingData): Promise<void> {
  const apiKey = String(config.apiKey ?? '')
  const companyId = String(config.companyId ?? '')
  if (!apiKey) throw new Error('Sage API key not configured')

  const payload = {
    type: 'service_invoice_line',
    company_id: companyId,
    date: data.date,
    customer_reference: data.clientId ?? data.clientName,
    description: `${data.missionType} — ${data.wasteType ?? 'Dechets'} — ${data.driverName}`,
    quantity: 1,
    weight_tons: data.weightTons ?? null,
    duration_hours: Math.round(data.durationMin / 60 * 100) / 100,
    reference: data.missionId,
  }

  const res = await fetch('https://api.sage.com/accounting/v3.1/sales_invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify(payload),
  })

  if (!res.ok) throw new Error(`Sage API ${res.status}`)
}

async function syncToSAP(config: Record<string, unknown>, data: MissionBillingData): Promise<void> {
  const baseUrl = String(config.baseUrl ?? '')
  const clientId = String(config.clientId ?? '')
  const clientSecret = String(config.clientSecret ?? '')
  if (!baseUrl || !clientId || !clientSecret) throw new Error('SAP config incomplete')

  const payload = {
    DocType: 'dDocument_Service',
    CardCode: data.clientId ?? data.clientName,
    DocDate: data.date,
    Comments: `Mission ${data.missionType} par ${data.driverName}`,
    DocumentLines: [{
      ItemDescription: `${data.missionType} — ${data.wasteType ?? 'Dechets'}`,
      Quantity: 1,
      Weight: data.weightTons ?? 0,
    }],
  }

  const res = await fetch(`${baseUrl}/b1s/v1/DeliveryNotes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) throw new Error(`SAP API ${res.status}`)
}
