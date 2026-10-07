import Link from 'next/link'
import type { StaticImageData } from 'next/image'
import bennes from '@/assets/site/bennes.png'
import dashboard from '@/assets/site/dashboard.png'
import facturation from '@/assets/site/facturation.png'
import missions from '@/assets/site/missions.png'
import portail from '@/assets/site/portail.png'
import statistiques from '@/assets/site/statistiques.png'
import tournees from '@/assets/site/tournees.png'
import optimisationPoster from '@/assets/site/clip-optimisation-poster.png'
import imprevuPoster from '@/assets/site/clip-imprevu-poster.jpg'
import terrainPoster from '@/assets/site/clip-terrain-poster.png'
import { SITE_NAME, SITE_URL } from '@/lib/site/config'
import {
  KINDS,
  pathOf,
  titleOfPath,
  type ContentPage,
  type ContentVisual,
} from '@/lib/site/content'
import { AutoClip } from './AutoClip'
import { Breadcrumb } from './Breadcrumb'
import { Capture } from './Capture'
import { CtaBand } from './CtaBand'
import { JsonLd } from './JsonLd'

const CAPTURES: Partial<
  Record<ContentVisual, { src: StaticImageData; position: string; alt: string; caption: string }>
> = {
  dashboard: {
    src: dashboard,
    position: 'object-left-top',
    alt: 'Tableau de bord Pathélix : indicateurs du jour, pool de missions de la semaine, planning des chauffeurs.',
    caption: 'Tableau de bord. Interface réelle, données de démonstration.',
  },
  planning: {
    src: dashboard,
    position: 'object-left-bottom',
    alt: 'Planning Pathélix en diagramme de Gantt : une ligne par chauffeur, les missions de la journée en blocs de couleur.',
    caption: 'Planning du jour. Interface réelle, données de démonstration.',
  },
  missions: {
    src: missions,
    position: 'object-left-top',
    alt: 'Liste des missions dans Pathélix avec type, date, client, adresse, durée, déchet et taille de benne.',
    caption: 'Missions. Interface réelle, données de démonstration.',
  },
  tournees: {
    src: tournees,
    position: 'object-left-top',
    alt: 'Vue Tournées de Pathélix : une tournée par chauffeur et la carte où chaque tournée est tracée dans sa couleur.',
    caption: 'Tournées. Interface réelle, données de démonstration.',
  },
  statistiques: {
    src: statistiques,
    position: 'object-left-top',
    alt: 'Écran Statistiques de Pathélix : rapport mensuel, bilan CO₂, aperçu sur sept jours.',
    caption: 'Statistiques. Interface réelle, données de démonstration.',
  },
  bennes: {
    src: bennes,
    position: 'object-left-top',
    alt: 'Parc de bennes dans Pathélix : disponibilité par type de benne, nombre de bennes chez les clients et depuis combien de jours, puis la liste avec le statut et l’emplacement de chaque benne.',
    caption: 'Parc de bennes. Interface réelle, données de démonstration.',
  },
  facturation: {
    src: facturation,
    position: 'object-left-top',
    alt: 'Facturation dans Pathélix : montant à encaisser, puis la liste des factures et avoirs avec leur statut — brouillon, émise, payée en partie, payée —, l’échéance et le reste dû.',
    caption: 'Factures. Interface réelle, données de démonstration.',
  },
  portail: {
    src: portail,
    position: 'object-top',
    alt: 'Espace client Pathélix : les bennes du client sur ses sites, avec pour chacune les boutons « Demander une rotation » et « Faire retirer », puis ses prochaines interventions.',
    caption: 'Espace client, vu par votre client. Interface réelle, données de démonstration.',
  },
}

const CLIPS: Partial<
  Record<ContentVisual, { name: string; poster: StaticImageData; description: string }>
> = {
  'clip-optimisation': {
    name: 'clip-optimisation',
    poster: optimisationPoster,
    description:
      'Extrait du film Pathélix : les missions deviennent des points sur une carte, chacune affiche ses contraintes, puis l’optimisation les relie en six tournées.',
  },
  'clip-imprevu': {
    name: 'clip-imprevu',
    poster: imprevuPoster,
    description:
      'Extrait du film Pathélix : une mission urgente arrive en cours de journée et les tournées sont recalculées depuis la position des camions.',
  },
  'clip-terrain': {
    name: 'clip-terrain',
    poster: terrainPoster,
    description:
      'Extrait du film Pathélix : l’application chauffeur perd le réseau, le client signe, l’action est conservée puis envoyée au retour du réseau.',
  },
}

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' })

