import type { Metadata } from 'next'
import { CONTACT_EMAIL, FILM, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site/config'
import { FAQ } from '@/lib/site/faq'
import { CtaBand } from '@/components/site/CtaBand'
import { Faq } from '@/components/site/Faq'
import { Beyond, Connect, FilmSection, Insight } from '@/components/site/HomeBusiness'
import { Field, Live, Optimisation } from '@/components/site/HomeEngine'
import { Hero, Missions, Problem } from '@/components/site/HomeTop'
import { JsonLd } from '@/components/site/JsonLd'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: { url: '/' },
}

const STRUCTURED_DATA = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icon-512.png`,
    email: CONTACT_EMAIL,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    inLanguage: 'fr',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: 'Pathélix en action',
    description:
      'Une journée d’exploitation avec Pathélix : tableau de bord, missions, optimisation des tournées, urgence en cours de journée, application chauffeur hors ligne, statistiques et intégrations.',
    thumbnailUrl: `${SITE_URL}/site-media/pathelix-film-poster.jpg`,
    uploadDate: FILM.uploadDate,
    duration: FILM.isoDuration,
    contentUrl: `${SITE_URL}${FILM.sources.hd}`,
    inLanguage: 'fr',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(entry => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  },
]

/**
 * Public home page. Static: a signed-in user is sent to their workspace by the middleware
 * (src/middleware.ts), so this page never reads a cookie and can be served from cache.
 */
export default function Home() {
  return (
    <>
      <JsonLd data={STRUCTURED_DATA} />
      <Hero />
      <Problem />
      <Missions />
      <Optimisation />
      <Live />
      <Field />
      <Beyond />
      <Insight />
      <Connect />
      <FilmSection />
      <Faq />
      <CtaBand />
    </>
  )
}
