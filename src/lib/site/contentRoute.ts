import type { Metadata } from 'next'
import { findPage, pagesOf, pathOf, type ContentKind, type ContentPage } from './content'

/** `generateStaticParams` of a content collection: one static page per entry. */
export function contentParams(kind: ContentKind): Array<{ slug: string }> {
  return pagesOf(kind).map(page => ({ slug: page.slug }))
}

/** Metadata of one content page: own title, description, canonical and Open Graph entry. */
export function contentMetadata(page: ContentPage | undefined): Metadata {
  if (!page) return {}
  const url = pathOf(page)
  const article = page.kind === 'guide' || page.kind === 'comparatif'
  return {
    title: page.metaTitle,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      url,
      title: page.metaTitle,
      description: page.description,
      type: article ? 'article' : 'website',
      ...(article ? { publishedTime: page.published, modifiedTime: page.updated } : {}),
    },
  }
}

export { findPage }
