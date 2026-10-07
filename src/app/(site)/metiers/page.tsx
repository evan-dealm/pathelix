import type { Metadata } from 'next'
import { CtaBand } from '@/components/site/CtaBand'
import { PageIntro } from '@/components/site/PageIntro'

const DESCRIPTION =
  'Location de bennes, collecte, gestion des déchets, recyclage : ce que Pathélix apporte à chaque métier, de la pose de benne à la pesée.'

export const metadata: Metadata = {
  title: 'Métiers : bennes, collecte, déchets, recyclage',
  description: DESCRIPTION,
  alternates: { canonical: '/metiers' },
  openGraph: {
    url: '/metiers',
    title: 'Pathélix pour les métiers de la benne et de la collecte',
    description: DESCRIPTION,
  },
}

const TRADES: Array<{ id: string; name: string; title: string; text: string; points: string[] }> = [
  {
    id: 'bennes',
    name: 'Location de bennes',
    title: 'Pose, rotation, enlèvement : le quotidien, sans tableau blanc.',
    text: 'Une benne posée devra être échangée ou retirée, une benne pleine part à l’exutoire avant le chantier suivant. Pathélix planifie ces enchaînements et garde la trace de chaque benne.',
    points: [
      'Passage à l’exutoire inséré quand le camion est plein',
      'Taille de benne vérifiée avec le camion qui la transporte',
      'Parc de bennes suivi par numéro et QR code',
      'Demandes de rotation saisies par vos clients sur leur portail',
      'Contrats, devis et factures de location',
    ],
  },
  {
    id: 'collecte',
    name: 'Collecte',
    title: 'Des tournées régulières, et de la place pour l’imprévu.',
    text: 'Les passages récurrents se génèrent seuls. Les demandes du jour s’ajoutent, et la tournée se recalcule sans défaire ce qui est déjà fait.',
    points: [
      'Missions récurrentes créées à partir de modèles',
      'Planning sur la semaine',
      'Ré-optimisation en cours de journée',
      'Preuves de passage : photo, signature, heure',
      'Suivi de l’avancement en direct',
    ],
  },
  {
    id: 'dechets',
    name: 'Gestion des déchets',
    title: 'L’exutoire fait partie de la tournée.',
    text: 'Un exutoire a des horaires, des jours de fermeture, des déchets qu’il accepte et d’autres non. Pathélix en tient compte au moment de construire la journée, pas une fois le camion devant la grille.',
    points: [
      'Exutoires avec horaires et déchets acceptés',
      'Type de déchet porté par chaque mission',
      'Poids du ticket de pesée saisi par le chauffeur',
      'Documents rattachés aux clients et aux missions',
      'Trackdéchets : connecteur en cours de validation, non ouvert en production à ce jour',
    ],
  },
  {
    id: 'recyclage',
    name: 'Recyclage',
    title: 'Des matières, des poids, des preuves.',
    text: 'Ce qui entre et ce qui sort se mesure. Les pesées remontent du terrain, se rattachent aux missions et alimentent la facturation et les statistiques.',
    points: [
      'Catalogue de matières',
      'Pesées enregistrées et rattachées aux missions',
      'Photos et signatures comme preuves',
      'Rapport mensuel et bilan CO₂',
      'Export des données en CSV et Excel, API pour vos outils',
    ],
  },
]

export default function MetiersPage() {
  return (
    <>
      <PageIntro
        title="Conçu pour les métiers de la benne et de la collecte."
        lead="Pathélix a été pensé d’abord pour les loueurs de bennes et les collecteurs de déchets. Les règles du métier sont dans le produit, pas dans un paramétrage à inventer."
      />

      <div className="shell pb-8">
        {TRADES.map(trade => (
          <section
            key={trade.id}
            id={trade.id}
            aria-labelledby={`${trade.id}-titre`}
            className="grid gap-8 border-t border-ink py-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,5fr)_minmax(0,4fr)] lg:gap-14 lg:py-20"
          >
            <p className="text-[0.9375rem] font-medium tracking-[-0.01em] text-graphite">
              {trade.name}
            </p>
            <div>
              <h2
                id={`${trade.id}-titre`}
                className="text-[clamp(1.5rem,1.2rem+1.2vw,2.125rem)] font-semibold leading-[1.1] tracking-[-0.03em]"
              >
                {trade.title}
              </h2>
              <p className="t-body mt-5 max-w-[32rem] text-graphite">{trade.text}</p>
            </div>
            <ul className="self-start border-t border-ink/15">
              {trade.points.map(point => (
                <li key={point} className="t-small border-b border-ink/15 py-3">
                  {point}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section aria-labelledby="autres-titre" className="border-t border-ink py-12 lg:py-16">
          <h2 id="autres-titre" className="t-h3">
            Et les autres activités de terrain ?
          </h2>
          <p className="t-body mt-3 max-w-[40rem] text-graphite">
            Le vocabulaire de l’interface s’adapte à d’autres secteurs — livraison, BTP et location,
            déménagement, maintenance, coursier. Ce n’est pas le premier métier de Pathélix :
            parlons-en avant de vous engager.
          </p>
        </section>
      </div>

      <CtaBand />
    </>
  )
}
