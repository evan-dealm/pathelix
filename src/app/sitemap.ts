import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site/config'

/** Public website pages only — the application is not meant to be indexed (see robots.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: Array<{ path: string; priority: number }> = [
    { path: '/', priority: 1 },
    { path: '/produit', priority: 0.9 },
    { path: '/metiers', priority: 0.8 },
    { path: '/securite', priority: 0.6 },
    { path: '/contact', priority: 0.8 },
    { path: '/mentions-legales', priority: 0.2 },
    { path: '/confidentialite', priority: 0.2 },
  ]
  return pages.map(page => ({
    url: `${SITE_URL}${page.path === '/' ? '' : page.path}`,
    changeFrequency: 'monthly',
    priority: page.priority,
  }))
}