/** One long-form page of the website, with its breadcrumb, structured data and next reads. */
export function ContentArticle({ page }: { page: ContentPage }) {
  const kind = KINDS[page.kind]
  const url = `${SITE_URL}${pathOf(page)}`
  const capture = page.visual ? CAPTURES[page.visual] : undefined
  const clip = page.visual ? CLIPS[page.visual] : undefined
  const dated = page.kind === 'guide' || page.kind === 'comparatif'

  const structured: Array<Record<string, unknown>> = [
    {
      '@context': 'https://schema.org',
      '@type': dated ? 'Article' : 'WebPage',
      ...(dated ? { headline: page.title } : { name: page.title }),
      description: page.description,
      url,
      mainEntityOfPage: url,
      inLanguage: 'fr',
      datePublished: page.published,
      dateModified: page.updated,
      author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_URL,
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png` },
      },
    },
  ]
  if (page.questions?.length) {
    structured.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.questions.map(q => ({
        '@type': 'Question',
        name: q.question,
        acceptedAnswer: { '@type': 'Answer', text: q.answer },
      })),
    })
  }

  return (
    <>
      <JsonLd data={structured} />
      <article>
        <header className="shell pb-12 pt-28 sm:pt-32 lg:pb-16 lg:pt-36">
          <Breadcrumb
            trail={[
              { href: kind.hub, label: kind.label },
              { href: pathOf(page), label: page.name },
            ]}
          />
          <h1 className="t-display enter-1 mt-8 max-w-[20ch] !text-[clamp(2.125rem,1.3rem+3.6vw,4rem)]">
            {page.title}
          </h1>
          <p className="t-lead enter-2 mt-7 max-w-[46rem] text-carbon">{page.answer}</p>
          {dated && (
            <p className="t-small enter-2 mt-5 text-graphite">
              Mis à jour le{' '}
              <time dateTime={page.updated}>{DATE_FORMAT.format(new Date(page.updated))}</time>
            </p>
          )}
        </header>

        {capture && (
          <div className="shell pb-6">
            <Capture
              src={capture.src}
              alt={capture.alt}
              caption={capture.caption}
              priority
              window="lg:aspect-[1915/860]"
              imageClassName={capture.position}
              sizes="(max-width: 640px) 270vw, (max-width: 1024px) 165vw, (max-width: 1500px) 100vw, 1380px"
            />
          </div>
        )}
        {clip && (
          <div className="shell pb-6">
            <AutoClip
              name={clip.name}
              poster={clip.poster}
              description={clip.description}
              sizes="(max-width: 1500px) 100vw, 1380px"
            />
            <p className="t-small mt-3 text-graphite">Extrait du film Pathélix.</p>
          </div>
        )}

        <div className="shell pb-8">
          {page.sections.map(section => (
            <section
              key={section.heading}
              className="grid gap-5 border-t border-ink/15 py-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-14"
            >
              <h2 className="text-[1.5rem] font-semibold leading-[1.18] tracking-[-0.028em]">
                {section.heading}
              </h2>
              <div className="min-w-0 max-w-[46rem]">
                {section.paragraphs?.map(paragraph => (
                  <p key={paragraph} className="t-body text-carbon [&+p]:mt-4">
                    {paragraph}
                  </p>
                ))}
                {section.points && (
                  <ul className={`border-t border-ink/15 ${section.paragraphs ? 'mt-6' : ''}`}>
                    {section.points.map(point => (
                      <li key={point} className="t-body border-b border-ink/15 py-3">
                        {point}
                      </li>
                    ))}
                  </ul>
                )}
                {section.table && (
                  <div className={`overflow-x-auto ${section.paragraphs ? 'mt-6' : ''}`}>
                    <table className="w-full min-w-[30rem] border-collapse text-left">
                      <caption className="sr-only">{section.table.caption}</caption>
                      <thead>
                        <tr>
                          {section.table.head.map(cell => (
                            <th
                              key={cell}
                              scope="col"
                              className="border-b border-ink py-3 pr-6 text-[0.875rem] font-semibold"
                            >
                              {cell}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.table.rows.map(row => (
                          <tr key={row[0]}>
                            {row.map((cell, index) =>
                              index === 0 ? (
                                <th
                                  key={cell}
                                  scope="row"
                                  className="border-b border-ink/15 py-3 pr-6 align-top text-[0.9375rem] font-semibold"
                                >
                                  {cell}
                                </th>
                              ) : (
                                <td
                                  key={`${index}-${cell}`}
                                  className="border-b border-ink/15 py-3 pr-6 align-top text-[0.9375rem] leading-[1.5] text-carbon"
                                >
                                  {cell}
                                </td>
                              ),
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          ))}

          {page.questions && page.questions.length > 0 && (
            <section className="grid gap-5 border-t border-ink py-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-14">
              <h2 className="text-[1.5rem] font-semibold leading-[1.18] tracking-[-0.028em]">
                Questions fréquentes
              </h2>
              <div className="max-w-[46rem] border-t border-ink/15">
                {page.questions.map(entry => (
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
          )}

          <nav
            aria-labelledby="a-lire"
            className="grid gap-5 border-t border-ink py-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-14"
          >
            <h2
              id="a-lire"
              className="text-[1.5rem] font-semibold leading-[1.18] tracking-[-0.028em]"
            >
              À lire ensuite
            </h2>
            <ul className="max-w-[46rem] border-t border-ink/15">
              {page.related.map(path => (
                <li key={path} className="border-b border-ink/15">
                  <Link
                    href={path}
                    className="group flex items-center justify-between gap-6 py-4 text-[1.0625rem] font-medium tracking-[-0.015em]"
                  >
                    <span className="link">{titleOfPath(path) ?? path}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </article>
      <CtaBand />
    </>
  )
}
