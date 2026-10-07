import type { Metadata } from 'next'
import Link from 'next/link'
import { Orbit } from '@/components/site/Orbit'

export const metadata: Metadata = {
  title: 'Page introuvable',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <section className="relative overflow-hidden">
      <Orbit className="pointer-events-none absolute left-1/2 top-1/2 w-[70rem] max-w-none -translate-x-[28%] -translate-y-1/2 text-ink/[0.12]" />
      <div className="shell relative flex min-h-[78vh] flex-col justify-center pb-24 pt-40">
        <p className="t-num text-[0.9375rem] text-graphite">Erreur 404</p>
        <h1 className="t-display mt-4 max-w-[14ch]">Cette page n’est sur aucune tournée.</h1>
        <p className="t-lead mt-7 max-w-[32rem] text-graphite">
          L’adresse a changé ou n’a jamais existé. Reprenez depuis l’accueil, ou allez directement
          au produit.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/" className="btn btn-primary">
            Revenir à l’accueil
          </Link>
          <Link href="/produit" className="btn btn-quiet">
            Voir le produit
          </Link>
        </div>
      </div>
    </section>
  )
}
