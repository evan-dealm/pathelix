import type { ContentPage } from './types'

const DATES = { published: '2026-10-07', updated: '2026-10-07' }

export const COMPARATIFS: ContentPage[] = [
  {
    kind: 'comparatif',
    slug: 'pathelix-ou-excel',
    name: 'Pathélix ou Excel',
    title: 'Gérer ses bennes sur Excel ou avec un logiciel ?',
    metaTitle: 'Gestion de bennes : Excel ou logiciel ?',
    description:
      'Un tableur suffit pour démarrer une activité de bennes. Cette page explique honnêtement jusqu’où il tient, où il casse, et ce qu’un logiciel comme Pathélix change.',
    answer:
      'Un tableur et un tableau blanc suffisent tant qu’une seule personne planifie quelques camions. Ils cassent quand la journée change plus vite qu’on ne peut les mettre à jour, quand plusieurs personnes planifient, ou quand il faut prouver ce qui a été fait. Un logiciel devient utile à ce moment-là, pas avant.',
    sections: [
      {
        heading: 'Ce qu’Excel fait bien',
        points: [
          'Il est déjà là et ne coûte rien de plus',
          'Chacun l’adapte à sa façon de travailler',
          'Pour deux ou trois camions et un seul planificateur, il fait le travail',
        ],
      },
      {
        heading: 'Là où il casse',
        points: [
          'Le fichier dit ce qui était prévu, pas ce qui se passe : il faut appeler les chauffeurs',
          'Deux personnes ne peuvent pas planifier en même temps sans s’écraser',
          'Aucune règle n’est vérifiée : une benne de 30 m³ peut être donnée à un camion qui ne la porte pas',
          'Refaire le plan après un imprévu prend le temps qu’on n’a pas',
          'Savoir où est une benne suppose que quelqu’un l’ait noté',
          'Rien ne relie la tournée à la facture : tout est ressaisi',
        ],
      },
      {
        heading: 'Comparaison point par point',
        table: {
          caption: 'Tableur et Pathélix, fonction par fonction',
          head: ['Sujet', 'Tableur', 'Pathélix'],
          rows: [
            ['Coût', 'Aucun en plus', 'Abonnement, établi selon l’exploitation'],
            [
              'Mise en route',
              'Immédiate',
              'Paramétrage des chauffeurs, camions, exutoires, clients',
            ],
            [
              'Calcul des tournées',
              'À la main',
              'En quelques secondes, avec les contraintes du métier',
            ],
            [
              'Imprévu en cours de journée',
              'Tout refaire',
              'Ré-optimisation depuis la position des camions',
            ],
            ['Suivi du terrain', 'Par téléphone', 'Statuts, photos et signatures en direct'],
            ['Sans réseau', 'Sans objet', 'Application chauffeur hors ligne'],
            ['Suivi des bennes', 'Si quelqu’un le note', 'État et historique de chaque benne'],
            [
              'Facturation',
              'Ressaisie',
              'Les prestations réalisées deviennent des lignes de facture',
            ],
            ['Travail à plusieurs', 'Risque d’écrasement', 'Comptes, rôles et permissions'],
          ],
        },
      },
      {
        heading: 'Les signes qu’il est temps de changer',
        points: [
          'Vous passez plus de temps à refaire le plan qu’à le faire',
          'Vous découvrez en fin de mois des prestations non facturées',
          'Vous ne savez plus chez qui est une benne',
          'Un client conteste une intervention et vous n’avez pas de preuve',
          'L’absence du planificateur bloque l’exploitation',
        ],
      },
      {
        heading: 'Passer de l’un à l’autre',
        paragraphs: [
          'Pathélix importe les missions depuis un fichier CSV : vous ne repartez pas de zéro. Les données s’exportent aussi en CSV et Excel, donc rien ne vous enferme.',
        ],
      },
    ],
    questions: [
      {
        question: 'À partir de combien de camions un logiciel vaut-il la peine ?',
        answer:
          'Il n’y a pas de seuil universel. Le bon indicateur n’est pas le nombre de camions mais le temps passé à replanifier et le nombre d’erreurs constatées en fin de mois.',
      },
    ],
    related: [
      '/metiers/location-de-bennes',
      '/fonctionnalites/optimisation-de-tournees',
      '/guides/organiser-les-rotations-de-bennes',
      '/tarifs',
    ],
    ...DATES,
  },
  {
    kind: 'comparatif',
    slug: 'logiciel-metier-ou-optimiseur-generaliste',
    name: 'Logiciel métier ou optimiseur généraliste',
    title: 'Optimiseur de tournées généraliste ou logiciel métier bennes ?',
    metaTitle: 'Optimiseur de tournées généraliste ou logiciel métier bennes ?',
    description:
      'Un optimiseur de tournées conçu pour la livraison calcule des trajets. Un logiciel métier pour les bennes sait qu’un camion plein doit passer à l’exutoire. Ce que cela change en pratique.',
    answer:
      'Un optimiseur généraliste, conçu pour la livraison, répond à la question « dans quel ordre visiter ces adresses ? ». L’exploitation de bennes pose d’autres questions : quand vider, dans quel exutoire, avec quel camion pour quelle benne. Si votre activité est la benne ou la collecte, ces règles doivent être dans le calcul, pas dans la tête du planificateur.',
    sections: [
      {
        heading: 'Ce qu’un optimiseur généraliste suppose',
        points: [
          'Le véhicule part chargé et se vide au fil des arrêts',
          'Un arrêt est une livraison : une fois fait, il est terminé',
          'Tous les véhicules peuvent servir toutes les adresses',
          'Le dépôt est le seul point de passage obligé',
        ],
      },
      {
        heading: 'Ce que le métier de la benne impose',
        points: [
          'Le camion se remplit : il faut vider en cours de tournée',
          'L’exutoire a des horaires et refuse certains déchets',
          'Une benne ne va pas sur n’importe quel camion',
          'Une pose appelle plus tard une rotation ou un enlèvement',
          'La benne elle-même est un bien à suivre',
        ],
      },
      {
        heading: 'Comparaison',
        table: {
          caption: 'Optimiseur généraliste et Pathélix',
          head: ['Sujet', 'Optimiseur généraliste', 'Pathélix'],
          rows: [
            ['Ordre des arrêts', 'Oui', 'Oui'],
            ['Créneaux horaires', 'Oui en général', 'Oui'],
            ['Passage à l’exutoire', 'À ajouter à la main', 'Inséré par le calcul'],
            ['Déchets acceptés par l’exutoire', 'Non prévu', 'Pris en compte'],
            ['Benne compatible avec le camion', 'Non prévu', 'Vérifié'],
            ['Suivi du parc de bennes', 'Non prévu', 'Inclus'],
            ['Devis et factures', 'Hors périmètre', 'Inclus'],
            ['Vocabulaire', 'Livraison, colis', 'Pose, rotation, exutoire'],
          ],
        },
        paragraphs: [
          'La colonne « optimiseur généraliste » décrit une catégorie d’outils, pas un produit précis : certains couvrent une partie de ces points. Vérifiez chaque ligne avec l’éditeur que vous étudiez.',
        ],
      },
      {
        heading: 'Quand un optimiseur généraliste suffit',
        paragraphs: [
          'Si vous faites surtout de la livraison ou de la tournée d’intervention sans vidage en cours de route, un outil généraliste fait le travail et sera souvent plus simple. Pathélix s’adapte à d’autres secteurs en changeant son vocabulaire, mais ce n’est pas son premier métier.',
        ],
      },
    ],
    related: [
      '/fonctionnalites/optimisation-de-tournees',
      '/metiers/location-de-bennes',
      '/metiers/collecte-de-dechets',
      '/guides/reduire-les-kilometres-a-vide',
    ],
    ...DATES,
  },
  {
    kind: 'comparatif',
    slug: 'pathelix-et-votre-erp',
    name: 'Pathélix et votre ERP',
    title: 'Pathélix à côté de votre ERP, ou à sa place ?',
    metaTitle: 'Pathélix et votre ERP : compléter ou remplacer ?',
    description:
      'Pathélix peut recevoir les missions de votre logiciel de gestion et lui renvoyer ce qui a été réalisé, ou couvrir toute la chaîne du devis à la facture. Les deux montages, sans langue de bois.',
    answer:
      'Les deux sont possibles. Si votre ERP gère déjà vos clients et votre facturation, Pathélix se place à côté : il reçoit les missions, planifie, suit le terrain et renvoie ce qui a été fait. Si vous n’avez pas d’outil de gestion, il couvre aussi les devis, les commandes et les factures.',
    sections: [
      {
        heading: 'Montage 1 : Pathélix à côté de l’ERP',
        paragraphs: [
          'L’ERP reste la référence des clients, des contrats et de la facturation. Pathélix prend ce que l’ERP fait mal : planifier, optimiser, suivre les chauffeurs.',
        ],
        points: [
          'Les missions arrivent par webhook signé, par l’API ou par import de fichier',
          'En fin de mission, Pathélix envoie le résultat : vers Sage ou SAP, ou vers une adresse de votre choix',
          'Les données restent consultables par l’API',
        ],
      },
      {
        heading: 'Montage 2 : Pathélix seul',
        paragraphs: [
          'Sans logiciel de gestion en place, Pathélix couvre la chaîne entière : clients et sites, grilles tarifaires, devis, commandes, contrats, missions, factures, avoirs, paiements, export comptable.',
        ],
      },
      {
        heading: 'Les intégrations qui existent aujourd’hui',
        table: {
          caption: 'Intégrations disponibles dans Pathélix',
          head: ['Domaine', 'Ce qui existe'],
          rows: [
            ['API REST', 'Clés aux droits limités par domaine, référence publique'],
            ['Import de missions', 'Webhook signé (connecteur Nessy), fichier CSV ou JSON'],
            ['Facturation', 'Envoi vers Sage ou SAP en fin de mission, export comptable'],
            ['Télématique', 'Positions des boîtiers Geotab, Samsara ou OBD'],
            ['Notifications', 'Slack, Teams, SMS au client, webhooks sortants signés'],
            ['Décisionnel', 'Indicateurs pour Power BI'],
            ['Trackdéchets', 'Connecteur en cours de validation, non ouvert en production'],
          ],
        },
      },
      {
        heading: 'Ce qu’il faut vérifier avant de choisir',
        points: [
          'Votre ERP sait-il émettre un appel sortant ou exporter un fichier ?',
          'Qui doit rester la référence pour les clients et les tarifs ?',
          'Quelles informations du terrain la facturation attend-elle : poids, heures, photos ?',
        ],
        paragraphs: [
          'Ces questions se traitent pendant la démonstration, à partir de vos outils réels.',
        ],
      },
    ],
    questions: [
      {
        question: 'Mon ERP n’est pas dans la liste. Est-ce bloquant ?',
        answer:
          'Pas nécessairement. L’API REST et les webhooks permettent de relier un outil qui n’a pas de connecteur dédié, à condition qu’il sache échanger des données. Cela demande un développement de votre côté ou du nôtre.',
      },
    ],
    related: [
      '/fonctionnalites/facturation-et-pesees',
      '/securite',
      '/metiers/recyclage',
      '/tarifs',
    ],
    ...DATES,
  },
]
