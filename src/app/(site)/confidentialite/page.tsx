import type { Metadata } from 'next'
import { CONTACT_EMAIL, LEGAL } from '@/lib/site/config'
import { PageIntro } from '@/components/site/PageIntro'

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description:
    'Quelles données le site Pathélix collecte, pourquoi, combien de temps, et comment exercer vos droits.',
  alternates: { canonical: '/confidentialite' },
  openGraph: { url: '/confidentialite' },
}

export default function ConfidentialitePage() {
  return (
    <>
      <PageIntro
        title="Politique de confidentialité."
        lead="Ce site collecte très peu de choses : ce que vous écrivez dans le formulaire de démonstration, et rien d’autre à des fins commerciales."
      />
      <div className="shell pb-24 lg:pb-36">
        <div className="prose-site">
          <h2 className="!mt-0">Responsable du traitement</h2>
          <p>
            {LEGAL.companyName ?? 'Pathélix'}, éditeur du site. Pour toute question relative à vos
            données : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>

          <h2>Formulaire de demande de démonstration</h2>
          <p>Lorsque vous demandez une démonstration, nous enregistrons :</p>
          <ul>
            <li>votre prénom, votre nom et le nom de votre entreprise ;</li>
            <li>votre adresse e-mail professionnelle ;</li>
            <li>
              votre numéro de téléphone, la taille de votre exploitation et votre message, si vous
              les indiquez.
            </li>
          </ul>
          <p>
            Ces informations servent à vous répondre et à préparer la démonstration. Le traitement
            repose sur votre demande. Elles sont lues par l’équipe Pathélix, ne sont ni vendues ni
            transmises à des tiers à des fins commerciales, et sont supprimées au plus tard trois
            ans après votre demande.
          </p>

          <h2>Cookies et mesure d’audience</h2>
          <p>
            Les pages de ce site ne déposent aucun cookie et n’utilisent ni outil de mesure
            d’audience ni traceur publicitaire. Les polices de caractères sont servies depuis ce
            site, sans appel à un service tiers.
          </p>
          <p>
            Si vous vous connectez à l’application Pathélix, un cookie de session strictement
            nécessaire à son fonctionnement est déposé. Il n’est pas utilisé à d’autres fins.
          </p>

          <h2>Journaux techniques</h2>
          <p>
            Comme tout serveur web, celui de Pathélix enregistre des informations techniques sur les
            requêtes reçues, dont l’adresse IP, pour assurer la sécurité du service et limiter les
            abus. Lorsqu’une erreur se produit dans votre navigateur, un rapport technique peut être
            transmis à notre outil de supervision, sans cookie.
          </p>

          <h2>Données traitées dans l’application</h2>
          <p>
            Les données que les entreprises clientes saisissent dans l’application — missions,
            chauffeurs, clients, positions — sont traitées par Pathélix pour leur compte, selon le
            contrat qui les lie à Pathélix. Si vous êtes chauffeur ou client d’une de ces
            entreprises, adressez-vous d’abord à elle.
          </p>

          <h2>Vos droits</h2>
          <p>
            Vous pouvez demander l’accès à vos données, leur rectification, leur effacement, ou vous
            opposer à leur traitement, en écrivant à{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Vous pouvez également saisir la
            Commission nationale de l’informatique et des libertés (CNIL).
          </p>
        </div>
      </div>
    </>
  )
}
