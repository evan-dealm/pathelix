import Link from 'next/link'
import { CONTACT_EMAIL } from '@/lib/site/config'

/** Closing invitation, shared by every page of the site. */
export function CtaBand() {
  return (
    <section className="bg-mist" aria-labelledby="demo">
      <div className="shell band grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-20">
        <h2 id="demo" className="t-h2 max-w-[16ch]">
          Voyez Pathélix sur un cas proche du vôtre.
        </h2>
        <div>
          <p className="t-lead max-w-[28rem] text-graphite">
            Présentez-nous votre exploitation : chauffeurs, types de missions, outils en place. Nous
            vous montrons Pathélix sur cette base.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link href="/contact" className="btn btn-primary">
              Demander une démo
            </Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="link text-[0.9375rem]">
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
