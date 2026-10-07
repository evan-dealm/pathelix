import type { StaticImageData } from 'next/image'
import dashboard from '@/assets/site/dashboard.png'
import missions from '@/assets/site/missions.png'
import statistiques from '@/assets/site/statistiques.png'
import tournees from '@/assets/site/tournees.png'
import terrainPoster from '@/assets/site/clip-terrain-poster.png'
import { AutoClip } from './AutoClip'
import { Capture } from './Capture'

interface Chapter {
  id: string
  nav: string
  title: string
  lead: string
  points: string[]
  visual?:
    | { kind: 'capture'; src: StaticImageData; alt: string; caption: string; position: string }
    | { kind: 'clip' }
}

/** The product, module by module. Each statement is checked against the application's behaviour. */
const CHAPTERS: Chapter[] = [
  {
    id: 'exploitation',
    nav: 'Exploitation',
    title: 'Le tableau de bord du jour.',
    lead: 'À l’ouverture : missions en attente, chauffeurs planifiés, urgences, distance, carburant estimé, missions sans chauffeur. En dessous, le pool de la semaine et le planning heure par heure.',
    points: [
      'Indicateurs du jour et alertes',
      'Pool de missions par jour, semaine ou mois',
      'Avancement de chaque chauffeur en direct',
      'Recherche globale au clavier',
    ],
    visual: {
      kind: 'capture',
      src: dashboard,
      position: 'object-left-top',
      alt: 'Tableau de bord Pathélix : barre d’avancement des chauffeurs en direct, indicateurs du jour, pool de missions de la semaine.',
      caption: 'Tableau de bord. Interface réelle, données de démonstration.',
    },
  },
  {
    id: 'missions',
    nav: 'Missions',
    title: 'Toutes les demandes au même endroit.',
    lead: 'Pose, enlèvement, rotation, chargement immédiat, déplacement : huit types d’intervention, chacun avec sa priorité, son créneau, son déchet et sa taille de benne.',
    points: [
      'Saisie, import CSV ou JSON, réception depuis un ERP',
      'Modèles pour les missions récurrentes',
      'Vue tableau ou Kanban, filtres et actions groupées',
      'Photos, signature et commentaires rattachés à la mission',
      'Export CSV et Excel',
    ],
    visual: {
      kind: 'capture',
      src: missions,
      position: 'object-left-top',
      alt: 'Liste des missions dans Pathélix avec type, date, client, adresse, coordonnées GPS, durée, déchet et taille de benne.',
      caption: 'Missions. Interface réelle, données de démonstration.',
    },
  },
  {
    id: 'planning',
    nav: 'Planning',
    title: 'La journée et la semaine, chauffeur par chauffeur.',
    lead: 'Le planning se lit comme un diagramme de Gantt : une ligne par chauffeur, un bloc par mission, les trajets entre les deux.',
    points: [
      'Planning du jour et planning de la semaine',
      'Indisponibilités des chauffeurs et des véhicules, jours fériés',
      'Chauffeurs : compétences, dépôt de rattachement',
      'Camions : gabarit, capacité en bennes ou en m³, entretiens, carburant',
      'Exutoires : horaires, jours de fermeture, déchets acceptés',
    ],
    visual: {
      kind: 'capture',
      src: dashboard,
      position: 'object-left-bottom',
      alt: 'Planning Pathélix en diagramme de Gantt : une ligne par chauffeur, les missions de la journée en blocs de couleur selon leur type.',
      caption: 'Planning du jour. Interface réelle, données de démonstration.',
    },
  },
  {
    id: 'optimisation',
    nav: 'Optimisation',
    title: 'Des tournées calculées avec vos contraintes.',
    lead: 'Priorités, créneaux, capacité des camions, exutoires, taille des bennes, compétences, dépendances, temps de conduite, charge utile : le calcul tient compte de tout cela à la fois.',
    points: [
      'Optimisation de la journée en quelques secondes',
      'Ré-optimisation en cours de journée, depuis la position réelle des camions',
      'Missions non affectées expliquées une par une',
      'Glisser-déposer, verrouillage d’une étape, annuler et rétablir',
      'Coûts par tournée : carburant, péages, usure',
      'Feuilles de route en PDF et CSV',
    ],
    visual: {
      kind: 'capture',
      src: tournees,
      position: 'object-left-top',
      alt: 'Vue Tournées de Pathélix : liste des tournées par chauffeur et carte où chaque tournée est tracée dans sa couleur.',
      caption: 'Tournées. Interface réelle, données de démonstration.',
    },
  },
  {
    id: 'terrain',
    nav: 'Terrain',
    title: 'L’application du chauffeur.',
    lead: 'Elle s’ouvre dans le navigateur du téléphone et fonctionne sans réseau. Ce que fait le chauffeur arrive à l’exploitation dès que la connexion revient, sans doublon.',
    points: [
      'Tournée du jour dans l’ordre, avec les heures d’arrivée',
      'Itinéraire ouvert dans l’application de navigation',
      'Statuts, photos, signature du client, commentaire',
      'Poids du ticket de pesée',
      'Scan du QR code de la benne',
      'Contrôle du véhicule et signalement d’incident',
      'Position GPS et notifications',
    ],
    visual: { kind: 'clip' },
  },
  {
    id: 'bennes',
    nav: 'Bennes',
    title: 'Le parc de bennes.',
    lead: 'Chaque benne a un numéro, un type et un QR code à imprimer. Vous savez laquelle est disponible, laquelle est chez un client, laquelle est pleine.',
    points: [
      'État et emplacement de chaque benne',
      'Historique des mouvements : qui, où, pour quelle mission',
      'Carte du parc',
      'Benne rattachée à la mission, confirmée par le scan du chauffeur',
    ],
  },
  {
    id: 'commercial',
    nav: 'Commercial',
    title: 'Devis, commandes, factures.',
    lead: 'Le devis accepté devient commande, la commande crée ses missions, ce qui a été réalisé devient ligne de facture. Personne ne ressaisit.',
    points: [
      'Grilles tarifaires et règles de prix',
      'Devis en PDF, envoyés par e-mail',
      'Commandes et contrats',
      'Factures, avoirs, paiements et soldes',
      'Pesées rattachées à la facturation',
      'Export comptable',
    ],
  },
  {
    id: 'portail',
    nav: 'Portail client',
    title: 'L’espace de vos clients.',
    lead: 'Vos clients demandent une rotation, un enlèvement ou une benne supplémentaire sans téléphoner. Vous validez, la mission est créée.',
    points: [
      'Demandes soumises à votre validation',
      'Suivi des interventions',
      'Devis, factures et documents en consultation',
      'Lien de suivi d’une intervention, sans compte',
    ],
  },
  {
    id: 'pilotage',
    nav: 'Pilotage',
    title: 'Les chiffres de l’activité.',
    lead: 'Ce que le terrain a réellement fait alimente les statistiques, sans tableur à tenir à côté.',
    points: [
      'Missions, kilomètres, durées sur sept jours',
      'Performance par chauffeur et par secteur',
      'Rapport mensuel en PDF',
      'Bilan CO₂',
      'Historique des tournées',
    ],
    visual: {
      kind: 'capture',
      src: statistiques,
      position: 'object-left-top',
      alt: 'Écran Statistiques de Pathélix : rapport mensuel, bilan CO₂, aperçu sur sept jours et état d’assignation du jour.',
      caption: 'Statistiques. Interface réelle, données de démonstration.',
    },
  },
]

