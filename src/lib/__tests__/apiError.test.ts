import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@/generated/prisma'

vi.mock('@/generated/prisma', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string; meta?: Record<string, unknown>; clientVersion: string
    constructor(msg: string, opts: { code: string; clientVersion: string; meta?: Record<string, unknown>; batchRequestIdx?: number }) {
      super(msg)
      this.name = 'PrismaClientKnownRequestError'
      this.code = opts.code
      this.clientVersion = opts.clientVersion
      this.meta = opts.meta
    }
  }
  class PrismaClientInitializationError extends Error {
    clientVersion: string
    constructor(msg: string, clientVersion: string) {
      super(msg); this.name = 'PrismaClientInitializationError'; this.clientVersion = clientVersion
    }
  }
  class PrismaClientRustPanicError extends Error {
    clientVersion: string
    constructor(msg: string, clientVersion: string) {
      super(msg); this.name = 'PrismaClientRustPanicError'; this.clientVersion = clientVersion
    }
  }
  class PrismaClientValidationError extends Error {
    clientVersion: string
    constructor(msg: string, opts: { clientVersion: string }) {
      super(msg); this.name = 'PrismaClientValidationError'; this.clientVersion = opts.clientVersion
    }
  }
  return {
    Prisma: {
      PrismaClientKnownRequestError,
      PrismaClientInitializationError,
      PrismaClientRustPanicError,
      PrismaClientValidationError,
    },
  }
})

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  getRequestId: vi.fn(() => 'req-test-123'),
}))

import { handleApiError } from '@/lib/apiError'

const CV = '7.0.0'

let log: { error: ReturnType<typeof vi.fn> }

beforeEach(() => {
  log = { error: vi.fn() }
})

describe('handleApiError — PrismaClientKnownRequestError', () => {
  it('P2002 → 409 unique constraint', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: CV, meta: { target: 'email' } })
    const res = handleApiError(err, log)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('Cette valeur existe déjà.')
    expect(body.requestId).toBe('req-test-123')
    expect(log.error).toHaveBeenCalledOnce()
  })

  it('P2003 → 409 foreign key', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('FK', { code: 'P2003', clientVersion: CV })
    const res = handleApiError(err, log)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('Référence invalide (contrainte de clé étrangère).')
  })

  it('P2014 → 409 relation required', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Rel', { code: 'P2014', clientVersion: CV })
    const res = handleApiError(err, log)
    expect(res.status).toBe(409)
  })

  it('P2016 → 404 record not found', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('NF', { code: 'P2016', clientVersion: CV })
    const res = handleApiError(err, log)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Ressource introuvable.')
  })

  it('P2025 → 404 record not found', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('NF', { code: 'P2025', clientVersion: CV })
    const res = handleApiError(err, log)
    expect(res.status).toBe(404)
  })

  it('P2034 → 409 write conflict', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Conflict', { code: 'P2034', clientVersion: CV })
    const res = handleApiError(err, log)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('Transaction annulée (conflit de mise à jour).')
  })

  it('unknown P code → 500 fallback', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unknown', { code: 'P9999', clientVersion: CV })
    const res = handleApiError(err, log)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Erreur base de données.')
  })

  it('passes context to log', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: CV })
    handleApiError(err, log, { route: '/api/test', tenantId: 't1' })
    const logArgs = log.error.mock.calls[0]
    expect(logArgs[1]).toMatchObject({ route: '/api/test', tenantId: 't1' })
  })
})

describe('handleApiError — init/panic errors', () => {
  it('PrismaClientInitializationError → 503', async () => {
    const err = new Prisma.PrismaClientInitializationError('Cannot connect to DB', CV)
    const res = handleApiError(err, log)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('Service temporairement indisponible.')
    expect(log.error).toHaveBeenCalledWith('prisma init/panic', expect.objectContaining({ message: 'Cannot connect to DB' }))
  })

  it('PrismaClientRustPanicError → 503', async () => {
    const err = new Prisma.PrismaClientRustPanicError('Panic!', CV)
    const res = handleApiError(err, log)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('Service temporairement indisponible.')
  })
})

describe('handleApiError — validation error', () => {
  it('PrismaClientValidationError → 422', async () => {
    const err = new Prisma.PrismaClientValidationError('Invalid argument type at field X', { clientVersion: CV })
    const res = handleApiError(err, log)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('Données invalides.')
    expect(log.error).toHaveBeenCalledWith('prisma validation', expect.objectContaining({ requestId: 'req-test-123' }))
  })
})

describe('handleApiError — generic errors', () => {
  it('Error instance → 500', async () => {
    const err = new Error('Unexpected crash')
    const res = handleApiError(err, log)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Erreur serveur.')
    expect(log.error).toHaveBeenCalledWith('unexpected error', expect.objectContaining({ message: 'Unexpected crash' }))
  })

  it('non-Error string → 500', async () => {
    const res = handleApiError('something bad', log)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Erreur serveur.')
    expect(log.error).toHaveBeenCalledWith('unexpected error', expect.objectContaining({ message: 'something bad' }))
  })

  it('includes requestId in response', async () => {
    const res = handleApiError(new Error('boom'), log)
    const body = await res.json()
    expect(body.requestId).toBe('req-test-123')
  })
})
