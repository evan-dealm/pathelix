import type { Metadata } from 'next'
import Link from 'next/link'
import { CONTACT_EMAIL, LEGAL, SITE_URL } from '@/lib/site/config'
import { PageIntro } from '@/components/site/PageIntro'

export const metadata: Metadata = {
  title: 'Mentions légales',
  description: 'Éditeur, hébergement et conditions d’utilisation du site Pathélix.',
  alternates: { canonical: '/mentions-legales' },
  openGraph: { url: '/mentions-legales' },
}

/** Only what is actually known is printed (src/lib/site/config.ts → LEGAL). */
const PUBLISHER_ROWS: Array<[string, string | null]> = [
  ['Raison sociale', LEGAL.companyName],
  ['Forme juridique', LEGAL.legalForm],
  ['Capital social', LEGAL.shareCapital],
  ['Siège social', LEGAL.registeredOffice],
  ['Immatriculation', LEGAL.registration],
  ['TVA intracommunautaire', LEGAL.vatNumber],
  ['Directeur de la publication', LEGAL.publicationDirector],
]

export default function MentionsLegalesPage() {
  const publisher = PUBLISHER_ROWS.filter((row): row is [string, string] => row[1] !== null)
  return (
    <>
      <PageIntro title="Mentions légales." />
      <div className="shell pb-24 lg:pb-36">
        <div className="prose-site">
          <h2 className="!mt-0">Éditeur du site</h2>
          <p>
            Le site {SITE_URL.replace(/^https?:\/\//, '')} est édité par Pathélix. Contact :{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
          {publisher.length > 0 && (
            <ul>
              {publisher.map(([label, value]) => (
                <li key={label}>
                  {label} : {value}
                </li>
              ))}
            </ul>
          )}

          {LEGAL.hostName && (
            <>
              <h2>Hébergement</h2>
              <p>
                {LEGAL.hostName}
                {LEGAL.hostAddress ? `, ${LEGAL.hostAddress}` : ''}.
              </p>
            </>
          )}

          <h2>Propriété intellectuelle</h2>
          <p>
            Les textes, le film, les captures d’écran, le logo et la marque Pathélix présentés sur
            ce site ne peuvent être reproduits sans accord écrit préalable. Les captures montrent
            l’interface réelle du logiciel, avec des données de démonstration.
          </p>
          <p>
            Les fonds de carte visibles dans les captures et dans le film proviennent
            d’OpenStreetMap (© les contributeurs d’OpenStreetMap) et d’OpenFreeMap.
          </p>

          <h2>Données personnelles</h2>
          <p>
            Le traitement des informations transmises par le formulaire de demande de démonstration
            est décrit dans la <Link href="/confidentialite">politique de confidentialité</Link>.
          </p>

          <h2>Responsabilité</h2>
          <p>
            Ce site présente le logiciel Pathélix. Les fonctionnalités décrites correspondent au
            produit à la date de publication ; elles peuvent évoluer. Seuls les documents
            contractuels remis à un client engagent Pathélix.
          </p>
        </div>
      </div>
    </>
  )
}
