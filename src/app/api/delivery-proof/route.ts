import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir }          from 'fs/promises'
import { join }                      from 'path'
import { createLogger }              from '@/lib/logger'
import { getRequestContext }         from '@/lib/data/context'
import prisma                        from '@/lib/db'

const log = createLogger('/api/delivery-proof')

const MAX_FILE_BYTES = 5 * 1024 * 1024

const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const PNG_MAGIC  = [0x89, 0x50, 0x4e, 0x47]

function detectImageType(buf: Uint8Array): 'jpg' | 'png' | null {
  if (buf.length >= 4 && PNG_MAGIC.every((b, i) => buf[i] === b))  return 'png'
  if (buf.length >= 3 && JPEG_MAGIC.every((b, i) => buf[i] === b)) return 'jpg'
  return null
}

function safeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId } = getRequestContext(req)

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

  const mission = await prisma.mission.findFirst({ where: { id: missionId, tenantId } })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // DeliveryProof.driverId has no DB-level FK — driverId comes straight
  // from client form data, so it must be checked against tenantId here or a proof could get
  // written referencing a driver that belongs to a different tenant.
  const driver = await prisma.driver.findFirst({ where: { id: driverId, tenantId }, select: { id: true } })
  if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })

  const uploadsDir = join(process.cwd(), 'public', 'uploads', safeName(tenantId))
  await mkdir(uploadsDir, { recursive: true })

  let photoUrl:     string | undefined
  let signatureUrl: string | undefined

  if (photo && photo.size > 0) {
    if (photo.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Fichier photo trop volumineux (max 5 MB)' }, { status: 413 })
    }
    const bytes  = new Uint8Array(await photo.arrayBuffer())
    const ext    = detectImageType(bytes)
    if (!ext) {
      return NextResponse.json({ error: 'Format photo invalide (JPEG ou PNG requis)' }, { status: 422 })
    }
    const name = `proof-${crypto.randomUUID()}.${ext}`
    await writeFile(join(uploadsDir, name), Buffer.from(bytes))
    photoUrl = `/uploads/${safeName(tenantId)}/${name}`
  }

  if (signature && signature.size > 0) {
    if (signature.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Fichier signature trop volumineux (max 5 MB)' }, { status: 413 })
    }
    const bytes = new Uint8Array(await signature.arrayBuffer())
    const ext   = detectImageType(bytes)
    if (!ext) {
      return NextResponse.json({ error: 'Format signature invalide (JPEG ou PNG requis)' }, { status: 422 })
    }
    const name = `proof-${crypto.randomUUID()}.${ext}`
    await writeFile(join(uploadsDir, name), Buffer.from(bytes))
    signatureUrl = `/uploads/${safeName(tenantId)}/${name}`
  }

  try {
    const proof = await prisma.deliveryProof.upsert({
      where:  { missionId },
      create: { tenantId, missionId, driverId, notes, photoUrl, signatureUrl },
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
  const { tenantId } = getRequestContext(req)
  const missionId    = req.nextUrl.searchParams.get('missionId')

  if (!missionId) return NextResponse.json({ error: 'missionId requis' }, { status: 400 })

  try {
    const proof = await prisma.deliveryProof.findFirst({ where: { missionId, tenantId } })
    return NextResponse.json({ proof: proof ?? null })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
