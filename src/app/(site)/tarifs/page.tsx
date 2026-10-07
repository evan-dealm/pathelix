import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumb } from '@/components/site/Breadcrumb'
import { CtaBand } from '@/components/site/CtaBand'
import { JsonLd } from '@/components/site/JsonLd'

const DESCRIPTION =
  'Pathélix n’affiche pas de grille de prix publique : le tarif est établi selon la taille de l’exploitation et le périmètre utilisé. Ce qui le fait varier, et comment obtenir un chiffrage.'

export const metadata: Metadata = {
  title: 'Tarifs : comment le prix de Pathélix est établi',
  description: DESCRIPTION,
  alternates: { canonical: '/tarifs' },
  openGraph: { url: '/tarifs', title: 'Tarifs de Pathélix', description: DESCRIPTION },
}

const FACTORS: Array<{ term: string; text: string }> = [
  {
    term: 'La taille de l’exploitation',
    text: 'Le nombre de chauffeurs et de véhicules à planifier.',
  },
  {
    term: 'Le périmètre',
    text: 'Planification et terrain seuls, ou toute la chaîne avec devis, factures et portail client.',
  },
  {
    term: 'Les intégrations',
    text: 'Un raccordement à votre ERP, à votre comptabilité ou à vos boîtiers télématiques.',
  },
]

const NEEDED = [
  'Le nombre de chauffeurs et de camions',
  'Vos types de missions : pose, rotation, collecte régulière…',
  'Les outils déjà en place : ERP, facturation, télématique',
  'Ce que vous voulez couvrir en premier',
]

const QUESTIONS = [
  {
    question: 'Pourquoi n’y a-t-il pas de prix affiché ?',
    answer:
      'Parce qu’un prix unique serait faux pour la plupart des exploitations : le périmètre utilisé change beaucoup d’un client à l’autre. Nous préférons chiffrer sur votre cas réel.',
  },
  {
    question: 'Mes données restent-elles récupérables ?',
    answer:
      'Oui. Missions, tournées et documents s’exportent en CSV et Excel, et une sauvegarde complète de vos données est disponible dans les paramètres.',
  },
]

export default function TarifsPage() {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: QUESTIONS.map(q => ({
            '@type': 'Question',
            name: q.question,
            acceptedAnswer: { '@type': 'Answer', text: q.answer },
          })),
        }}
      />
      <header className="shell pb-12 pt-28 sm:pt-32 lg:pb-16 lg:pt-36">
        <Breadcrumb trail={[{ href: '/tarifs', label: 'Tarifs' }]} />
        <h1 className="t-display enter-1 mt-8 max-w-[16ch] !text-[clamp(2.125rem,1.3rem+3.6vw,4rem)]">
          Un tarif établi sur votre exploitation.
        </h1>
        <p className="t-lead enter-2 mt-7 max-w-[44rem] text-carbon">
          Pathélix n’affiche pas de grille de prix publique. Le tarif est un abonnement, établi
          selon la taille de votre exploitation et ce que vous utilisez. Nous vous le communiquons
          après une démonstration, une fois le périmètre défini avec vous.
        </p>
        <div className="enter-3 mt-9">
          <Link href="/contact" className="btn btn-primary">
            Demander une démo
          </Link>
        </div>
      </header>

      <div className="shell pb-8">
        <section className="grid gap-5 border-t border-ink/15 py-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-14">
          <h2 className="text-[1.5rem] font-semibold leading-[1.18] tracking-[-0.028em]">
            Ce qui fait varier le prix
          </h2>
          <dl className="max-w-[46rem] border-t border-ink/15">
            {FACTORS.map(factor => (
              <div key={factor.term} className="border-b border-ink/15 py-4">
                <dt className="text-[1.0625rem] font-semibold tracking-[-0.015em]">
                  {factor.term}
                </dt>
                <dd className="t-body mt-1 text-graphite">{factor.text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="grid gap-5 border-t border-ink/15 py-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-14">
          <h2 className="text-[1.5rem] font-semibold leading-[1.18] tracking-[-0.028em]">
            Ce qu’il nous faut pour chiffrer
          </h2>
          <ul className="max-w-[46rem] border-t border-ink/15">
            {NEEDED.map(item => (
              <li key={item} className="t-body border-b border-ink/15 py-3">
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-5 border-t border-ink py-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-14">
          <h2 className="text-[1.5rem] font-semibold leading-[1.18] tracking-[-0.028em]">
            Questions fréquentes
          </h2>
          <div className="max-w-[46rem] border-t border-ink/15">
            {QUESTIONS.map(entry => (
              <details key={entry.question} className="faq border-b border-ink/15">
                <summary className="flex items-start justify-between gap-6 py-4">
                  <h3 className="t-h3 !text-[1.0625rem]">{entry.question}</h3>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    className="faq-mark mt-1.5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.25"
                  >
                    <path d="M8 1.5v13M1.5 8h13" />
                  </svg>
                </summary>
                <p className="t-body pb-5 text-graphite">{entry.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
      <CtaBand />
    </>
  )
}
