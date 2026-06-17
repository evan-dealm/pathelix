import { NextRequest }                            from 'next/server'
import { getRequestContext }                      from '@/lib/data/context'
import { registerIncidentSSE }                    from '@/lib/incidentBroadcast'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { tenantId } = getRequestContext(req)

  let unregister: (() => void) | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const encoder = new TextEncoder()

      ctrl.enqueue(encoder.encode(': connected\n\n'))
      unregister = registerIncidentSSE(tenantId, ctrl)

      const ping = setInterval(() => {
        try { ctrl.enqueue(encoder.encode(': ping\n\n')) }
        catch { clearInterval(ping) }
      }, 25_000)

      req.signal.addEventListener('abort', () => {
        clearInterval(ping)
        unregister?.()
      })
    },
    cancel() {
      unregister?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
