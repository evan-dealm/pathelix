import type { Metadata } from 'next'
import { CONTACT_EMAIL } from '@/lib/site/config'
import { CtaBand } from '@/components/site/CtaBand'
import { PageIntro } from '@/components/site/PageIntro'

const DESCRIPTION =
  'Cloisonnement des organisations, authentification, rôles et permissions, journal d’audit, chiffrement des secrets, sauvegardes : les mécanismes de sécurité réellement en place dans Pathélix.'

export const metadata: Metadata = {
  title: 'Sécurité',
  description: DESCRIPTION,
  alternates: { canonical: '/securite' },
  openGraph: { url: '/securite', title: 'La sécurité dans Pathélix', description: DESCRIPTION },
}

const TOPICS: Array<{ id: string; title: string; paragraphs: string[]; points?: string[] }> = [
  {
    id: 'cloisonnement',
    title: 'Cloisonnement des organisations',
    paragraphs: [
      'Pathélix héberge plusieurs entreprises ; aucune ne voit les données d’une autre. L’accès aux données passe par une couche qui ajoute l’identifiant de l’organisation à chaque lecture et à chaque écriture, et qui refuse l’opération si elle ne peut pas le faire.',
      'Quand une requête fait référence à un autre objet — le chauffeur d’un véhicule, le client d’une mission —, l’appartenance de cet objet à la même organisation est vérifiée avant toute écriture.',
    ],
  },
  {
    id: 'authentification',
    title: 'Authentification et sessions',
    paragraphs: [
      'L’identité d’un utilisateur vient uniquement de sa session vérifiée par le serveur, jamais d’une information envoyée par le navigateur.',
    ],
    points: [
      'Mots de passe stockés sous forme hachée (bcrypt)',
      'Session de 24 heures dans un cookie inaccessible aux scripts, limité au site et transmis en HTTPS',
      'Se déconnecter, changer de mot de passe ou de rôle invalide les sessions en cours, sur tous les appareils',
      'Tentatives de connexion limitées par adresse et par compte',
    ],
  },
  {
    id: 'permissions',
    title: 'Rôles et permissions',
    paragraphs: [
      'Trois rôles — administrateur, exploitant, chauffeur — complétés par des permissions fines par utilisateur : optimiser, gérer les missions, voir les coûts, gérer les intégrations… Chaque droit est contrôlé par le serveur ; masquer un bouton ne suffit pas.',
      'Un chauffeur n’accède qu’à sa propre tournée. Tout le reste lui est refusé par défaut.',
    ],
  },
  {
    id: 'api',
    title: 'Accès par API',
    paragraphs: [
      'Les clés d’API sont créées par un administrateur, limitées aux domaines qu’il choisit, et peuvent expirer ou être révoquées. Elles sont stockées hachées : Pathélix ne peut pas les relire.',
    ],
    points: [
      'Webhooks entrants authentifiés par un secret propre à chaque organisation',
      'Webhooks sortants signés',
      'Appels sortants vers les adresses que vous configurez protégés contre le détournement vers un réseau interne',
      'Limitation du nombre de requêtes par utilisateur et par adresse',
    ],
  },
  {
    id: 'audit',
    title: 'Journal d’audit',
    paragraphs: [
      'Qui a fait quoi, quand, sur quel objet : utilisateurs et permissions, missions, tournées, bennes, devis, factures, paiements, clés d’API, paramètres. Le journal est réservé aux administrateurs de l’organisation et conservé un an par défaut. Les valeurs secrètes y sont masquées.',
    ],
  },
  {
    id: 'donnees',
    title: 'Données et fichiers',
    paragraphs: [
      'Les identifiants de vos intégrations sont chiffrés en base (AES-256-GCM) et ne sont jamais renvoyés par l’API ni écrits dans les journaux.',
    ],
    points: [
      'Photos et signatures servies uniquement après contrôle d’accès',
      'Type réel des fichiers déposés vérifié, taille limitée',
      'Positions GPS supprimées après 30 jours par défaut',
      'Lien de suivi client : jeton aléatoire, à durée limitée, restreint à une intervention',
    ],
  },
  {
    id: 'sauvegardes',
    title: 'Sauvegardes et continuité',
    paragraphs: [
      'La base de données est exportée chaque jour ; un export n’est conservé qu’une fois terminé et relu. La procédure de restauration est documentée.',
      'Si un composant annexe s’arrête — file de calcul, service de routage —, l’application continue avec un mode de repli plutôt que de s’interrompre.',
    ],
  },
]

export default function SecuritePage() {
  return (
    <>
      <PageIntro
        title="Ce qui protège vos données."
        lead="Cette page décrit des mécanismes en place dans le produit, pas des intentions. Elle ne mentionne aucune certification, parce que Pathélix n’en détient pas à ce jour."
      />

      <div className="shell pb-10">
        {TOPICS.map(topic => (
          <section
            key={topic.id}
            id={topic.id}
            aria-labelledby={`${topic.id}-titre`}
            className="grid gap-5 border-t border-ink/15 py-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-14"
          >
            <h2
              id={`${topic.id}-titre`}
              className="text-[1.375rem] font-semibold leading-[1.2] tracking-[-0.025em]"
            >
              {topic.title}
            </h2>
            <div className="max-w-[42rem]">
              {topic.paragraphs.map(paragraph => (
                <p key={paragraph} className="t-body text-carbon [&+p]:mt-4">
                  {paragraph}
                </p>
              ))}
              {topic.points && (
                <ul className="mt-6 border-t border-ink/15">
                  {topic.points.map(point => (
                    <li key={point} className="t-small border-b border-ink/15 py-3">
                      {point}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}

        <section aria-labelledby="signalement-titre" className="border-t border-ink py-10 lg:py-14">
          <h2 id="signalement-titre" className="t-h3">
            Signaler une vulnérabilité
          </h2>
          <p className="t-body mt-3 max-w-[40rem] text-graphite">
            Écrivez à{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="link text-ink">
              {CONTACT_EMAIL}
            </a>{' '}
            en décrivant ce que vous avez observé. Merci de ne pas publier le détail avant que nous
            ayons pu corriger.
          </p>
        </section>
      </div>

      <CtaBand />
    </>
  )
}
