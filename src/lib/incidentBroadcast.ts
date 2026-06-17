export interface IncidentEvent {
  missionId:   string
  incidentType: string
  notes:       string
  address:     string
  clientName:  string
  reportedBy:  string
  reportedAt:  string
}

type SSEController = ReadableStreamDefaultController<Uint8Array>

const _channels = new Map<string, Set<SSEController>>()

export function registerIncidentSSE(tenantId: string, ctrl: SSEController): () => void {
  if (!_channels.has(tenantId)) _channels.set(tenantId, new Set())
  _channels.get(tenantId)!.add(ctrl)
  return () => { _channels.get(tenantId)?.delete(ctrl) }
}

export function broadcastIncident(tenantId: string, event: IncidentEvent): void {
  const ctrls = _channels.get(tenantId)
  if (!ctrls || ctrls.size === 0) return
  const data  = `data: ${JSON.stringify(event)}\n\n`
  const bytes = new TextEncoder().encode(data)
  for (const ctrl of ctrls) {
    try { ctrl.enqueue(bytes) }
    catch { ctrls.delete(ctrl) }
  }
}
