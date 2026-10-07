import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site/config'

/** The application, its API and tokenised customer links are never crawled. */
const PRIVATE = [
  '/api/',
  '/admin',
  '/superadmin',
  '/driver',
  '/portal',
  '/login',
  '/onboarding',
  '/track/',
  '/c/',
]

/**
 * Crawlers of AI assistants and AI search, named so the permission is explicit rather than
 * inherited: the website is meant to be read, quoted and recommended by them.
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Bingbot',
  'MistralAI-User',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE },
      { userAgent: AI_CRAWLERS, allow: '/', disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
