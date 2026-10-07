/**
 * Facts about the public website that are not copy: where it lives, who publishes it, how to
 * reach the team. Anything unknown stays `null` and is simply not rendered — a legal notice must
 * never show an invented company number.
 */

/** Public origin of the website, without trailing slash. Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
)

export const SITE_NAME = 'Pathélix'

/** Address shown on the website and used as fallback when the demo form cannot be submitted. */
export const CONTACT_EMAIL = 'support@pathelix.com'

export const SITE_TAGLINE =
  'Plateforme d’exploitation pour les entreprises de bennes, de collecte, de déchets et de recyclage'

export const SITE_DESCRIPTION =
  'Pathélix réunit missions, tournées optimisées, application chauffeur hors ligne, parc de bennes et facturation pour les loueurs de bennes et les entreprises de collecte, de déchets et de recyclage.'

/** Publisher details required by French law (LCEN art. 6-III). Fill in before going live. */
export interface LegalEntity {
  companyName: string | null
  legalForm: string | null
  shareCapital: string | null
  registeredOffice: string | null
  registration: string | null
  vatNumber: string | null
  publicationDirector: string | null
  hostName: string | null
  hostAddress: string | null
}

export const LEGAL: LegalEntity = {
  companyName: null,
  legalForm: null,
  shareCapital: null,
  registeredOffice: null,
  registration: null,
  vatNumber: null,
  publicationDirector: null,
  hostName: null,
  hostAddress: null,
}

export interface NavItem {
  href: string
  label: string
}

export const PRIMARY_NAV: NavItem[] = [
  { href: '/produit', label: 'Produit' },
  { href: '/metiers', label: 'Métiers' },
  { href: '/securite', label: 'Sécurité' },
  { href: '/#film', label: 'Le film' },
]

/** Official presentation film (ecran/Pathelix V1.mp4, re-encoded for the web). */
export const FILM = {
  durationSeconds: 129,
  durationLabel: '2 min 09',
  isoDuration: 'PT2M9S',
  uploadDate: '2026-10-07',
  sources: {
    hd: '/site-media/pathelix-film-1080.mp4',
    sd: '/site-media/pathelix-film-720.mp4',
  },
  chaptersTrack: '/site-media/pathelix-film.chapters.vtt',
  chapters: [
    { at: 0, label: 'Ouverture' },
    { at: 22, label: 'Tableau de bord' },
    { at: 33, label: 'Missions' },
    { at: 46, label: 'Des missions aux tournées' },
    { at: 66, label: 'Les tournées sur la carte' },
    { at: 80, label: 'Une urgence en cours de journée' },
    { at: 89, label: 'Application chauffeur, sans réseau' },
    { at: 104, label: 'Statistiques' },
    { at: 114, label: 'Intégrations' },
  ],
} as const

/** Size brackets offered by the demo form — enough to prepare a relevant demonstration. */
export const FLEET_SIZES = ['1-5', '6-15', '16-40', '40+'] as const
export type FleetSize = (typeof FLEET_SIZES)[number]

export const FLEET_SIZE_LABELS: Record<FleetSize, string> = {
  '1-5': '1 à 5 chauffeurs',
  '6-15': '6 à 15 chauffeurs',
  '16-40': '16 à 40 chauffeurs',
  '40+': 'Plus de 40 chauffeurs',
}
