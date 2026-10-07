import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ContentArticle } from '@/components/site/ContentArticle'
import { contentMetadata, contentParams, findPage } from '@/lib/site/contentRoute'

export const dynamicParams = false

export function generateStaticParams() {
  return contentParams('guide')
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  return contentMetadata(findPage('guide', (await params).slug))
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const page = findPage('guide', (await params).slug)
  if (!page) notFound()
  return <ContentArticle page={page} />
}
