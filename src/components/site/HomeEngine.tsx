import tournees from '@/assets/site/tournees.png'
import optimisationPoster from '@/assets/site/clip-optimisation-poster.png'
import imprevuPoster from '@/assets/site/clip-imprevu-poster.jpg'
import terrainPoster from '@/assets/site/clip-terrain-poster.png'
import { AutoClip } from './AutoClip'
import { Capture } from './Capture'

const CONSTRAINTS: Array<{ term: string; text: string }> = [
  { term: 'Priorités', text: 'Une urgence est servie avant son échéance.' },
  { term: 'Créneaux clients', text: 'Chaque fenêtre horaire est tenue, ou le retard est signalé.' },
  {
    term: 'Capacité du camion',
    text: 'Camion plein : le passage à l’exutoire s’insère au bon moment.',
  },
  { term: 'Exutoires', text: 'Horaires, jours de fermeture et déchets acceptés.' },
  {
    term: 'Bennes et véhicules',
    text: 'Une benne trop grande pour un camion ne lui est jamais confiée.',
  },
  { term: 'Compétences', text: 'Permis, CACES, ADR : la mission va à un chauffeur habilité.' },
  { term: 'Dépendances', text: 'Une mission qui en attend une autre passe après elle.' },
  {
    term: 'Temps de conduite',
    text: 'Les pauses du règlement CE 561/2006 entrent dans le calcul.',
  },
  { term: 'Charge utile', text: 'Prise en compte dès que le poids est connu ou estimé.' },
]

