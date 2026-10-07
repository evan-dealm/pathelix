import Link from 'next/link'
import statistiques from '@/assets/site/statistiques.png'
import { Capture } from './Capture'
import { Film } from './Film'
import { IntegrationOrbit } from './IntegrationOrbit'

const CHAIN: Array<{ step: string; text: string }> = [
  { step: 'Devis', text: 'Chiffré depuis vos grilles tarifaires, envoyé en PDF.' },
  { step: 'Commande', text: 'Le devis accepté devient commande.' },
  { step: 'Mission', text: 'La commande crée ses missions.' },
  { step: 'Exécution', text: 'Preuves, pesées et horaires viennent du terrain.' },
  { step: 'Facture', text: 'Ce qui a été réalisé devient ligne de facture.' },
  { step: 'Paiement', text: 'Règlements rapprochés, soldes à jour.' },
]

/** Bins, the commercial chain, the customer portal: Pathélix beyond route planning. */
export function Beyond() {
  return (
    <section className="band" aria-labelledby="au-dela">
      <div className="shell">
        <h2 id="au-dela" className="t-h2 max-w-[16ch]">
          Plus qu’un planning de tournées.
        </h2>

        <div className="mt-16 grid gap-6 border-t border-ink pt-8 lg:mt-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <h3 className="text-[clamp(1.5rem,1.2rem+1.2vw,2.125rem)] font-semibold leading-[1.1] tracking-[-0.03em]">
            Savoir où sont vos bennes.
          </h3>
          <p className="t-lead max-w-[36rem] text-graphite">
            Chaque benne porte un numéro et un QR code. Disponible, réservée, sur un camion, chez un
            client, pleine, à retirer, en maintenance : son état suit les missions et les scans des
            chauffeurs, et chaque mouvement garde sa trace.
          </p>
        </div>

        <div className="mt-16 border-t border-ink pt-8 lg:mt-24">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
            <h3 className="text-[clamp(1.5rem,1.2rem+1.2vw,2.125rem)] font-semibold leading-[1.1] tracking-[-0.03em]">
              Du devis au paiement, sans ressaisie.
            </h3>
            <p className="t-lead max-w-[36rem] text-graphite">
              Ce qui est vendu, ce qui est planifié et ce qui est facturé sont la même information,
              qui avance d’une étape à l’autre.
            </p>
          </div>

          {/* A route with six stops: horizontal on a desk, vertical on a phone. */}
          <ol className="relative mt-12 grid gap-y-0 lg:mt-16 lg:grid-cols-6 lg:gap-x-6">
            <span
              aria-hidden="true"
              className="absolute bottom-3 left-[3.5px] top-3 w-px bg-ink/25 lg:bottom-auto lg:left-0 lg:right-[calc((100%-7.5rem)/6)] lg:top-[3.5px] lg:h-px lg:w-auto"
            />
            {CHAIN.map(link => (
              <li key={link.step} className="relative pb-7 pl-8 last:pb-0 lg:pb-0 lg:pl-0 lg:pt-8">
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-[0.45rem] h-2 w-2 rounded-full bg-ink lg:top-0"
                />
                <strong className="block text-[1.0625rem] font-semibold tracking-[-0.015em]">
                  {link.step}
                </strong>
                <span className="t-small mt-1.5 block max-w-[20rem] text-graphite">
                  {link.text}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-16 grid gap-6 border-t border-ink pt-8 lg:mt-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <h3 className="text-[clamp(1.5rem,1.2rem+1.2vw,2.125rem)] font-semibold leading-[1.1] tracking-[-0.03em]">
            Vos clients font leurs demandes eux-mêmes.
          </h3>
          <p className="t-lead max-w-[36rem] text-graphite">
            Depuis leur espace, ils demandent une rotation, un enlèvement ou une benne
            supplémentaire, suivent leurs interventions et retrouvent devis, factures et documents.
            Chaque demande passe par votre validation.
          </p>
        </div>
      </div>
    </section>
  )
}

export function Insight() {
  return (
    <section className="band bg-mist" aria-labelledby="pilotage">
      <div className="shell-wide">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:items-end lg:gap-16">
          <h2 id="pilotage" className="t-h2 max-w-[15ch]">
            Ce que le terrain a fait devient lisible.
          </h2>
          <p className="t-lead max-w-[32rem] text-graphite lg:pb-2">
            Missions réalisées, kilomètres, durées, coûts par tournée, performance par chauffeur et
            par secteur. Le rapport mensuel sort en PDF, le bilan CO₂ se calcule à la demande.
          </p>
        </div>
        <div className="mt-14 lg:mt-20">
          <Capture
            src={statistiques}
            window="lg:aspect-[1915/790]"
            imageClassName="object-left-top scroll-settle"
            sizes="(max-width: 640px) 270vw, (max-width: 1024px) 165vw, (max-width: 1500px) 100vw, 1380px"
            alt="Écran Statistiques de Pathélix : rapport mensuel en PDF, bilan CO₂, aperçu sur sept jours des missions, kilomètres, chauffeurs actifs et durée moyenne, puis état d’assignation du jour."
            caption="Statistiques. Interface réelle, données de démonstration."
          />
        </div>
      </div>
    </section>
  )
}

const INTEGRATIONS: Array<{ term: string; text: string }> = [
  {
    term: 'API REST',
    text: 'Des clés aux droits limités par domaine, et une référence publique générée depuis le code.',
  },
  {
    term: 'ERP et logiciels de gestion',
    text: 'Les missions arrivent par webhook signé (connecteur Nessy) ou par fichier.',
  },
  {
    term: 'Facturation et comptabilité',
    text: 'Envoi vers Sage ou SAP en fin de mission, export des écritures comptables.',
  },
  {
    term: 'Télématique',
    text: 'Les positions des boîtiers Geotab, Samsara ou OBD rejoignent celles de l’application chauffeur.',
  },
  { term: 'Notifications', text: 'Slack, Teams, SMS au client, webhooks sortants signés.' },
]

const SECURITY: Array<{ term: string; text: string }> = [
  {
    term: 'Organisations cloisonnées',
    text: 'Chaque requête est limitée aux données de votre organisation, par construction.',
  },
  {
    term: 'Rôles et permissions',
    text: 'Administrateur, exploitant, chauffeur : chaque droit est vérifié côté serveur.',
  },
  {
    term: 'Journal d’audit',
    text: 'Qui a fait quoi, quand, sur quel objet. Vos administrateurs le consultent.',
  },
  {
    term: 'Secrets chiffrés',
    text: 'Les identifiants de vos intégrations sont chiffrés en base (AES-256-GCM).',
  },
]

export function Connect() {
  return (
    <section className="band" aria-labelledby="integrations">
      <div className="shell">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-20">
          <div className="order-2 lg:order-1">
            <IntegrationOrbit />
          </div>
          <div className="order-1 lg:order-2">
            <h2 id="integrations" className="t-h2">
              Pathélix s’intègre à vos outils.
            </h2>
            <dl className="mt-10 border-t border-ink/15">
              {INTEGRATIONS.map(item => (
                <div key={item.term} className="border-b border-ink/15 py-4">
                  <dt className="text-[0.9375rem] font-semibold tracking-[-0.01em]">{item.term}</dt>
                  <dd className="t-small mt-1 text-graphite">{item.text}</dd>
                </div>
              ))}
            </dl>
            <p className="t-small mt-5 text-graphite">
              Trackdéchets : le connecteur est en cours de validation et n’est pas ouvert en
              production à ce jour.{' '}
              <Link href="/api-docs" prefetch={false} className="link text-ink">
                Référence de l’API
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-24 border-t border-ink pt-8 lg:mt-36">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
            <h2 id="securite" className="t-h2 !text-[clamp(1.75rem,1.3rem+1.8vw,2.625rem)]">
              Vos données restent les vôtres.
            </h2>
            <div>
              <dl className="grid gap-x-10 sm:grid-cols-2">
                {SECURITY.map(item => (
                  <div
                    key={item.term}
                    className="border-b border-ink/15 py-4 sm:[&:nth-child(-n+2)]:pt-0"
                  >
                    <dt className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                      {item.term}
                    </dt>
                    <dd className="t-small mt-1 text-graphite">{item.text}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6">
                <Link href="/securite" className="link text-[0.9375rem]">
                  Lire la page Sécurité
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/** The film, as the moment where the page goes dark and the product is seen in motion. */
export function FilmSection() {
  return (
    <section id="film" className="band on-dark bg-ink text-paper" aria-labelledby="film-titre">
      <div className="shell-wide">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-16">
          <h2 id="film-titre" className="t-h2 max-w-[15ch]">
            Une journée d’exploitation, en deux minutes.
          </h2>
          <p className="t-lead max-w-[30rem] text-ash lg:pb-2">
            Du pool de missions aux tournées, de l’urgence de 10 h à la signature sans réseau : le
            film montre Pathélix tel qu’il fonctionne.
          </p>
        </div>
        <div className="mt-14 lg:mt-20">
          <Film />
        </div>
      </div>
    </section>
  )
}
