import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { assertPublicUrl, BlockedUrlError } from '@/lib/outboundUrl'
import { hasPermission } from '@/lib/permissions'

const log = createLogger('/api/integrations/test')

const TestSchema = z.object({
  type:   z.string().min(1),
  config: z.record(z.string(), z.unknown()),
})

const TEST_TIMEOUT_MS = 5000

/** Null when the URL may be fetched, otherwise a user-facing reason (see src/lib/outboundUrl.ts). */
async function blockedReason(url: string): Promise<string | null> {
  try { await assertPublicUrl(url); return null }
  catch (err) { return err instanceof BlockedUrlError ? err.message : 'URL refusée' }
}

const ssrfBlocked = (reason: string): TestResult => ({ ok: false, message: `URL refusée : ${reason}` })

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { role, userId } = getRequestContext(req)
  // Same permission as saving an integration — someone allowed to configure it can test it.
  if (!(await hasPermission(userId, role, 'manage_integrations'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = TestSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { type, config } = parsed.data
  const t0 = Date.now()

  try {
    const result = await testIntegration(type, config)
    const latencyMs = Date.now() - t0

    log.info('Integration test', { type, ok: result.ok, latencyMs })

    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      latencyMs,
      details: result.details ?? null,
    })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : 'Erreur inconnue',
      latencyMs: Date.now() - t0,
    })
  }
}

interface TestResult {
  ok: boolean
  message: string
  details?: Record<string, unknown>
}

async function testIntegration(type: string, config: Record<string, unknown>): Promise<TestResult> {
  switch (type) {
    case 'osrm':        return testOSRM(config)
    case 'trimble':     return testAPIKey(config, 'Trimble')
    case 'here':        return testHERE(config)
    case 'geotab':      return testAPIKey(config, 'Geotab')
    case 'samsara':     return testSamsara(config)
    case 'nessy':       return testSecret(config, 'Nessy')
    case 'obd':         return testSecret(config, 'OBD')
    case 'slack':       return testWebhook(config, 'Slack')
    case 'teams':       return testWebhook(config, 'Teams')
    case 'twilio_sms':  return testTwilio(config)
    case 'custom_webhook': return testWebhook(config, 'Webhook')
    default:
      return { ok: false, message: `Type d'integration "${type}" non supporte pour le test` }
  }
}