/** The major section: what the optimiser actually respects, shown with the film's own sequence. */
export function Optimisation() {
  return (
    <section
      className="on-dark bg-ink pb-0 pt-[clamp(4.5rem,3rem+7vw,9.5rem)] text-paper"
      aria-labelledby="optimisation"
    >
      <div className="shell-wide">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-16">
          <h2 id="optimisation" className="t-h2 max-w-[17ch]">
            Le trajet le plus court ne fait pas une bonne journée.
          </h2>
          <p className="t-lead max-w-[30rem] text-ash lg:pb-2">
            Pathélix construit les tournées avec les contraintes qui font votre métier, pas
            seulement avec des kilomètres. Le calcul prend quelques secondes ; vous gardez la main
            sur le résultat.
          </p>
        </div>

        <AutoClip
          name="clip-optimisation"
          poster={optimisationPoster}
          sizes="(max-width: 1500px) 100vw, 1380px"
          className="mt-14 lg:mt-20"
          description="Extrait du film Pathélix : les coordonnées des missions deviennent des points sur une carte, chaque mission affiche ses contraintes, puis l’optimisation relie les points en six tournées de couleurs différentes."
        />

        <dl className="mt-14 grid gap-x-12 sm:grid-cols-2 lg:mt-20 lg:grid-cols-3">
          {CONSTRAINTS.map(c => (
            <div key={c.term} className="border-t border-paper/20 py-5">
              <dt className="text-[1.0625rem] font-semibold tracking-[-0.015em]">{c.term}</dt>
              <dd className="t-small mt-1.5 max-w-[22rem] text-ash">{c.text}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-14 grid gap-10 border-t border-paper/20 pt-10 md:grid-cols-2 lg:mt-20 lg:gap-16">
          <p className="t-lead max-w-[30rem]">
            Une mission reste sans chauffeur ? Pathélix dit pourquoi : capacité, horaire, benne trop
            grande, compétence manquante.
          </p>
          <p className="t-lead max-w-[30rem] text-ash">
            Rien n’est imposé. Vous déplacez une mission à la souris, vous verrouillez une étape,
            vous annulez ou rétablissez un changement.
          </p>
        </div>
      </div>

      {/* The result leaves the dark: the tours view straddles the edge of the section. */}
      <div className="mt-20 bg-[linear-gradient(to_bottom,#000_55%,#F7F7F4_55%)] lg:mt-28">
        <div className="shell-wide">
          <Capture
            src={tournees}
            window="lg:aspect-[1917/936]"
            imageClassName="object-left-top scroll-open"
            sizes="(max-width: 640px) 270vw, (max-width: 1024px) 165vw, (max-width: 1500px) 100vw, 1380px"
            alt="Vue Tournées de Pathélix : à gauche, une tournée par chauffeur avec durée, kilomètres, coût et heure de fin ; à droite, la carte de la région d’Annecy où chaque tournée est tracée dans sa couleur."
            caption="Tournées : une ligne par chauffeur, une couleur par tournée. Interface réelle, données de démonstration."
          />
        </div>
      </div>
    </section>
  )
}

const LIVE: Array<{ term: string; text: string }> = [
  {
    term: 'Une urgence arrive',
    text: 'Elle entre dans le plan avec le reste de la journée, pas à la place.',
  },
  {
    term: 'Ce qui est fait reste fait',
    text: 'Seule la suite est recalculée, avec de nouvelles heures d’arrivée.',
  },
  {
    term: 'Chaque statut remonte',
    text: 'En route, sur place, terminé : l’exploitant le voit sans appeler.',
  },
]

export function Live() {
  return (
    <section className="band bg-mist" aria-labelledby="temps-reel">
      <div className="shell-wide grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <div>
          <h2 id="temps-reel" className="t-h2">
            Le planning n’est pas figé.
          </h2>
          <p className="t-lead mt-6 max-w-[29rem] text-graphite">
            À 10 h, la journée ne ressemble plus au plan de 7 h. Pathélix repart de la position
            réelle des camions et réorganise ce qu’il reste à faire.
          </p>
          <dl className="mt-10 max-w-[29rem] border-t border-ink/15">
            {LIVE.map(item => (
              <div key={item.term} className="border-b border-ink/15 py-4">
                <dt className="text-[0.9375rem] font-semibold tracking-[-0.01em]">{item.term}</dt>
                <dd className="t-small mt-1 text-graphite">{item.text}</dd>
              </div>
            ))}
          </dl>
        </div>

        <AutoClip
          name="clip-imprevu"
          poster={imprevuPoster}
          sizes="(max-width: 1024px) 100vw, 58vw"
          className="!bg-mist !shadow-[0_0_0_1px_rgb(0_0_0/0.1),0_30px_60px_-30px_rgb(0_0_0/0.22)]"
          description="Extrait du film Pathélix : sur la carte des tournées, une mission urgente est créée en cours de journée ; la ré-optimisation part de la position réelle des camions, conserve les arrêts déjà effectués et affiche de nouvelles heures d’arrivée."
        />
      </div>
    </section>
  )
}

const FIELD: string[] = [
  'La tournée du jour dans l’ordre, avec les heures d’arrivée',
  'L’itinéraire ouvert dans l’application de navigation',
  'En route, sur place, terminé : un geste par étape',
  'Photos et signature du client',
  'Poids du ticket de pesée',
  'Scan du QR code de la benne',
  'Signalement d’un incident',
  'Position GPS transmise à l’exploitation',
]

export function Field() {
  return (
    <section className="band on-dark bg-ink text-paper" aria-labelledby="terrain">
      <div className="shell-wide">
        <h2 id="terrain" className="t-h2 max-w-[18ch]">
          Le terrain ne s’arrête pas quand le réseau disparaît.
        </h2>

        <div className="mt-14 grid items-start gap-12 lg:mt-20 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-16">
          <AutoClip
            name="clip-terrain"
            poster={terrainPoster}
            sizes="(max-width: 1024px) 100vw, 64vw"
            description="Extrait du film Pathélix : l’application chauffeur affiche la tournée du jour ; le réseau est perdu, le chauffeur fait signer le client, l’action est conservée sur le téléphone puis envoyée automatiquement au retour du réseau, et l’exploitant la voit en direct."
          />

          <div>
            <p className="t-lead text-ash">
              Le chauffeur a sa tournée sur son téléphone. Sans réseau, chaque action est gardée sur
              l’appareil, puis envoyée au retour de la connexion — une seule fois, sans doublon.
            </p>
            <ul className="mt-8 border-t border-paper/20">
              {FIELD.map(item => (
                <li key={item} className="t-small border-b border-paper/20 py-3 text-paper">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
