import type { Metadata } from 'next'
import { CONTACT_EMAIL } from '@/lib/site/config'
import { DemoForm } from '@/components/site/DemoForm'

const DESCRIPTION =
  'Demandez une démonstration de Pathélix : présentez votre exploitation, nous vous montrons le produit sur un cas proche du vôtre.'

export const metadata: Metadata = {
  title: 'Demander une démo',
  description: DESCRIPTION,
  alternates: { canonical: '/contact' },
  openGraph: { url: '/contact', title: 'Demander une démo de Pathélix', description: DESCRIPTION },
}

const NEXT_STEPS = [
  'Vous décrivez votre exploitation en quelques lignes.',
  'Nous vous recontactons pour convenir d’un créneau.',
  'Nous vous montrons Pathélix sur un cas proche de votre activité.',
]

export default function ContactPage() {
  return (
    <div className="shell grid gap-14 pb-24 pt-32 sm:pt-40 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-24 lg:pb-36 lg:pt-48">
      <div>
        <h1 className="t-display enter-1 !text-[clamp(2.25rem,1.3rem+4vw,4.25rem)]">
          Demander une démo.
        </h1>
        <p className="t-lead enter-2 mt-7 max-w-[30rem] text-graphite">
          Présentez-nous votre exploitation. Nous vous montrerons Pathélix sur un cas proche de
          votre activité, pas sur une présentation générique.
        </p>

        <ol className="enter-3 mt-12 max-w-[30rem] border-t border-ink/15">
          {NEXT_STEPS.map((step, index) => (
            <li key={step} className="flex gap-5 border-b border-ink/15 py-4">
              <span className="t-num text-[0.9375rem] text-graphite">{index + 1}</span>
              <span className="t-body">{step}</span>
            </li>
          ))}
        </ol>

        <p className="t-small mt-8 text-graphite">
          Vous préférez écrire ?{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="link text-ink">
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>

      <div className="enter-3 lg:pt-3">
        <DemoForm />
      </div>
    </div>
  )
}