async function testOSRM(config: Record<string, unknown>): Promise<TestResult> {
  const url = String(config.url ?? '')
  if (!url) return { ok: false, message: 'URL OSRM requise' }
  try { new URL(url) } catch { return { ok: false, message: 'Format d\'URL invalide' } }
  const blocked = await blockedReason(url)
  if (blocked) return ssrfBlocked(blocked)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)

    const res = await fetch(`${url}/nearest/v1/driving/6.1294,45.8992`, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'Pathelix/1.0' },
    })
    clearTimeout(timer)

    if (!res.ok) return { ok: false, message: `OSRM a repondu ${res.status}` }

    const data = await res.json()
    if (data.code === 'Ok') {
      return {
        ok: true,
        message: `OSRM opérationnel — point le plus proche trouvé`,
        details: { waypoint: data.waypoints?.[0]?.name },
      }
    }
    return { ok: false, message: `OSRM a repondu : ${data.code}` }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, message: `OSRM ne repond pas (timeout ${TEST_TIMEOUT_MS / 1000}s)` }
    }
    return { ok: false, message: `Impossible de joindre OSRM : ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function testHERE(config: Record<string, unknown>): Promise<TestResult> {
  const apiKey = String(config.apiKey ?? '')
  if (!apiKey || apiKey.length < 8) return { ok: false, message: 'Cle API HERE requise (min 8 caracteres)' }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)

    const res = await fetch(
      `https://geocode.search.hereapi.com/v1/geocode?q=Annecy&apiKey=${apiKey}&limit=1`,
      { signal: controller.signal },
    )
    clearTimeout(timer)

    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Cle API HERE invalide ou expiree' }
    if (!res.ok) return { ok: false, message: `HERE a repondu ${res.status}` }

    const data = await res.json()
    return {
      ok: true,
      message: `Connexion HERE reussie — ${data.items?.length ?? 0} resultat(s)`,
      details: { firstResult: data.items?.[0]?.title },
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, message: `HERE ne repond pas (timeout ${TEST_TIMEOUT_MS / 1000}s)` }
    }
    return { ok: false, message: `Impossible de joindre HERE : ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function testSamsara(config: Record<string, unknown>): Promise<TestResult> {
  const token = String(config.apiToken ?? '')
  if (!token || token.length < 8) return { ok: false, message: 'Token API Samsara requis' }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)

    const res = await fetch('https://api.samsara.com/fleet/drivers?limit=1', {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    })
    clearTimeout(timer)

    if (res.status === 401) return { ok: false, message: 'Token Samsara invalide' }
    if (!res.ok) return { ok: false, message: `Samsara a repondu ${res.status}` }

    return { ok: true, message: 'Connexion Samsara reussie' }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, message: `Samsara ne repond pas (timeout)` }
    }
    return { ok: false, message: `Impossible de joindre Samsara` }
  }
}

async function testSAP(config: Record<string, unknown>): Promise<TestResult> {
  const baseUrl = String(config.baseUrl ?? '')
  const clientId = String(config.clientId ?? '')
  const clientSecret = String(config.clientSecret ?? '')
  if (!baseUrl) return { ok: false, message: 'URL SAP requise' }
  const blocked = await blockedReason(baseUrl)
  if (blocked) return ssrfBlocked(blocked)
  if (!clientId || !clientSecret) return { ok: false, message: 'Client ID et Secret requis' }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)

    const res = await fetch(baseUrl, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'X-Client-Id': clientId },
    })
    clearTimeout(timer)

    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Authentification SAP refusee — verifiez Client ID/Secret' }

    return { ok: true, message: `Serveur SAP joignable (HTTP ${res.status})`, details: { status: res.status } }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, message: `SAP ne repond pas (timeout)` }
    }
    return { ok: false, message: `Impossible de joindre SAP : ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function testTwilio(config: Record<string, unknown>): Promise<TestResult> {
  const sid = String(config.accountSid ?? '')
  const token = String(config.authToken ?? '')
  const from = String(config.fromNumber ?? '')
  if (!sid || !token) return { ok: false, message: 'Account SID et Auth Token requis' }
  if (!from) return { ok: false, message: 'Numéro d’expéditeur requis' }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      signal: controller.signal,
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
    })
    clearTimeout(timer)

    if (res.status === 401) return { ok: false, message: 'Identifiants Twilio invalides' }
    if (!res.ok) return { ok: false, message: `Twilio a repondu ${res.status}` }

    const data = await res.json()
    return {
      ok: true,
      message: `Compte Twilio verifie : ${data.friendly_name ?? sid}`,
      details: { friendlyName: data.friendly_name, status: data.status },
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, message: `Twilio ne repond pas (timeout)` }
    }
    return { ok: false, message: `Impossible de joindre Twilio` }
  }
}

async function testWebhook(config: Record<string, unknown>, label: string): Promise<TestResult> {
  const url = String(config.webhookUrl ?? config.url ?? '')
  if (!url) return { ok: false, message: `URL ${label} requise` }

  try { new URL(url) }
  catch { return { ok: false, message: 'Format d\'URL invalide' } }

  const blocked = await blockedReason(url)
  if (blocked) return ssrfBlocked(blocked)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)

    const res = await fetch(url, {
      redirect: 'manual',
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Pathelix/1.0 (test)' },
      body: JSON.stringify({ type: 'test', message: 'Test de connexion PATHÉLIX', timestamp: new Date().toISOString() }),
    })
    clearTimeout(timer)

    if (res.status >= 500) return { ok: false, message: `${label} a repondu avec une erreur serveur (${res.status})` }

    return {
      ok: true,
      message: `${label} joignable (HTTP ${res.status})`,
      details: { status: res.status },
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, message: `${label} ne repond pas (timeout ${TEST_TIMEOUT_MS / 1000}s)` }
    }
    return { ok: false, message: `Impossible de joindre ${label} : ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function testAPIKey(config: Record<string, unknown>, label: string): Promise<TestResult> {
  const key = String(config.apiKey ?? config.apiToken ?? config.clientId ?? '')
  if (!key) return { ok: false, message: `Cle API ${label} requise` }
  if (key.length < 8) return { ok: false, message: `Cle API ${label} trop courte (min 8 caracteres)` }

  return { ok: true, message: `Format de cle ${label} valide (${key.length} caracteres). La verification complete se fera a la premiere synchronisation.` }
}

async function testSecret(config: Record<string, unknown>, label: string): Promise<TestResult> {
  const secret = String(config.webhookSecret ?? config.secret ?? '')
  if (!secret) return { ok: false, message: `Secret ${label} requis` }
  if (secret.length < 16) return { ok: false, message: `Secret ${label} trop court (min 16 caracteres pour la securite)` }

  return { ok: true, message: `Secret ${label} valide (${secret.length} caracteres)` }
}
