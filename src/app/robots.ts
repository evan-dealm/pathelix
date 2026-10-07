import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site/config'

/** The website is indexable; the application, its API and tokenised customer links are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/superadmin',
          '/driver',
          '/portal',
          '/login',
          '/onboarding',
          '/track/',
          '/c/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
