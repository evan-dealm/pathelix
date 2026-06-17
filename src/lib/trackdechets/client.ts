import { createLogger } from '@/lib/logger'
import type { TdGraphQLResponse } from './types'

const log = createLogger('trackdechets/client')

const DEFAULT_TD_URL = 'https://sandbox.trackdechets.beta.gouv.fr/'

function getTdApiUrl(): string {
  return process.env.TRACKDECHETS_API_URL ?? DEFAULT_TD_URL
}

export class TdApiError extends Error {
  readonly errors: Array<{ message: string }>
  readonly statusCode?: number

  constructor(
    message:    string,
    errors:     Array<{ message: string }>,
    statusCode?: number,
  ) {
    super(message)
    this.name       = 'TdApiError'
    this.errors     = errors
    this.statusCode = statusCode
  }
}

export async function callTdGraphQL<T>(
  token:      string,
  query:      string,
  variables?: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<T> {
  const url        = getTdApiUrl()
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${token}`,
      },
      body:   JSON.stringify({ query, variables }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      log.error('TD API HTTP error', { status: res.status, url, body: text.slice(0, 200) })
      throw new TdApiError(`HTTP ${res.status}`, [], res.status)
    }

    const json = (await res.json()) as TdGraphQLResponse<T>
    if (json.errors?.length) {
      const msg = json.errors.map(e => e.message).join('; ')
      log.error('TD API GraphQL errors', { errors: json.errors })
      throw new TdApiError(msg, json.errors)
    }
    if (!json.data) {
      throw new TdApiError('Réponse TD vide (pas de data)', [])
    }
    return json.data
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof TdApiError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TdApiError(`Timeout Trackdéchets (${timeoutMs}ms)`, [])
    }
    throw err
  }
}
