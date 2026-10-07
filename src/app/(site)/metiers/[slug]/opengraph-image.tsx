import { contentParams, findPage } from '@/lib/site/contentRoute'
import { contentOgImage, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/site/og'

export const alt = 'Pathélix'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export function generateStaticParams() {
  return contentParams('metier')
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const page = findPage('metier', (await params).slug)
  return contentOgImage('Métiers', page?.name ?? 'Pathélix')
}
