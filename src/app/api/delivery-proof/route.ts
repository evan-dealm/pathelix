import { NextRequest, NextResponse } from 'next/server'
import { createLogger }              from '@/lib/logger'
import { getRequestContext }         from '@/lib/data/context'
import { getTenantDb }                from '@/lib/tenantDb'
import { driverOwnsMission, isStaff } from '@/lib/driverAccess'
import { detectImageExt, writeUpload } from '@/lib/uploadStorage'

const log = createLogger('/api/delivery-proof')

const MAX_FILE_BYTES = 5 * 1024 * 1024

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId, role, driverRef } = getRequestContext(req)

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Formulaire invalide' }, { status: 400 })

  const missionId = form.get('missionId')?.toString()
  const driverId  = form.get('driverId')?.toString()
  const notes     = form.get('notes')?.toString() ?? ''
  const photo     = form.get('photo') as File | null
  const signature = form.get('signature') as File | null

  if (!missionId || !driverId) {
    return NextResponse.json({ error: 'missionId et driverId requis' }, { status: 422 })
  }

  const db = getTenantDb(tenantId)
  const mission = await db.mission.findFirst({ where: { id: missionId } })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // DeliveryProof.driverId has no DB-level FK — driverId comes straight
  // from client form data, so it must be checked against tenantId here or a proof could get
  // written referencing a driver that belongs to a different tenant.
  const driver = await db.driver.findFirst({ where: { id: driverId }, select: { id: true } })
  if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })

  // A driver may only prove its own deliveries — not overwrite a colleague's proof.
  if (!isStaff(role)) {
    const ownId = driverRef ?? userId
    if (driverId !== ownId || !(await driverOwnsMission(db, driverId, missionId))) {
      return NextResponse.json({ error: 'Mission absente de votre tournée' }, { status: 403 })
    }
  }

  let photoUrl:     string | undefined
  let signatureUrl: string | undefined

  if (photo && photo.size > 0) {
    if (photo.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Fichier photo trop volumineux (max 5 MB)' }, { status: 413 })
    }
    const bytes  = new Uint8Array(await photo.arrayBuffer())
    const ext    = detectImageExt(bytes)
    if (!ext) {
      return NextResponse.json({ error: 'Format photo invalide (JPEG, PNG, GIF ou WEBP requis)' }, { status: 422 })
    }
    photoUrl = await writeUpload(tenantId, 'proofs', `proof-${crypto.randomUUID()}.${ext}`, Buffer.from(bytes))
  }

  if (signature && signature.size > 0) {
    if (signature.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Fichier signature trop volumineux (max 5 MB)' }, { status: 413 })
    }
    const bytes = new Uint8Array(await signature.arrayBuffer())
    const ext   = detectImageExt(bytes)
    if (!ext) {
      return NextResponse.json({ error: 'Format signature invalide (JPEG, PNG, GIF ou WEBP requis)' }, { status: 422 })
    }
    signatureUrl = await writeUpload(tenantId, 'proofs', `proof-${crypto.randomUUID()}.${ext}`, Buffer.from(bytes))
  }

  try {
    const proof = await db.deliveryProof.upsert({
      where:  { missionId },
      create: { missionId, driverId, notes, photoUrl, signatureUrl } as Parameters<typeof db.deliveryProof.upsert>[0]['create'],
      update: { notes, ...(photoUrl ? { photoUrl } : {}), ...(signatureUrl ? { signatureUrl } : {}) },
    })

    log.info('Delivery proof saved', { tenantId, missionId, driverId, userId })
    return NextResponse.json({ ok: true, proof })
  } catch (err) {
    log.error('Failed to save proof', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId, driverRef } = getRequestContext(req)
  const missionId    = req.nextUrl.searchParams.get('missionId')

  if (!missionId) return NextResponse.json({ error: 'missionId requis' }, { status: 400 })

  try {
    const db = getTenantDb(tenantId)
    if (!isStaff(role) && !(await driverOwnsMission(db, driverRef ?? userId, missionId))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    const proof = await db.deliveryProof.findFirst({ where: { missionId } })
    return NextResponse.json({ proof: proof ?? null })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
