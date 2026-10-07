import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('env')

const ServerEnvSchema = z.object({

  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis (ex: postgresql://user:pass@host/db)'),

  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET doit faire au moins 32 caractères'),

  NODE_ENV:           z.enum(['development', 'production', 'test']).default('development'),
  REDIS_URL:          z.string().optional(),
  FORCE_HTTPS:        z.enum(['true', 'false']).optional(),
  METRICS_TOKEN:      z.string().optional(),
  AI_CALLBACK_SECRET: z.string().optional(),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
  OLLAMA_URL:        z.string().optional(),
  AI_ENGINE_URL:      z.string().optional(),
  SENTRY_DSN:         z.string().optional(),
  USE_MOCK_DATA:               z.string().optional(),
  TRACKDECHETS_API_URL:        z.string().optional(),
  TRACKDECHETS_HALT_LIFTED:    z.string().optional(),
})

export type ServerEnv = z.infer<typeof ServerEnvSchema>

/** Values copied from .env.example (« change-me… », « changeme… ») are not secrets. */
const PLACEHOLDER_RE = /change[-_]?me/i

export function validateEnv(): ServerEnv {
  const result = ServerEnvSchema.safeParse(process.env)

  if (!result.success) {
    const lines = result.error.issues
      .map(issue => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    log.error('Variables d\'environnement manquantes ou invalides', { issues: lines })
    process.exit(1)
  }

  const env = result.data

  if (env.NODE_ENV === 'production') {
    // Same convention as everywhere else in the codebase: mock is ON unless USE_MOCK_DATA is
    // literally 'false'. A production deploy running against the in-memory mock stores instead
    // of the real database is never intentional — fail loudly at startup instead of silently
    // serving fake data.
    if (env.USE_MOCK_DATA !== 'false') {
      log.error('USE_MOCK_DATA actif en production — arrêt du démarrage. Définir USE_MOCK_DATA=false explicitement.')
      process.exit(1)
    }

    // The value shipped in .env.example is long enough to pass the length check: a deployment
    // that copied the example unchanged would sign sessions with a secret anyone can read in the
    // repository, i.e. forgeable admin sessions for every organisation.
    if (PLACEHOLDER_RE.test(env.SESSION_SECRET)) {
      log.error('SESSION_SECRET est la valeur d\'exemple — arrêt du démarrage. Générer un secret : openssl rand -base64 48')
      process.exit(1)
    }

    // Present but malformed: every integration secret would fail to encrypt/decrypt at the first
    // use, long after the deployment looked healthy.
    if (env.INTEGRATION_ENCRYPTION_KEY && !/^[0-9a-f]{64}$/i.test(env.INTEGRATION_ENCRYPTION_KEY)) {
      log.error('INTEGRATION_ENCRYPTION_KEY invalide (64 caractères hexadécimaux attendus) — arrêt du démarrage. Générer : openssl rand -hex 32')
      process.exit(1)
    }

    const warnings: string[] = []

    if (!env.INTEGRATION_ENCRYPTION_KEY) {
      warnings.push('INTEGRATION_ENCRYPTION_KEY non défini — les intégrations (webhooks, télématique, ERP) ne pourront pas être enregistrées')
    }

    if (!env.METRICS_TOKEN) {
      warnings.push('METRICS_TOKEN non défini — /api/metrics n\'est accessible qu\'avec une session ; le scraping Prometheus est impossible')
    }

    if (env.AI_CALLBACK_SECRET && PLACEHOLDER_RE.test(env.AI_CALLBACK_SECRET)) {
      warnings.push('AI_CALLBACK_SECRET est la valeur d\'exemple — remplacez-la par un secret aléatoire (min 32 chars)')
    }
    if (env.AI_ENGINE_URL && !env.AI_CALLBACK_SECRET) {
      warnings.push('AI_ENGINE_URL défini mais AI_CALLBACK_SECRET absent — les callbacks AI ne seront pas authentifiés')
    }

    if (warnings.length > 0) {
      log.warn('Avertissements de configuration en production', { warnings })
    }
  }

  return env
}
