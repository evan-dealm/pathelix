import { PrismaClient } from '@/generated/prisma'
import { PrismaPg }     from '@prisma/adapter-pg'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {

  const poolSize = parseInt(process.env.DB_POOL_SIZE || '20', 10)
  const adapter = new PrismaPg({
    connectionString:      process.env.DATABASE_URL,
    max:                   poolSize,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis:     30_000,
  })
  return new PrismaClient({
    adapter,

    log: process.env.NODE_ENV === 'development' ? ['warn'] : [],
  })
}

export const prisma: PrismaClient =
  globalThis.__prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}

export default prisma
