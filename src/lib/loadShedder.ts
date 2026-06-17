import { createLogger } from '@/lib/logger'
import { metrics }      from '@/lib/metrics'

const log = createLogger('loadShedder')

interface LoadShedderConfig {

  normalThreshold: number

  maxConcurrent:   number

  throttleDelayMs: number
}

const DEFAULT_CONFIG: LoadShedderConfig = {
  normalThreshold: parseInt(process.env.LOAD_NORMAL_THRESHOLD ?? '50',  10),
  maxConcurrent:   parseInt(process.env.LOAD_MAX_CONCURRENT  ?? '200', 10),
  throttleDelayMs: parseInt(process.env.LOAD_THROTTLE_MS     ?? '100', 10),
}

let _concurrent = 0

export const loadShedder = {

  get concurrent(): number { return _concurrent },

  acquire(): 'ok' | 'throttle' | 'shed' {
    if (_concurrent >= DEFAULT_CONFIG.maxConcurrent) {
      metrics.increment('load_shedder.shed')
      log.warn('Load shedding actif', { concurrent: _concurrent, max: DEFAULT_CONFIG.maxConcurrent })
      return 'shed'
    }
    _concurrent++
    metrics.histogram('load_shedder.concurrent', _concurrent)

    if (_concurrent > DEFAULT_CONFIG.normalThreshold) {
      metrics.increment('load_shedder.throttle')
      return 'throttle'
    }
    return 'ok'
  },

  release(): void {
    if (_concurrent > 0) _concurrent--
  },

  async wrap<T>(
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const result = this.acquire()
    if (result === 'shed') return null

    if (result === 'throttle') {
      await new Promise(r => setTimeout(r, DEFAULT_CONFIG.throttleDelayMs))
    }

    try {
      return await fn()
    } finally {
      this.release()
    }
  },

  reset(): void { _concurrent = 0 },
}

export function shedResponse(): Response {
  return new Response(
    JSON.stringify({ error: 'Service temporairement surchargé. Réessayez dans quelques secondes.' }),
    {
      status:  503,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After':  '5',
        'X-Load-Shed':  '1',
      },
    },
  )
}
