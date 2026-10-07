import { COMPARATIFS } from './comparatifs'
import { FONCTIONNALITES } from './fonctionnalites'
import { GUIDES } from './guides'
import { METIERS } from './metiers'
import type { ContentKind, ContentPage } from './types'

export type { ContentKind, ContentPage, ContentSection, ContentVisual } from './types'
export { GLOSSAIRE } from './glossaire'

interface KindInfo {
  /** URL segment of the collection. */
  base: string
  /** Name of the collection, for breadcrumbs and lists. */
  label: string
  /** Page that lists the collection. */
  hub: string
}

export const KINDS: Record<ContentKind, KindInfo> = {
  metier: { base: '/metiers', label: 'Métiers', hub: '/metiers' },
  fonctionnalite: { base: '/fonctionnalites', label: 'Produit', hub: '/produit' },
  comparatif: { base: '/comparatifs', label: 'Guides', hub: '/guides' },
  guide: { base: '/guides', label: 'Guides', hub: '/guides' },
}

export const CONTENT_PAGES: ContentPage[] = [
  ...METIERS,
  ...FONCTIONNALITES,
  ...COMPARATIFS,
  ...GUIDES,
]

export function pathOf(page: ContentPage): string {
  return `${KINDS[page.kind].base}/${page.slug}`
}

export function pagesOf(kind: ContentKind): ContentPage[] {
  return CONTENT_PAGES.filter(page => page.kind === kind)
}

export function findPage(kind: ContentKind, slug: string): ContentPage | undefined {
  return CONTENT_PAGES.find(page => page.kind === kind && page.slug === slug)
}

/** Title of any internal path a page links to, for « À lire ensuite ». */
const STATIC_TITLES: Record<string, string> = {
  '/produit': 'Le produit, module par module',
  '/metiers': 'Les métiers servis',
  '/securite': 'Sécurité',
  '/tarifs': 'Tarifs',
  '/guides': 'Guides',
  '/glossaire': 'Glossaire',
  '/contact': 'Demander une démo',
}

export function titleOfPath(path: string): string | undefined {
  return STATIC_TITLES[path] ?? CONTENT_PAGES.find(page => pathOf(page) === path)?.name
}
