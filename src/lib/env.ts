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
  OLLAMA_URL:         z.string().optional(),
  AI_ENGINE_URL:      z.string().optional(),
  SENTRY_DSN:         z.string().optional(),
})

export type ServerEnv = z.infer<typeof ServerEnvSchema>

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
    const warnings: string[] = []

    if (!env.METRICS_TOKEN) {
      warnings.push('METRICS_TOKEN non défini — endpoint /api/metrics accessible sans authentification')
    }

    const AI_CALLBACK_SECRET_PLACEHOLDER = 'changeme_ai_callback_secret_32chars'
    if (env.AI_CALLBACK_SECRET === AI_CALLBACK_SECRET_PLACEHOLDER) {
      warnings.push('AI_CALLBACK_SECRET est la valeur par défaut — remplacez-la par un secret aléatoire (min 32 chars)')
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
