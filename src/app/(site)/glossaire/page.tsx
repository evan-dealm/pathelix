import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumb } from '@/components/site/Breadcrumb'
import { CtaBand } from '@/components/site/CtaBand'
import { JsonLd } from '@/components/site/JsonLd'
import { SITE_URL } from '@/lib/site/config'
import { GLOSSAIRE, titleOfPath } from '@/lib/site/content'

const DESCRIPTION =
  'Le vocabulaire des bennes, de la collecte et du recyclage expliqué simplement : exutoire, rotation, ampliroll, DIB, BSD, PTAC, charge utile, chronotachygraphe…'

export const metadata: Metadata = {
  title: 'Glossaire des bennes, de la collecte et du recyclage',
  description: DESCRIPTION,
  alternates: { canonical: '/glossaire' },
  openGraph: {
    url: '/glossaire',
    title: 'Glossaire des bennes et de la collecte',
    description: DESCRIPTION,
  },
}

export default function GlossairePage() {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'DefinedTermSet',
          name: 'Glossaire des bennes, de la collecte et du recyclage',
          url: `${SITE_URL}/glossaire`,
          inLanguage: 'fr',
          hasDefinedTerm: GLOSSAIRE.map(entry => ({
            '@type': 'DefinedTerm',
            name: entry.term,
            description: entry.definition,
            url: `${SITE_URL}/glossaire#${entry.id}`,
          })),
        }}
      />
      <header className="shell pb-12 pt-28 sm:pt-32 lg:pb-16 lg:pt-36">
        <Breadcrumb trail={[{ href: '/glossaire', label: 'Glossaire' }]} />
        <h1 className="t-display enter-1 mt-8 max-w-[18ch] !text-[clamp(2.125rem,1.3rem+3.6vw,4rem)]">
          Le vocabulaire des bennes et de la collecte.
        </h1>
        <p className="t-lead enter-2 mt-7 max-w-[44rem] text-carbon">
          Vingt termes du métier, définis en une ou deux phrases.
        </p>
      </header>
      <div className="shell pb-16 lg:pb-24">
        <dl className="border-t border-ink">
          {GLOSSAIRE.map(entry => (
            <div
              key={entry.id}
              id={entry.id}
              className="grid gap-2 border-b border-ink/15 py-7 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16"
            >
              <dt className="text-[1.25rem] font-semibold leading-[1.25] tracking-[-0.02em]">
                {entry.term}
              </dt>
              <dd className="max-w-[44rem]">
                <p className="t-body text-carbon">{entry.definition}</p>
                {entry.more && (
                  <p className="t-small mt-2">
                    <Link href={entry.more} className="link">
                      {titleOfPath(entry.more) ?? 'En savoir plus'}
                    </Link>
                  </p>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <CtaBand />
    </>
  )
}
