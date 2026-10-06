import { NextResponse } from 'next/server'
import { portalRoute } from '@/lib/portal/route'
import { contentTypeFor, readUpload } from '@/lib/uploadStorage'

/**
 * Proof of an intervention of the customer's own company: `?what=photo|signature`. The file is
 * served only if the mission belongs to the session's customer.
 */
export const GET = portalRoute({ name: '/api/portal/missions/[id]/proof' }, async ({ db, session, req, params }) => {
  const m = await db.mission.findFirst({ where: { id: params.id, clientId: session.clientId }, select: { proof: { select: { photoUrl: true, signatureUrl: true } } } })
  const url = req.nextUrl.searchParams.get('what') === 'signature' ? m?.proof?.signatureUrl : m?.proof?.photoUrl
  // Stored as /api/files/<tenantId>/proofs/<name> (src/lib/uploadStorage.ts).
  const match = url ? /^\/api\/files\/([^/]+)\/proofs\/([^/]+)$/.exec(url) : null
  if (!match || match[1] !== session.tenantId) return NextResponse.json({ error: 'Preuve introuvable' }, { status: 404 })
  const name = decodeURIComponent(match[2])
  const type = contentTypeFor(name)
  const bytes = type ? await readUpload(session.tenantId, 'proofs', name) : null
  if (!bytes || !type) return NextResponse.json({ error: 'Preuve introuvable' }, { status: 404 })
  return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
})
