import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumb } from '@/components/site/Breadcrumb'
import { CtaBand } from '@/components/site/CtaBand'
import { pagesOf, pathOf, type ContentPage } from '@/lib/site/content'

const DESCRIPTION =
  'Guides pratiques pour les exploitants de bennes et de collecte : rotations, coût d’une tournée, temps de conduite, kilomètres à vide. Et des comparatifs honnêtes pour choisir un logiciel.'

export const metadata: Metadata = {
  title: 'Guides et comparatifs pour l’exploitation de bennes et de collecte',
  description: DESCRIPTION,
  alternates: { canonical: '/guides' },
  openGraph: { url: '/guides', title: 'Guides et comparatifs Pathélix', description: DESCRIPTION },
}

function List({ id, title, pages }: { id: string; title: string; pages: ContentPage[] }) {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-6 border-t border-ink py-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-16"
    >
      <h2 id={id} className="text-[1.5rem] font-semibold leading-[1.18] tracking-[-0.028em]">
        {title}
      </h2>
      <ul className="border-t border-ink/15">
        {pages.map(page => (
          <li key={page.slug} className="border-b border-ink/15 py-6">
            <h3 className="text-[1.25rem] font-semibold leading-[1.25] tracking-[-0.02em]">
              <Link href={pathOf(page)} className="link">
                {page.name}
              </Link>
            </h3>
            <p className="t-body mt-2 max-w-[42rem] text-graphite">{page.description}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function GuidesPage() {
  return (
    <>
      <header className="shell pb-12 pt-28 sm:pt-32 lg:pb-16 lg:pt-36">
        <Breadcrumb trail={[{ href: '/guides', label: 'Guides' }]} />
        <h1 className="t-display enter-1 mt-8 max-w-[18ch] !text-[clamp(2.125rem,1.3rem+3.6vw,4rem)]">
          Guides pour les exploitants de bennes et de collecte.
        </h1>
        <p className="t-lead enter-2 mt-7 max-w-[44rem] text-carbon">
          Des méthodes qui servent avec ou sans logiciel, et des comparatifs qui disent aussi quand
          Pathélix n’est pas la bonne réponse.
        </p>
      </header>
      <div className="shell pb-8">
        <List id="guides-pratiques" title="Guides pratiques" pages={pagesOf('guide')} />
        <List id="comparatifs" title="Comparatifs" pages={pagesOf('comparatif')} />
        <section className="border-t border-ink py-12 lg:py-16">
          <h2 className="t-h3">Un mot du métier vous échappe ?</h2>
          <p className="t-body mt-3 max-w-[40rem] text-graphite">
            Exutoire, rotation, DIB, PTAC :{' '}
            <Link href="/glossaire" className="link text-ink">
              le glossaire
            </Link>{' '}
            les définit simplement.
          </p>
        </section>
      </div>
      <CtaBand />
    </>
  )
}
