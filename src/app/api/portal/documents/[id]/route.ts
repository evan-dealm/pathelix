import { NextResponse } from 'next/server'
import { portalRoute } from '@/lib/portal/route'
import { readDocument } from '@/lib/documents/archive'

/** A document the haulier shared with this customer (visibleToClient), downloaded. */
export const GET = portalRoute({ name: '/api/portal/documents/[id]' }, async ({ db, session, params }) => {
  const d = await db.document.findFirst({ where: { id: params.id, clientId: session.clientId, visibleToClient: true } })
  const bytes = d ? await readDocument(d.storageKey) : null
  if (!d || !bytes) return NextResponse.json({ error: 'Document introuvable' }, { status: 404 })
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': d.mimeType, 'Content-Disposition': `attachment; filename="${encodeURIComponent(d.filename)}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  })
})
