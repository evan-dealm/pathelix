import Link from 'next/link'
import { SITE_URL } from '@/lib/site/config'
import { JsonLd } from './JsonLd'

interface Crumb {
  href: string
  label: string
}

/** Visible breadcrumb and its BreadcrumbList structured data. The last entry is the current page. */
export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  const crumbs: Crumb[] = [{ href: '/', label: 'Accueil' }, ...trail]
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: crumbs.map((crumb, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: crumb.label,
            item: `${SITE_URL}${crumb.href === '/' ? '' : crumb.href}`,
          })),
        }}
      />
      <nav aria-label="Fil d’Ariane">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.875rem] text-graphite">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <li key={crumb.href} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden="true">/</span>}
                {last ? (
                  <span aria-current="page" className="text-ink">
                    {crumb.label}
                  </span>
                ) : (
                  <Link href={crumb.href} className="transition-colors duration-150 hover:text-ink">
                    {crumb.label}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
    </>
  )
}
