import { NextResponse } from 'next/server'
import { Prisma }       from '@/generated/prisma'
import { getRequestId } from '@/lib/logger'

type ScopedLogger = {
  error: (_msg: string, _data?: unknown) => void
}

const PRISMA_ERROR_MAP: Record<string, { message: string; status: number }> = {
  P2002: { message: 'Cette valeur existe déjà.',                         status: 409 },
  P2003: { message: 'Référence invalide (contrainte de clé étrangère).',  status: 409 },
  P2014: { message: 'Relation requise manquante.',                        status: 409 },
  P2016: { message: 'Ressource introuvable.',                             status: 404 },
  P2025: { message: 'Ressource introuvable.',                             status: 404 },
  P2034: { message: 'Transaction annulée (conflit de mise à jour).',      status: 409 },
}

export function handleApiError(
  err:      unknown,
  log:      ScopedLogger,
  context?: Record<string, unknown>,
): NextResponse {

  const requestId = getRequestId() ?? crypto.randomUUID().slice(0, 8)

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = PRISMA_ERROR_MAP[err.code]
    log.error(`prisma [${err.code}]`, {
      requestId,
      prismaCode: err.code,
      prismaMeta: err.meta,
      ...context,
    })
    return NextResponse.json(
      { error: mapped?.message ?? 'Erreur base de données.', requestId },
      { status: mapped?.status ?? 500 },
    )
  }

  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    log.error('prisma init/panic', { requestId, message: (err as Error).message })
    return NextResponse.json(
      { error: 'Service temporairement indisponible.', requestId },
      { status: 503 },
    )
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    log.error('prisma validation', { requestId, message: err.message.slice(0, 200), ...context })
    return NextResponse.json(
      { error: 'Données invalides.', requestId },
      { status: 422 },
    )
  }

  const message = err instanceof Error ? err.message : String(err)
  log.error('unexpected error', { requestId, message, ...context })
  return NextResponse.json(
    { error: 'Erreur serveur.', requestId },
    { status: 500 },
  )
}
