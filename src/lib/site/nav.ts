import { FILM } from './config'

/**
 * The website's navigation: every public page reachable from the header, grouped the way a
 * visitor looks for it. The header (desktop menus, mobile accordions) and the footer read this
 * one source, so a page added here appears everywhere.
 */

export interface NavLink {
  href: string
  label: string
  /** One line under the label in the desktop menus. */
  hint?: string
  /** Page of the application (other root layout): linked without prefetching its bundle. */
  app?: boolean
}

export interface NavGroup {
  title: string
  links: NavLink[]
  /** Shown as a quieter side column in the desktop menu. */
  aside?: boolean
}

export interface NavMenu {
  id: string
  label: string
  /** Path prefixes that mark this menu as the current section. */
  sections: string[]
  groups: NavGroup[]
}

export const NAV_MENUS: NavMenu[] = [
  {
    id: 'produit',
    label: 'Produit',
    sections: ['/produit', '/fonctionnalites', '/securite'],
    groups: [
      {
        title: 'Modules',
        links: [
          {
            href: '/fonctionnalites/optimisation-de-tournees',
            label: 'Optimisation de tournées',
            hint: 'Des tournées calculées avec vos contraintes, recalculées en cours de journée.',
          },
          {
            href: '/fonctionnalites/planning-chauffeurs',
            label: 'Planning chauffeurs',
            hint: 'La journée de chaque chauffeur et de chaque camion, ajustable à la main.',
          },
          {
            href: '/fonctionnalites/application-chauffeur',
            label: 'Application chauffeur',
            hint: 'La tournée, les photos et la signature sur le téléphone, même sans réseau.',
          },
          {
            href: '/fonctionnalites/parc-de-bennes',
            label: 'Parc de bennes',
            hint: 'Chaque benne suivie par son numéro et son QR code.',
          },
          {
            href: '/fonctionnalites/facturation-et-pesees',
            label: 'Facturation et pesées',
            hint: 'Du devis au paiement, sans ressaisie.',
          },
          {
            href: '/fonctionnalites/portail-client',
            label: 'Portail client',
            hint: 'Vos clients font leurs demandes et suivent leurs interventions.',
          },
        ],
      },
      {
        title: 'Découvrir',
        aside: true,
        links: [
          { href: '/produit', label: 'Vue d’ensemble du produit' },
          { href: '/#film', label: `Le film (${FILM.durationLabel})` },
          { href: '/securite', label: 'Sécurité et données' },
        ],
      },
    ],
  },
  {
    id: 'metiers',
    label: 'Métiers',
    sections: ['/metiers'],
    groups: [
      {
        title: 'Votre activité',
        links: [
          {
            href: '/metiers/location-de-bennes',
            label: 'Location de bennes',
            hint: 'Poses, rotations et enlèvements, parc suivi, devis et factures.',
          },
          {
            href: '/metiers/collecte-de-dechets',
            label: 'Collecte de déchets',
            hint: 'Passages récurrents, tournées avec les exutoires, preuves de passage.',
          },
          {
            href: '/metiers/recyclage',
            label: 'Recyclage',
            hint: 'Collectes, pesées par matière, facturation du réalisé.',
          },
        ],
      },
      {
        title: 'Découvrir',
        aside: true,
        links: [{ href: '/metiers', label: 'Tous les métiers servis' }],
      },
    ],
  },
  {
    id: 'ressources',
    label: 'Ressources',
    sections: ['/guides', '/comparatifs', '/glossaire'],
    groups: [
      {
        title: 'Guides',
        links: [
          { href: '/guides/organiser-les-rotations-de-bennes', label: 'Organiser les rotations de bennes' },
          { href: '/guides/cout-d-une-tournee', label: 'Calculer le coût d’une tournée' },
          { href: '/guides/temps-de-conduite-en-collecte', label: 'Temps de conduite en collecte' },
          { href: '/guides/reduire-les-kilometres-a-vide', label: 'Réduire les kilomètres à vide' },
        ],
      },
      {
        title: 'Comparatifs',
        links: [
          { href: '/comparatifs/pathelix-ou-excel', label: 'Pathélix ou Excel' },
          {
            href: '/comparatifs/logiciel-metier-ou-optimiseur-generaliste',
            label: 'Logiciel métier ou optimiseur généraliste',
          },
          { href: '/comparatifs/pathelix-et-votre-erp', label: 'Pathélix et votre ERP' },
        ],
      },
      {
        title: 'Références',
        aside: true,
        links: [
          { href: '/guides', label: 'Tous les guides et comparatifs' },
          { href: '/glossaire', label: 'Glossaire du métier' },
          { href: '/api-docs', label: 'Référence de l’API', app: true },
          { href: '/status', label: 'État du service', app: true },
          { href: '/help', label: 'Centre d’aide', app: true },
        ],
      },
    ],
  },
]

/** Top-level pages that need no menu. */
export const NAV_DIRECT: NavLink[] = [{ href: '/tarifs', label: 'Tarifs' }]

/** Whether `pathname` belongs to one of the given sections (exact page or a page below it). */
export function inSection(pathname: string, sections: string[]): boolean {
  return sections.some(section => pathname === section || pathname.startsWith(`${section}/`))
}
