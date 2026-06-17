import { NextResponse } from 'next/server'
import { getRedisClient } from '@/lib/redisClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface ServiceStatus {
  name: string
  status: 'operational' | 'degraded' | 'outage'
  latencyMs?: number
  message?: string
}

export async function GET(): Promise<NextResponse> {
  const services: ServiceStatus[] = []
  let overallStatus: 'operational' | 'degraded' | 'outage' = 'operational'

  try {
    const prisma = (await import('@/lib/db')).default
    const start = Date.now()
    await prisma.$queryRaw`SELECT 1`
    services.push({ name: 'Database (PostgreSQL)', status: 'operational', latencyMs: Date.now() - start })
  } catch {
    services.push({ name: 'Database (PostgreSQL)', status: 'outage', message: 'Connection failed' })
    overallStatus = 'outage'
  }

  try {
    const redis = await getRedisClient()
    if (redis) {
      const start = Date.now()
      await redis.ping()
      services.push({ name: 'Cache (Redis)', status: 'operational', latencyMs: Date.now() - start })
    } else {
      services.push({ name: 'Cache (Redis)', status: 'degraded', message: 'Not configured — using in-memory fallback' })
      if (overallStatus === 'operational') overallStatus = 'degraded'
    }
  } catch {
    services.push({ name: 'Cache (Redis)', status: 'outage', message: 'Connection failed' })
    overallStatus = 'outage'
  }

  const osrmUrl = process.env.OSRM_URL
  if (osrmUrl) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const start = Date.now()
      const res = await fetch(`${osrmUrl}/nearest/v1/driving/6.0,45.5`, { signal: controller.signal })
      clearTimeout(timeout)
      services.push({ name: 'Routing (OSRM)', status: res.ok ? 'operational' : 'degraded', latencyMs: Date.now() - start })
    } catch {
      services.push({ name: 'Routing (OSRM)', status: 'degraded', message: 'Timeout or unreachable — haversine fallback active' })
      if (overallStatus === 'operational') overallStatus = 'degraded'
    }
  } else {
    services.push({ name: 'Routing (OSRM)', status: 'degraded', message: 'Not configured — using haversine estimation' })
  }

  try {
    const redis = await getRedisClient()
    if (redis) {
      const waiting = await redis.llen('bull:vrp-optimization:wait')
      const active = await redis.llen('bull:vrp-optimization:active')
      services.push({
        name: 'Job Queue (VRP)',
        status: 'operational',
        message: `${active} active, ${waiting} en attente`,
      })
    } else {
      services.push({ name: 'Job Queue (VRP)', status: 'degraded', message: 'Synchronous mode (no Redis)' })
    }
  } catch {
    services.push({ name: 'Job Queue (VRP)', status: 'degraded' })
  }

  services.push({
    name: 'Application (Next.js)',
    status: 'operational',
    latencyMs: 0,
    message: `Uptime ${Math.round(process.uptime() / 3600)}h`,
  })

  return NextResponse.json({
    status: overallStatus,
    services,
    timestamp: new Date().toISOString(),
    sla: {
      target: '99.9%',
      description: 'PATHÉLIX garantit 99.9% de disponibilite sur les services critiques (Database, Application).',
    },
  }, {
    headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
  })
}
