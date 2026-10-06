import Link from 'next/link'
import { BRAND_LOGO_SRC } from '@/lib/branding'
import { RouteSketch } from './RouteSketch'

const CAPABILITIES = [
  {
    title: 'Des tournées calculées pour les bennes',
    body: 'Pose, retrait, échange, vidage : l’optimiseur sait qu’une benne pleine part à l’exutoire avant le chantier suivant, respecte les créneaux, la capacité de chaque camion et les priorités du jour.',
  },
  {
    title: 'Le terrain en direct',
    body: 'Chaque arrêt validé par un chauffeur remonte immédiatement au planning. Un retard ou un imprévu ? Vous réoptimisez la fin de journée sans défaire ce qui est déjà fait.',
  },
  {
    title: 'Une application chauffeur qui tient sans réseau',
    body: 'Feuille de route, photos, signature et poids enregistrés hors connexion, envoyés dès que le réseau revient — sans doublon, même après plusieurs tentatives.',
  },
  {
    title: 'La réglementation intégrée au calcul',
    body: 'Temps de conduite et pauses selon le règlement CE 561/2006 pris en compte dans chaque tournée, bordereaux de suivi des déchets avec Trackdéchets.',
  },
]

const STEPS = [
  { title: 'Vos missions arrivent', body: 'Saisie, import de fichier ou intégration avec votre ERP.' },
  { title: 'Vous lancez l’optimisation', body: 'Les tournées de chaque chauffeur sont prêtes en quelques secondes, ajustables à la main.' },
  { title: 'Les chauffeurs exécutent', body: 'Sur leur téléphone, avec ou sans réseau.' },
  { title: 'Vous suivez et ajustez', body: 'Avancement en direct, réoptimisation en cours de journée, rapports en fin de mois.' },
]

/** Public product page (src/app/page.tsx). Static server component — no client JS beyond links. */
export function Landing() {
  return (
    <div className="relative min-h-screen bg-[#F4F6F8] text-[#13212F]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0055A4]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND_LOGO_SRC} alt="" width={28} height={28} className="rounded-md" />
          <span className="font-display text-lg font-semibold tracking-tight">Pathélix</span>
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-[#13212F]/15 bg-white px-4 py-2 text-sm font-medium transition-colors hover:border-[#0055A4] hover:text-[#0055A4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0055A4]"
        >
          Se connecter
        </Link>
      </header>

      <main id="main-content">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 sm:px-6 md:grid-cols-[1.05fr_1fr] md:pb-24 md:pt-14">
          <div>
            <h1 className="font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl">
              La tournée de demain, prête ce soir.
            </h1>
            <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-[#13212F]/75">
              Pathélix planifie les tournées des loueurs de bennes et des collecteurs de déchets :
              qui pose, qui retire, quand vider à l’exutoire — et suit leur exécution jusqu’au dernier arrêt.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/login"
                className="rounded-lg bg-[#0055A4] px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-[#00468a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0055A4]"
              >
                Se connecter
              </Link>
              <a
                href="mailto:support@pathelix.com?subject=Demande%20de%20d%C3%A9monstration"
                className="rounded-lg px-2 py-3 text-base font-medium text-[#0055A4] underline decoration-[#0055A4]/30 underline-offset-4 hover:decoration-[#0055A4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0055A4]"
              >
                Demander une démonstration
              </a>
            </div>
          </div>
          <RouteSketch />
        </section>

        <section aria-labelledby="capabilities" className="border-y border-[#D9E0E6] bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 id="capabilities" className="font-display max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Pensé pour le métier de la benne, pas pour la livraison de colis.
            </h2>
            <dl className="mt-12 grid gap-x-12 md:grid-cols-2">
              {CAPABILITIES.map(c => (
                <div key={c.title} className="border-t border-[#D9E0E6] py-7">
                  <dt className="font-display text-xl font-semibold tracking-tight">{c.title}</dt>
                  <dd className="mt-2.5 max-w-[34rem] leading-relaxed text-[#13212F]/70">{c.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="how" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
          <h2 id="how" className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Une journée avec Pathélix</h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative pl-12">
                <span aria-hidden className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#E9A400] font-display text-sm font-semibold text-[#13212F]">
                  {i + 1}
                </span>
                <h3 className="font-display text-lg font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-1.5 leading-relaxed text-[#13212F]/70">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-[#D9E0E6]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-[#13212F]/60 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>Pathélix — optimisation de tournées de collecte</span>
          <nav aria-label="Liens utiles" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link className="hover:text-[#0055A4]" href="/login">Connexion</Link>
            <Link className="hover:text-[#0055A4]" href="/status">État du service</Link>
            <Link className="hover:text-[#0055A4]" href="/help">Aide</Link>
            <a className="hover:text-[#0055A4]" href="mailto:support@pathelix.com">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
