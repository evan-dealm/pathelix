import type { ContentPage } from './types'

const DATES = { published: '2026-10-07', updated: '2026-10-07' }

export const METIERS: ContentPage[] = [
  {
    kind: 'metier',
    slug: 'location-de-bennes',
    name: 'Location de bennes',
    title: 'Logiciel de gestion pour la location de bennes.',
    metaTitle: 'Logiciel de location de bennes : planning, tournées, parc, facturation',
    description:
      'Pathélix est un logiciel pour les loueurs de bennes : missions de pose, rotation et enlèvement, tournées optimisées, suivi du parc par QR code, application chauffeur hors ligne, devis et factures.',
    answer:
      'Pathélix est un logiciel de gestion pour les loueurs de bennes. Il planifie les poses, les rotations et les enlèvements, calcule les tournées en tenant compte des passages à l’exutoire, suit chaque benne du parc et relie le tout à la facturation. Il a été conçu d’abord pour ce métier.',
    visual: 'tournees',
    sections: [
      {
        heading: 'Ce que le métier de la benne a de particulier',
        paragraphs: [
          'Une benne posée n’est pas une livraison terminée : elle devra être échangée ou retirée. Une benne pleine ne peut pas enchaîner sur le chantier suivant : elle passe d’abord à l’exutoire, qui a ses horaires et n’accepte pas tous les déchets. Et un camion ne transporte pas n’importe quelle taille de benne.',
          'Un logiciel de tournées généraliste ignore ces règles. Pathélix les applique au moment du calcul, pas après.',
        ],
      },
      {
        heading: 'Du coup de téléphone à la tournée',
        paragraphs: [
          'Chaque demande devient une mission : type d’intervention, client, adresse géolocalisée, créneau, priorité, déchet, taille de benne, durée sur place. Vous lancez l’optimisation de la journée ; chaque chauffeur reçoit sa tournée sur son téléphone.',
        ],
        points: [
          'Pose, enlèvement, rotation, chargement immédiat, déplacement : huit types d’intervention',
          'Passage à l’exutoire inséré quand le camion est plein, ou après la dernière benne',
          'Taille de benne vérifiée avec le camion qui la transporte',
          'Urgences servies avant leur échéance',
          'Ré-optimisation en cours de journée, sans défaire ce qui est fait',
        ],
      },
      {
        heading: 'Savoir où est chaque benne',
        paragraphs: [
          'Chaque benne a un numéro, un type et un QR code à imprimer. Son état suit les missions et les scans des chauffeurs : disponible, réservée, sur un camion, chez un client, pleine, à retirer, à l’exutoire, en maintenance. L’historique garde chaque mouvement.',
        ],
      },
      {
        heading: 'Ce que Pathélix couvre pour un loueur de bennes',
        table: {
          caption: 'Fonctions de Pathélix pour la location de bennes',
          head: ['Besoin', 'Dans Pathélix'],
          rows: [
            [
              'Prendre les demandes',
              'Missions, import CSV, réception depuis un ERP, portail client',
            ],
            ['Planifier', 'Planning jour et semaine, optimisation des tournées'],
            ['Exécuter', 'Application chauffeur hors ligne : statuts, photos, signature, pesée'],
            ['Suivre les bennes', 'Parc de bennes, QR code, historique des mouvements'],
            ['Facturer', 'Devis, commandes, contrats, factures, avoirs, paiements'],
            ['Piloter', 'Statistiques, coûts par tournée, rapport mensuel'],
          ],
        },
      },
    ],
    questions: [
      {
        question: 'Mes clients peuvent-ils demander une rotation eux-mêmes ?',
        answer:
          'Oui. Depuis leur portail, vos clients demandent une rotation, un enlèvement ou une benne supplémentaire. Chaque demande passe par votre validation avant de devenir une mission.',
      },
      {
        question: 'Pathélix gère-t-il plusieurs dépôts ?',
        answer: 'Oui. Chaque chauffeur est rattaché à son dépôt et sa tournée en part.',
      },
      {
        question: 'Faut-il un boîtier dans chaque camion ?',
        answer:
          'Non. L’application chauffeur transmet la position depuis le téléphone. Si vos camions ont déjà des boîtiers Geotab, Samsara ou OBD, leurs positions peuvent être reçues aussi.',
      },
    ],
    related: [
      '/fonctionnalites/parc-de-bennes',
      '/fonctionnalites/optimisation-de-tournees',
      '/guides/organiser-les-rotations-de-bennes',
      '/comparatifs/pathelix-ou-excel',
    ],
    ...DATES,
  },
  {
    kind: 'metier',
    slug: 'collecte-de-dechets',
    name: 'Collecte de déchets',
    title: 'Logiciel de gestion pour la collecte de déchets.',
    metaTitle: 'Logiciel de collecte de déchets : tournées, planning chauffeurs, terrain',
    description:
      'Pathélix organise la collecte de déchets des entreprises : missions récurrentes, planning des chauffeurs, optimisation des tournées avec les exutoires, application chauffeur hors ligne, preuves de passage.',
    answer:
      'Pathélix est un logiciel de gestion pour les entreprises de collecte de déchets. Il génère les passages réguliers, construit les tournées des chauffeurs en tenant compte des exutoires et des créneaux, et remonte du terrain les preuves de passage et les poids.',
    visual: 'planning',
    sections: [
      {
        heading: 'Des passages réguliers, sans ressaisie',
        paragraphs: [
          'Une grande partie de la collecte se répète. Dans Pathélix, un modèle de mission génère automatiquement les passages à venir. Les demandes ponctuelles s’ajoutent au même pool, et l’ensemble est planifié d’un seul geste.',
        ],
        points: [
          'Modèles de missions récurrentes',
          'Planning à la journée et à la semaine',
          'Indisponibilités des chauffeurs et des véhicules, jours fériés',
        ],
      },
      {
        heading: 'Une tournée qui tient compte de l’exutoire',
        paragraphs: [
          'Le camion a une capacité. Quand elle est atteinte, il faut vider, dans un exutoire ouvert qui accepte le déchet transporté. Pathélix place ce passage dans la tournée, au moment où il coûte le moins.',
          'Le calcul tient compte aussi des créneaux des clients, des priorités, des compétences requises et des temps de conduite.',
        ],
      },
      {
        heading: 'Quand la journée change',
        paragraphs: [
          'Un client appelle pour une collecte urgente, un chauffeur prend du retard. La ré-optimisation en cours de journée repart de la position réelle des camions, garde les arrêts déjà faits et recalcule la suite avec de nouvelles heures d’arrivée.',
        ],
      },
      {
        heading: 'Les preuves viennent du terrain',
        points: [
          'Statut de chaque arrêt : en route, sur place, terminé',
          'Photos et signature du client',
          'Poids du ticket de pesée',
          'Signalement d’un incident',
          'Tout fonctionne sans réseau et se synchronise ensuite',
        ],
      },
    ],
    questions: [
      {
        question: 'Pathélix convient-il à la collecte en porte-à-porte des ménages ?',
        answer:
          'Pathélix a été conçu pour la collecte auprès des professionnels et la gestion de bennes : des missions à une adresse, avec un créneau et un déchet. Il n’a pas été pensé pour les circuits de collecte des ordures ménagères rue par rue.',
      },
      {
        question: 'Les temps de conduite sont-ils pris en compte ?',
        answer:
          'Oui, les pauses et durées du règlement CE 561/2006 entrent dans le calcul des tournées. Pathélix ne remplace pas le chronotachygraphe, qui reste la référence du contrôle.',
      },
    ],
    related: [
      '/fonctionnalites/planning-chauffeurs',
      '/fonctionnalites/application-chauffeur',
      '/guides/temps-de-conduite-en-collecte',
      '/guides/reduire-les-kilometres-a-vide',
    ],
    ...DATES,
  },
  {
    kind: 'metier',
    slug: 'recyclage',
    name: 'Recyclage',
    title: 'Logiciel pour les entreprises de recyclage.',
    metaTitle: 'Logiciel de recyclage : collecte, pesées, matières, facturation',
    description:
      'Pathélix aide les entreprises de recyclage à organiser leurs collectes, enregistrer les pesées par matière, garder les preuves et facturer ce qui a été réalisé.',
    answer:
      'Pathélix est un logiciel d’exploitation pour les entreprises de recyclage qui collectent chez leurs clients. Il planifie les enlèvements, enregistre les pesées et les matières, garde les preuves du terrain et alimente la facturation.',
    visual: 'statistiques',
    sections: [
      {
        heading: 'Des matières et des poids',
        paragraphs: [
          'Dans le recyclage, ce qui compte est ce qui a été collecté : quelle matière, quel poids, chez qui. Pathélix tient un catalogue de matières, porte le type de déchet sur chaque mission et enregistre les pesées, saisies par le chauffeur à partir du ticket.',
        ],
        points: [
          'Catalogue de matières',
          'Pesées rattachées aux missions',
          'Poids utilisés pour vérifier la charge utile du camion quand ils sont connus ou estimés',
          'Pesées reprises dans la facturation',
        ],
      },
      {
        heading: 'Collecter chez les clients',
        paragraphs: [
          'Les enlèvements se planifient comme le reste : missions, créneaux, priorités, tournées optimisées. Les bennes et contenants posés chez les clients sont suivis par numéro et QR code.',
        ],
      },
      {
        heading: 'Preuves et traçabilité',
        points: [
          'Photos et signature du client à chaque intervention',
          'Documents rattachés aux clients et aux missions',
          'Journal d’audit de qui a fait quoi',
          'Export des données en CSV et Excel, API pour vos outils',
        ],
        paragraphs: [
          'Le connecteur Trackdéchets (bordereaux et signatures) est en cours de validation. Il n’est pas ouvert en production à ce jour.',
        ],
      },
      {
        heading: 'Voir l’activité',
        paragraphs: [
          'Les statistiques reprennent ce que le terrain a fait : missions, kilomètres, durées, performance par chauffeur et par secteur. Le rapport mensuel sort en PDF et un bilan CO₂ se calcule à la demande.',
        ],
      },
    ],
    questions: [
      {
        question: 'Pathélix gère-t-il le pont-bascule ?',
        answer:
          'Pathélix enregistre les pesées et les rattache aux missions et à la facturation. Le poids est saisi par le chauffeur à partir du ticket. La connexion directe à un pont-bascule n’existe pas à ce jour.',
      },
      {
        question: 'Peut-on récupérer les données dans un autre outil ?',
        answer:
          'Oui : export CSV et Excel, API REST avec des clés aux droits limités, webhooks sortants, et un flux d’indicateurs pour Power BI.',
      },
    ],
    related: [
      '/fonctionnalites/facturation-et-pesees',
      '/fonctionnalites/parc-de-bennes',
      '/guides/cout-d-une-tournee',
      '/comparatifs/pathelix-et-votre-erp',
    ],
    ...DATES,
  },
]
