import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { createRateLimiter, getClientIp } from '@/lib/rateLimit'

const log = createLogger('/api/missions/parse-natural')
const _ipRl     = createRateLimiter(30, 60_000)
const _tenantRl = createRateLimiter(30, 60_000)

const InputSchema = z.object({
  text: z.string().min(5).max(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const MissionTypes = ['POSER', 'RETIRER', 'ECHANGER', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR'] as const

const LlmOutputSchema = z.object({
  type:                 z.enum(MissionTypes).optional(),
  address:              z.string().optional(),
  clientName:           z.string().optional(),
  estimatedDurationMin: z.number().int().min(5).max(480).optional(),
  priority:             z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  timeWindow: z.object({
    openMin:  z.number().int().min(0).max(1439),
    closeMin: z.number().int().min(0).max(1439),
  }).optional(),
  notes:     z.string().optional(),
  binSize:   z.string().optional(),
})

type LlmOutput = z.infer<typeof LlmOutputSchema>

const SYSTEM_PROMPT = `Tu es un assistant de saisie de missions pour une application de gestion de flotte (transport de bennes/déchets).
Extrais les informations de la demande utilisateur et retourne UNIQUEMENT un objet JSON valide, sans texte avant ni après.

Types de missions disponibles :
- POSER : déposer une benne/conteneur chez un client
- RETIRER : récupérer une benne/conteneur chez un client
- ECHANGER : déposer une benne pleine et récupérer la vide (échange)
- CHARGER_IMMEDIAT : charger immédiatement un véhicule sur site
- DEPLACER : déplacer une benne d'un endroit à un autre
- TASSER : compacter/tasser le contenu d'une benne
- EXPEDIER : expédier un conteneur vers un exutoire
- ALLER_RETOUR : mission aller-retour avec collecte et retour dépôt

Champs à extraire (tous optionnels sauf type) :
- type: string (parmi les types ci-dessus)
- address: string (adresse complète si mentionnée)
- clientName: string (nom du client/société)
- estimatedDurationMin: number (durée en minutes, estimation si non précisée : POSER/RETIRER=30, ECHANGER=45, autres=20)
- priority: 1 (urgent/P1), 2 (normal), 3 (basse priorité)
- timeWindow: { openMin: number, closeMin: number } (minutes depuis minuit, ex: 8h=480, 10h=600, 12h=720)
- notes: string (remarques, notes d'accès)
- binSize: string (taille de benne, ex: "8m3", "15m3", "ampliroll")

Retourne uniquement le JSON, exemple :
{"type":"POSER","address":"14 rue des Artisans, Lyon 69003","clientName":"Dupont BTP","estimatedDurationMin":30,"priority":1,"timeWindow":{"openMin":420,"closeMin":600},"binSize":"8m3"}`

async function callOllama(userText: string): Promise<LlmOutput> {
  const ollamaUrl   = process.env.OLLAMA_URL   || 'http://localhost:11434'
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3'

  const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userText },
      ],
      temperature: 0.1,
      max_tokens:  400,
      stream:      false,
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}`)
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = data.choices?.[0]?.message?.content?.trim() ?? ''

  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('LLM response contains no JSON object')

  const parsed = JSON.parse(jsonMatch[0]) as unknown
  const validated = LlmOutputSchema.safeParse(parsed)

  if (!validated.success) {
    log.warn('LLM output failed validation', { issues: validated.error.issues })

    return (typeof parsed === 'object' && parsed !== null ? parsed : {}) as LlmOutput
  }

  return validated.data
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req.headers)
  if (!await _ipRl.check(ip)) {
    return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 })
  }

  let ctx: ReturnType<typeof getRequestContext>
  try { ctx = getRequestContext(req) } catch {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  if (!await _tenantRl.check(ctx.tenantId)) {
    return NextResponse.json({ error: 'Quota tenant dépassé' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const input = InputSchema.safeParse(body)
  if (!input.success) {
    return NextResponse.json({ error: input.error.format() }, { status: 400 })
  }

  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
  try {
    const health = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    })
    if (!health.ok) throw new Error('Ollama not ready')
  } catch {
    return NextResponse.json(
      { error: 'Service LLM local (Ollama) indisponible. Vérifiez que le conteneur Ollama est démarré.', code: 'OLLAMA_UNAVAILABLE' },
      { status: 503 },
    )
  }

  try {
    const result = await callOllama(input.data.text)
    log.info('Mission parsed', { type: result.type, hasAddress: Boolean(result.address) })
    return NextResponse.json({ mission: result })
  } catch (err) {
    log.error('LLM parse failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json(
      { error: 'Erreur lors du parsing. Réessayez ou saisissez manuellement.' },
      { status: 500 },
    )
  }
}
