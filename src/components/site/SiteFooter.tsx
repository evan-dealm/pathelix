import Image from 'next/image'
import Link from 'next/link'
import { CONTACT_EMAIL, SITE_TAGLINE } from '@/lib/site/config'
import logo from '../../../public/logo-pathelix.png'
import { Orbit } from './Orbit'

interface FooterLink {
  href: string
  label: string
  /** Page of the application (other root layout): linked without prefetching its bundle. */
  app?: boolean
  /** Not a page (mailto:). */
  plain?: boolean
}

const COLUMNS: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: 'Produit',
    links: [
      { href: '/produit', label: 'Vue d’ensemble' },
      { href: '/fonctionnalites/optimisation-de-tournees', label: 'Optimisation de tournées' },
      { href: '/fonctionnalites/planning-chauffeurs', label: 'Planning chauffeurs' },
      { href: '/fonctionnalites/application-chauffeur', label: 'Application chauffeur' },
      { href: '/fonctionnalites/parc-de-bennes', label: 'Parc de bennes' },
      { href: '/fonctionnalites/facturation-et-pesees', label: 'Facturation et pesées' },
      { href: '/fonctionnalites/portail-client', label: 'Portail client' },
    ],
  },
  {
    title: 'Métiers',
    links: [
      { href: '/metiers/location-de-bennes', label: 'Location de bennes' },
      { href: '/metiers/collecte-de-dechets', label: 'Collecte de déchets' },
      { href: '/metiers/recyclage', label: 'Recyclage' },
      { href: '/tarifs', label: 'Tarifs' },
      { href: '/#film', label: 'Le film' },
    ],
  },
  {
    title: 'Ressources',
    links: [
      { href: '/guides', label: 'Guides et comparatifs' },
      { href: '/glossaire', label: 'Glossaire' },
      { href: '/securite', label: 'Sécurité' },
      { href: '/api-docs', label: 'Référence de l’API', app: true },
    ],
  },
  {
    title: 'Pathélix',
    links: [
      { href: '/contact', label: 'Demander une démo' },
      { href: `mailto:${CONTACT_EMAIL}`, label: CONTACT_EMAIL, plain: true },
      { href: '/login', label: 'Connexion', app: true },
    ],
  },
]

const linkClass = 'text-[0.9375rem] text-ash transition-colors duration-150 hover:text-paper'

export function SiteFooter() {
  return (
    <footer className="on-dark relative overflow-hidden bg-ink text-paper">
      <Orbit className="pointer-events-none absolute -bottom-[38%] -right-[12%] hidden w-[52rem] text-paper/[0.13] md:block" />

      <div className="shell-wide relative pb-10 pt-20 lg:pt-28">
        <div className="grid gap-14 xl:grid-cols-[1fr_3fr]">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-3"
              aria-label="Pathélix, accueil"
            >
              <Image src={logo} alt="" width={36} height={36} className="rounded-[8px]" />
              <span className="text-xl font-semibold tracking-[-0.03em]">Pathélix</span>
            </Link>
            <p className="mt-5 max-w-[22rem] text-[0.9375rem] leading-[1.55] text-ash">
              {SITE_TAGLINE}.
            </p>
          </div>

          <nav
            aria-label="Pied de page"
            className="grid grid-cols-2 gap-x-8 gap-y-12 lg:grid-cols-4"
          >
            {COLUMNS.map(col => (
              <div key={col.title}>
                <h2 className="text-[0.9375rem] font-medium tracking-[-0.01em]">{col.title}</h2>
                <ul className="mt-4 space-y-3">
                  {col.links.map(l => (
                    <li key={l.href}>
                      {l.plain ? (
                        <a href={l.href} className={linkClass}>
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          href={l.href}
                          prefetch={l.app ? false : undefined}
                          className={linkClass}
                        >
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-20 flex flex-col gap-4 border-t border-paper/15 pt-6 text-[0.8125rem] text-ash sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Pathélix</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            <li>
              <Link
                href="/mentions-legales"
                className="transition-colors duration-150 hover:text-paper"
              >
                Mentions légales
              </Link>
            </li>
            <li>
              <Link
                href="/confidentialite"
                className="transition-colors duration-150 hover:text-paper"
              >
                Politique de confidentialité
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
