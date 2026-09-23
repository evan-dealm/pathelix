import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { getTenantDb } from '@/lib/tenantDb'

const log = createLogger('/api/missions/[id]/proof')

const DeliveryProofSchema = z.object({
  photoUrl:     z.string().url().max(2000).optional().nullable(),
  signatureUrl: z.string().url().max(2000).optional().nullable(),
  notes:        z.string().max(2000).optional(),
  capturedAt:   z.string().datetime({ offset: true }).optional(),
  driverId:     z.string().min(1).max(100),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)
  const { id } = await params

  try {
    const mission = await getTenantDb(tenantId).mission.findFirst({
      where: { id },
      select: { id: true, proof: true },
    })
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
    return NextResponse.json({ proof: mission.proof ?? null })
  } catch (err) {
    log.error('GET proof failed', { missionId: id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { tenantId, userId, role } = getRequestContext(req)
  const { id } = await params

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = DeliveryProofSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { driverId, notes, capturedAt, photoUrl, signatureUrl } = parsed.data

  try {
    const db = getTenantDb(tenantId)
    const mission = await db.mission.findFirst({
      where: { id },
      select: { id: true, tenantId: true },
    })
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

    const isOwnDriver = role === 'driver' && (userId === driverId)
    const isStaff = role === 'admin' || role === 'dispatcher' || role === 'superadmin'
    if (!isOwnDriver && !isStaff) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const proof = await db.deliveryProof.upsert({
      where:  { missionId: id },
      create: {
        missionId: id,
        driverId,
        photoUrl:     photoUrl ?? null,
        signatureUrl: signatureUrl ?? null,
        notes:        notes ?? '',
        capturedAt:   capturedAt ? new Date(capturedAt) : new Date(),
      } as Parameters<typeof db.deliveryProof.upsert>[0]['create'],
      update: {
        photoUrl:     photoUrl !== undefined ? photoUrl : undefined,
        signatureUrl: signatureUrl !== undefined ? signatureUrl : undefined,
        notes:        notes !== undefined ? notes : undefined,
        capturedAt:   capturedAt ? new Date(capturedAt) : undefined,
      },
    })

    log.info('Delivery proof saved', { missionId: id, tenantId, driverId })
    return NextResponse.json({ proof }, { status: 200 })
  } catch (err) {
    log.error('POST proof failed', { missionId: id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
