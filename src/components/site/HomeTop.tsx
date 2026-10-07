import Link from 'next/link'
import dashboard from '@/assets/site/dashboard.png'
import missions from '@/assets/site/missions.png'
import { Capture } from './Capture'
import { Orbit } from './Orbit'

/** What the product is, for whom, and the product itself — before any scrolling is needed. */
export function Hero() {
  return (
    <section className="relative overflow-hidden pt-24 sm:pt-32 lg:pt-36">
      <Orbit
        animated
        className="pointer-events-none absolute -right-[30rem] -top-20 w-[46rem] max-w-none text-ink/[0.13] sm:-right-[20rem] sm:w-[60rem] lg:-right-[10rem] lg:top-0 lg:w-[80rem]"
      />
      <div className="shell-wide relative z-10">
        <h1 className="t-display enter-1 max-w-[20ch]">
          La journée d’exploitation, sur un seul écran.
        </h1>
        <p className="t-lead enter-2 mt-7 max-w-[46rem] text-graphite">
          Pathélix est la plateforme d’exploitation des loueurs de bennes et des entreprises de
          collecte, de déchets et de recyclage. Missions, tournées, chauffeurs, parc de bennes et
          facturation : toute l’équipe travaille sur le même plan.
        </p>
        <div className="enter-3 mt-9 flex flex-wrap gap-3">
          <Link href="/contact" className="btn btn-primary">
            Demander une démo
          </Link>
          <a href="#film" className="btn btn-quiet">
            <svg width="10" height="11" viewBox="0 0 22 24" aria-hidden="true" fill="currentColor">
              <path d="M1 1.2 21 12 1 22.8Z" />
            </svg>
            Voir Pathélix en action
          </a>
        </div>
      </div>

      <div className="relative mt-12 sm:mt-14 lg:mt-16">
        <div className="shell-wide enter-product relative">
          <Capture
            src={dashboard}
            priority
            className="[mask-image:linear-gradient(to_bottom,#000_78%,transparent)]"
            window="lg:aspect-[1915/900]"
            sizes="(max-width: 640px) 270vw, (max-width: 1024px) 165vw, (max-width: 1500px) 100vw, 1380px"
            caption="Tableau de bord Pathélix. Interface réelle, données de démonstration."
            alt="Tableau de bord Pathélix : indicateurs du jour, missions à planifier par jour de la semaine, et planning des chauffeurs heure par heure."
          />
        </div>
      </div>
    </section>
  )
}

const DAY: Array<{ time: string; event: string; detail: string }> = [
  {
    time: '06:40',
    event: 'Un chauffeur est absent.',
    detail: 'Ses sept missions doivent trouver preneur avant le départ.',
  },
  {
    time: '07:55',
    event: 'Un chantier veut son échange avant 10 h.',
    detail: 'La demande arrive par téléphone, les camions sont déjà partis.',
  },
  {
    time: '09:10',
    event: 'Le camion est plein.',
    detail: 'Passage à l’exutoire obligatoire avant la pose suivante.',
  },
  {
    time: '10:30',
    event: 'Personne sur le site.',
    detail: 'La benne ne peut pas être posée. Le client rappellera.',
  },
  { time: '11:15', event: 'L’exutoire ferme à midi.', detail: 'Et il ne prend pas le plâtre.' },
  {
    time: '14:00',
    event: 'Où est la 15 m³ ?',
    detail: 'Trois clients l’attendent, personne ne sait où elle a été posée.',
  },
]

/** The problem before the product: an ordinary day, told as the route it is. */
export function Problem() {
  return (
    <section className="band" aria-labelledby="probleme">
      <div className="shell grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-24">
        <div className="self-start lg:sticky lg:top-28">
          <h2 id="probleme" className="t-h2">
            Une journée de bennes ne se passe jamais comme prévu.
          </h2>
          <p className="t-lead mt-6 max-w-[27rem] text-graphite">
            Le plan du matin tient rarement jusqu’à midi. Ce qui coûte, c’est le temps passé à le
            refaire au téléphone et sur un tableau.
          </p>
        </div>

        <ol className="relative ml-1 border-l border-ink/20">
          {DAY.map(step => (
            <li key={step.time} className="relative pb-9 pl-7 last:pb-0 sm:pl-10">
              <span
                aria-hidden="true"
                className="absolute -left-[4.5px] top-[0.55rem] h-2 w-2 rounded-full bg-ink"
              />
              <div className="grid gap-x-8 gap-y-1 sm:grid-cols-[3.25rem_1fr]">
                <span className="t-num pt-[0.2rem] text-[0.9375rem] text-graphite">
                  {step.time}
                </span>
                <p>
                  <strong className="t-h3 block">{step.event}</strong>
                  <span className="t-body mt-1 block text-graphite">{step.detail}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="shell mt-20 lg:mt-28">
        <p className="t-h2 max-w-[20ch] border-t border-ink pt-8">
          Pathélix remet tout cela dans le même plan.
        </p>
      </div>
    </section>
  )
}

const MISSION_FACTS: Array<{ term: string; text: string }> = [
  {
    term: 'Saisie, import ou ERP',
    text: 'Une mission se crée à la main, depuis un fichier CSV, ou arrive de votre logiciel de gestion.',
  },
  { term: 'Récurrences', text: 'Les passages réguliers se génèrent seuls à partir d’un modèle.' },
  {
    term: 'Tableau ou Kanban',
    text: 'Filtres par date, type, priorité, chauffeur et statut ; actions groupées.',
  },
]

export function Missions() {
  return (
    <section className="band overflow-hidden bg-mist" aria-labelledby="missions">
      <div className="shell-wide grid items-start gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-16">
        <div className="lg:pt-6">
          <h2 id="missions" className="t-h2">
            Une mission dit tout ce qu’il faut pour l’exécuter.
          </h2>
          <p className="t-lead mt-6 max-w-[30rem] text-graphite">
            Type d’intervention, client, adresse géolocalisée, créneau, priorité, déchet, taille de
            benne, durée sur place. Pose, enlèvement, rotation ou chargement immédiat : chaque
            demande rejoint le même pool, prête à être planifiée.
          </p>
          <dl className="mt-10 max-w-[30rem] border-t border-ink/15">
            {MISSION_FACTS.map(fact => (
              <div key={fact.term} className="border-b border-ink/15 py-4">
                <dt className="text-[0.9375rem] font-semibold tracking-[-0.01em]">{fact.term}</dt>
                <dd className="t-small mt-1 text-graphite">{fact.text}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="lg:-mr-[22vw]">
          <Capture
            src={missions}
            window="lg:aspect-[16/9]"
            imageClassName="object-left-top scroll-settle"
            sizes="(max-width: 640px) 270vw, (max-width: 1024px) 165vw, 1700px"
            alt="Liste des missions dans Pathélix : priorité, type (pose, rotation, enlèvement, chargement immédiat, déplacement), date, client, adresse, coordonnées GPS, durée, chauffeur assigné, déchet et taille de benne."
            caption="Missions. Interface réelle, données de démonstration."
          />
        </div>
      </div>
    </section>
  )
}
