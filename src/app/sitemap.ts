import type { MetadataRoute } from 'next'
import { FILM, SITE_URL } from '@/lib/site/config'
import { CONTENT_PAGES, pathOf } from '@/lib/site/content'

/** Public website pages only — the application is not meant to be indexed (see robots.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: Array<{ path: string; priority: number }> = [
    { path: '/produit', priority: 0.9 },
    { path: '/metiers', priority: 0.8 },
    { path: '/guides', priority: 0.8 },
    { path: '/tarifs', priority: 0.7 },
    { path: '/glossaire', priority: 0.6 },
    { path: '/securite', priority: 0.6 },
    { path: '/contact', priority: 0.8 },
    { path: '/mentions-legales', priority: 0.2 },
    { path: '/confidentialite', priority: 0.2 },
  ]
  return [
    {
      url: SITE_URL,
      changeFrequency: 'monthly',
      priority: 1,
      // The official film lives on the home page.
      videos: [
        {
          title: 'Pathélix en action',
          description:
            'Une journée d’exploitation avec Pathélix : tableau de bord, missions, optimisation des tournées, urgence en cours de journée, application chauffeur hors ligne, statistiques, intégrations.',
          thumbnail_loc: `${SITE_URL}/site-media/pathelix-film-poster.jpg`,
          content_loc: `${SITE_URL}${FILM.sources.hd}`,
          duration: FILM.durationSeconds,
          publication_date: FILM.uploadDate,
          family_friendly: 'yes',
        },
      ],
    },
    ...pages.map(page => ({
      url: `${SITE_URL}${page.path}`,
      changeFrequency: 'monthly' as const,
      priority: page.priority,
    })),
    ...CONTENT_PAGES.map(page => ({
      url: `${SITE_URL}${pathOf(page)}`,
      lastModified: page.updated,
      changeFrequency: 'monthly' as const,
      priority: page.kind === 'guide' || page.kind === 'comparatif' ? 0.6 : 0.8,
    })),
  ]
}
