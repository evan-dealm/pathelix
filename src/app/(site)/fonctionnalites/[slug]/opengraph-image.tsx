import { contentParams, findPage } from '@/lib/site/contentRoute'
import { contentOgImage, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/site/og'

export const alt = 'Pathélix'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export function generateStaticParams() {
  return contentParams('fonctionnalite')
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const page = findPage('fonctionnalite', (await params).slug)
  return contentOgImage('Fonctionnalités', page?.name ?? 'Pathélix')
}