export function ProductIndex() {
  return (
    <nav aria-label="Sommaire du produit" className="shell">
      <ul className="flex flex-wrap gap-x-7 gap-y-3 border-y border-ink/15 py-5">
        {CHAPTERS.map(chapter => (
          <li key={chapter.id}>
            <a
              href={`#${chapter.id}`}
              className="text-[0.9375rem] text-graphite transition-colors duration-150 hover:text-ink"
            >
              {chapter.nav}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function ProductChapters() {
  return (
    <div>
      {CHAPTERS.map(chapter => (
        <section
          key={chapter.id}
          id={chapter.id}
          aria-labelledby={`${chapter.id}-titre`}
          className="shell-wide py-16 lg:py-24"
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
            <div>
              <h2
                id={`${chapter.id}-titre`}
                className="t-h2 !text-[clamp(1.75rem,1.3rem+1.8vw,2.75rem)]"
              >
                {chapter.title}
              </h2>
              <p className="t-lead mt-5 max-w-[32rem] text-graphite">{chapter.lead}</p>
            </div>
            <ul className="self-start border-t border-ink/15 lg:mt-2">
              {chapter.points.map(point => (
                <li key={point} className="t-body border-b border-ink/15 py-3">
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {chapter.visual?.kind === 'capture' && (
            <div className="mt-12 lg:mt-16">
              <Capture
                src={chapter.visual.src}
                alt={chapter.visual.alt}
                caption={chapter.visual.caption}
                window="lg:aspect-[1915/860]"
                imageClassName={chapter.visual.position}
                sizes="(max-width: 640px) 270vw, (max-width: 1024px) 165vw, (max-width: 1500px) 100vw, 1380px"
              />
            </div>
          )}
          {chapter.visual?.kind === 'clip' && (
            <div className="mt-12 lg:mt-16">
              <AutoClip
                name="clip-terrain"
                poster={terrainPoster}
                sizes="(max-width: 1500px) 100vw, 1380px"
                description="Extrait du film Pathélix : l’application chauffeur affiche la tournée du jour ; le réseau est perdu, le client signe, l’action est conservée puis envoyée au retour du réseau."
              />
              <p className="t-small mt-3 text-graphite">
                Application chauffeur, extrait du film Pathélix.
              </p>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
