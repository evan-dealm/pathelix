import type { ContentPage } from './types'

const DATES = { published: '2026-10-07', updated: '2026-10-07' }

export const FONCTIONNALITES: ContentPage[] = [
  {
    kind: 'fonctionnalite',
    slug: 'optimisation-de-tournees',
    name: 'Optimisation de tournées',
    title: 'Optimisation de tournées pour les bennes et la collecte.',
    metaTitle: 'Optimisation de tournées de bennes et de collecte',
    description:
      'Pathélix calcule les tournées en tenant compte des priorités, créneaux, capacités des camions, exutoires, tailles de bennes, compétences et temps de conduite. Ré-optimisation en cours de journée.',
    answer:
      'Pathélix répartit les missions d’une journée entre les chauffeurs disponibles et ordonne chaque tournée en quelques secondes. Le calcul ne cherche pas seulement le trajet le plus court : il respecte les contraintes du métier, et explique ce qu’il n’a pas pu placer.',
    visual: 'clip-optimisation',
    sections: [
      {
        heading: 'Les contraintes prises en compte',
        table: {
          caption: 'Contraintes respectées par l’optimiseur de Pathélix',
          head: ['Contrainte', 'Ce que fait Pathélix'],
          rows: [
            ['Priorités', 'Une mission urgente est servie avant son échéance'],
            ['Créneaux clients', 'Chaque fenêtre horaire est tenue, ou le retard est signalé'],
            ['Capacité du camion', 'Passage à l’exutoire inséré quand le camion est plein'],
            ['Exutoires', 'Horaires, jours de fermeture et déchets acceptés'],
            ['Taille de benne', 'Une benne trop grande pour un camion ne lui est pas confiée'],
            ['Compétences', 'Permis, CACES, ADR : la mission va à un chauffeur habilité'],
            ['Dépendances', 'Une mission qui en attend une autre passe après elle'],
            ['Temps de conduite', 'Pauses et durées du règlement CE 561/2006 intégrées au calcul'],
            ['Charge utile', 'Vérifiée quand le poids est connu ou estimé'],
            ['Durée de travail', 'Journée de travail et pause déjeuner'],
          ],
        },
      },
      {
        heading: 'Ré-optimiser en cours de journée',
        paragraphs: [
          'Une urgence arrive à 10 h. La ré-optimisation part de la position réelle de chaque camion, conserve les arrêts déjà effectués et les étapes verrouillées, et recalcule le reste avec de nouvelles heures d’arrivée.',
          'Dès qu’une mission du jour est commencée, Pathélix refuse de tout recalculer depuis zéro et propose ce mode à la place : le travail fait n’est jamais remis en cause.',
        ],
      },
      {
        heading: 'Vous gardez la main',
        points: [
          'Glisser-déposer d’une mission d’un chauffeur à un autre',
          'Verrouillage d’une étape',
          'Reséquencement d’une seule tournée, redistribution entre chauffeurs',
          'Annuler et rétablir',
          'Pondérations réglables : distance, ponctualité, équilibre de charge, stabilité',
        ],
      },
      {
        heading: 'Ce que l’optimiseur n’a pas pu faire, il le dit',
        paragraphs: [
          'Une mission reste sans chauffeur ? Pathélix indique la raison : capacité, horaire, benne trop grande pour les camions disponibles, compétence manquante, poids au-delà de la charge utile.',
        ],
      },
      {
        heading: 'Des temps de trajet réalistes',
        paragraphs: [
          'Les distances viennent d’un moteur de routage poids-lourd qui tient compte du gabarit des véhicules. Les durées réelles relevées sur le terrain servent ensuite à corriger les estimations, par organisation, par chauffeur et par site.',
        ],
      },
    ],
    questions: [
      {
        question: 'Combien de temps prend un calcul ?',
        answer:
          'Quelques secondes pour une journée. Le calcul tourne en arrière-plan et le résultat s’affiche dès qu’il est prêt.',
      },
      {
        question: 'Pathélix garantit-il le respect du règlement CE 561/2006 ?',
        answer:
          'Non. Il intègre les pauses et les durées du règlement dans le calcul, ce qui évite de planifier une journée intenable. Le contrôle réglementaire reste celui du chronotachygraphe. Limite connue : un arrêt de déchargement à l’exutoire est compté comme une coupure de conduite.',
      },
      {
        question: 'Peut-on optimiser plusieurs jours à la fois ?',
        answer: 'Oui, le planning semaine optimise sur plusieurs jours.',
      },
    ],
    related: [
      '/fonctionnalites/planning-chauffeurs',
      '/guides/reduire-les-kilometres-a-vide',
      '/guides/temps-de-conduite-en-collecte',
      '/comparatifs/logiciel-metier-ou-optimiseur-generaliste',
    ],
    ...DATES,
  },
  {
    kind: 'fonctionnalite',
    slug: 'application-chauffeur',
    name: 'Application chauffeur',
    title: 'Application chauffeur, utilisable sans réseau.',
    metaTitle: 'Application chauffeur hors ligne pour bennes et collecte',
    description:
      'L’application chauffeur de Pathélix affiche la tournée du jour et enregistre statuts, photos, signature, pesée et incidents, même sans réseau. Synchronisation automatique, sans doublon.',
    answer:
      'L’application chauffeur de Pathélix s’ouvre dans le navigateur du téléphone, sans installation depuis un magasin d’applications. Elle affiche la tournée du jour et enregistre tout ce que fait le chauffeur, même sans réseau : les actions sont gardées sur le téléphone puis envoyées au retour de la connexion, une seule fois.',
    visual: 'clip-terrain',
    sections: [
      {
        heading: 'Ce que voit le chauffeur',
        points: [
          'Sa tournée du jour, dans l’ordre, avec les heures d’arrivée prévues',
          'Les missions urgentes mises en évidence',
          'Pour chaque arrêt : client, adresse, créneau, déchet, taille de benne',
          'Un bouton pour ouvrir l’itinéraire dans son application de navigation',
        ],
      },
      {
        heading: 'Ce qu’il enregistre',
        table: {
          caption: 'Actions disponibles dans l’application chauffeur',
          head: ['Action', 'Détail'],
          rows: [
            ['Statut', 'En route, sur place, terminé'],
            ['Photos', 'Prises sur place et rattachées à la mission'],
            ['Signature', 'Signée par le client sur l’écran'],
            ['Pesée', 'Poids du ticket saisi par le chauffeur'],
            ['Benne', 'Scan du QR code de la benne'],
            ['Incident', 'Signalement avec commentaire'],
            ['Véhicule', 'Contrôle du véhicule et défauts constatés'],
          ],
        },
      },
      {
        heading: 'Sans réseau, rien n’est perdu',
        paragraphs: [
          'Sous un hangar, en sous-sol ou en zone blanche, l’application continue de fonctionner. Chaque action est mise en file sur le téléphone avec un identifiant unique. Au retour du réseau, elle est envoyée ; si l’envoi est répété, le serveur reconnaît l’identifiant et ne crée pas de doublon.',
        ],
      },
      {
        heading: 'Ce que voit l’exploitation',
        paragraphs: [
          'Chaque statut remonte en direct sur le tableau de bord. La position GPS du téléphone est transmise toutes les trente secondes pendant la tournée et s’affiche sur la carte.',
        ],
      },
    ],
    questions: [
      {
        question: 'Faut-il installer une application ?',
        answer:
          'Non. Le chauffeur ouvre un lien et se connecte. L’application peut être ajoutée à l’écran d’accueil du téléphone.',
      },
      {
        question: 'Un chauffeur voit-il les tournées des autres ?',
        answer:
          'Non. Un compte chauffeur n’accède qu’à sa propre tournée ; tout le reste lui est refusé par défaut.',
      },
      {
        question: 'Fonctionne-t-elle sur Android et sur iPhone ?',
        answer:
          'Elle fonctionne dans le navigateur des deux systèmes. Les notifications dépendent de ce que le navigateur du téléphone autorise.',
      },
    ],
    related: [
      '/fonctionnalites/parc-de-bennes',
      '/fonctionnalites/optimisation-de-tournees',
      '/metiers/collecte-de-dechets',
      '/securite',
    ],
    ...DATES,
  },
  {
    kind: 'fonctionnalite',
    slug: 'parc-de-bennes',
    name: 'Parc de bennes',
    title: 'Suivi du parc de bennes par QR code.',
    metaTitle: 'Suivi de parc de bennes par QR code',
    description:
      'Pathélix suit chaque benne : numéro, type, QR code, état, emplacement et historique des mouvements. Le chauffeur confirme la benne par un scan.',
    answer:
      'Pathélix tient l’inventaire de vos bennes et sait où se trouve chacune. Chaque benne porte un numéro et un QR code ; son état change au fil des missions et des scans des chauffeurs, et chaque mouvement est conservé.',
    sections: [
      {
        heading: 'Une fiche par benne',
        points: [
          'Numéro peint sur la benne, unique dans votre parc',
          'Type et volume',
          'QR code à imprimer et à coller',
          'Emplacement actuel : dépôt, client, camion, exutoire',
        ],
      },
      {
        heading: 'Les états d’une benne',
        table: {
          caption: 'États possibles d’une benne dans Pathélix',
          head: ['État', 'Signification'],
          rows: [
            ['Disponible', 'Au dépôt, vide, utilisable'],
            ['Réservée', 'Affectée à une pose planifiée'],
            ['En transit', 'Sur un camion'],
            ['Chez le client', 'Posée'],
            ['Pleine', 'Chez le client, signalée pleine'],
            ['À retirer', 'Retrait demandé'],
            ['À l’exutoire', 'Laissée à l’exutoire'],
            ['En maintenance', 'En réparation'],
            ['Immobilisée', 'Hors service'],
            ['Perdue', 'Introuvable'],
          ],
        },
      },
      {
        heading: 'Le scan du chauffeur',
        paragraphs: [
          'Sur place, le chauffeur scanne le QR code avec son téléphone. La benne réellement posée ou enlevée est ainsi rattachée à la mission, sans recopier un numéro.',
          'Quelqu’un qui scanne le code avec un autre téléphone ne voit que le numéro de la benne et son propriétaire.',
        ],
      },
      {
        heading: 'L’historique',
        paragraphs: [
          'Chaque mouvement, changement d’état ou scan est enregistré avec son auteur, son lieu et la mission concernée. Une carte montre où se trouve le parc.',
        ],
      },
    ],
    questions: [
      {
        question: 'Faut-il des balises GPS sur les bennes ?',
        answer:
          'Non. L’emplacement d’une benne est déduit des missions et des scans. Pathélix ne lit pas de balise posée sur la benne.',
      },
      {
        question: 'Peut-on gérer d’autres contenants que des bennes ?',
        answer: 'Oui, les types de contenants se définissent librement avec leur volume.',
      },
    ],
    related: [
      '/metiers/location-de-bennes',
      '/guides/organiser-les-rotations-de-bennes',
      '/fonctionnalites/application-chauffeur',
      '/fonctionnalites/portail-client',
    ],
    ...DATES,
  },
  {
    kind: 'fonctionnalite',
    slug: 'facturation-et-pesees',
    name: 'Facturation et pesées',
    title: 'Du devis au paiement, sans ressaisie.',
    metaTitle: 'Devis, factures et pesées pour bennes et collecte',
    description:
      'Dans Pathélix, le devis accepté devient commande, la commande crée ses missions, et ce qui a été réalisé sur le terrain devient ligne de facture. Avoirs, paiements, export comptable.',
    answer:
      'Pathélix relie la vente, l’exploitation et la facturation. Le devis accepté devient une commande, la commande crée ses missions, et les prestations réalisées — avec leurs pesées — deviennent des lignes de facture. Personne ne ressaisit.',
    sections: [
      {
        heading: 'La chaîne, étape par étape',
        table: {
          caption: 'Du devis au paiement dans Pathélix',
          head: ['Étape', 'Ce qui se passe'],
          rows: [
            ['Devis', 'Chiffré depuis vos grilles tarifaires, envoyé en PDF par e-mail'],
            ['Commande', 'Le devis accepté est converti en commande'],
            ['Mission', 'La commande crée les missions à planifier'],
            ['Exécution', 'Preuves, horaires et pesées remontent du terrain'],
            ['Facture', 'Les prestations réalisées deviennent des lignes de facture'],
            ['Paiement', 'Règlements enregistrés et rapprochés, soldes à jour'],
          ],
        },
      },
      {
        heading: 'Tarifs',
        points: ['Grilles tarifaires', 'Règles de prix', 'Contrats'],
      },
      {
        heading: 'Factures et avoirs',
        paragraphs: [
          'Une facture se prépare en brouillon puis s’émet avec un numéro. Un avoir corrige une facture émise. Les paiements reçus — virement, chèque, carte, espèces, prélèvement — sont enregistrés et rattachés aux factures.',
          'Pathélix n’encaisse pas en ligne : il enregistre les règlements que vous recevez.',
        ],
      },
      {
        heading: 'Vers la comptabilité',
        points: [
          'Export des écritures comptables',
          'Envoi vers Sage ou SAP à la fin d’une mission',
          'API pour les factures et les paiements',
        ],
      },
    ],
    questions: [
      {
        question: 'Puis-je garder mon logiciel de facturation actuel ?',
        answer:
          'Oui. Pathélix peut se limiter à la planification et au terrain, et transmettre ce qui a été réalisé à votre outil par export, API ou connecteur.',
      },
      {
        question: 'Les pesées sont-elles reprises sur la facture ?',
        answer:
          'Oui, les pesées enregistrées sont rattachées aux missions et utilisées pour la facturation.',
      },
    ],
    related: [
      '/comparatifs/pathelix-et-votre-erp',
      '/fonctionnalites/portail-client',
      '/metiers/recyclage',
      '/tarifs',
    ],
    ...DATES,
  },
  {
    kind: 'fonctionnalite',
    slug: 'portail-client',
    name: 'Portail client',
    title: 'Un portail pour vos clients.',
    metaTitle: 'Portail client pour loueurs de bennes et collecteurs',
    description:
      'Avec le portail client de Pathélix, vos clients demandent une rotation ou un enlèvement, suivent leurs interventions et retrouvent devis, factures et documents.',
    answer:
      'Le portail client de Pathélix donne à vos clients un espace à eux. Ils y demandent une rotation, un enlèvement ou une benne supplémentaire, suivent leurs interventions et retrouvent leurs devis, factures et documents. Vous validez chaque demande.',
    sections: [
      {
        heading: 'Ce que le client peut faire',
        points: [
          'Demander une rotation, un enlèvement ou une nouvelle benne',
          'Signaler un problème',
          'Suivre ses interventions',
          'Consulter ses devis, ses factures et ses documents',
        ],
      },
      {
        heading: 'Ce que vous gardez',
        paragraphs: [
          'Une demande n’est pas une mission tant que vous ne l’avez pas acceptée. Vous l’acceptez, la refusez ou y répondez ; acceptée, elle devient une mission à planifier.',
          'Vous invitez les utilisateurs de chaque client et pouvez retirer un accès à tout moment.',
        ],
      },
      {
        heading: 'Un accès cloisonné',
        paragraphs: [
          'Le portail a sa propre session, distincte de celle de l’application. Un client ne voit que ses propres données.',
        ],
      },
      {
        heading: 'Sans compte : le lien de suivi',
        paragraphs: [
          'Pour une intervention précise, vous pouvez envoyer un lien de suivi. Il ne demande pas de compte, ne donne accès qu’à cette intervention et expire.',
        ],
      },
    ],
    questions: [
      {
        question: 'Le client peut-il payer en ligne ?',
        answer: 'Non. Il consulte ses factures ; le paiement en ligne n’existe pas à ce jour.',
      },
    ],
    related: [
      '/fonctionnalites/facturation-et-pesees',
      '/fonctionnalites/parc-de-bennes',
      '/metiers/location-de-bennes',
      '/securite',
    ],
    ...DATES,
  },
  {
    kind: 'fonctionnalite',
    slug: 'planning-chauffeurs',
    name: 'Planning chauffeurs',
    title: 'Planning des chauffeurs et des camions.',
    metaTitle: 'Planning chauffeurs et camions pour bennes et collecte',
    description:
      'Le planning de Pathélix montre la journée de chaque chauffeur en diagramme de Gantt, gère les indisponibilités, les camions et les exutoires, et se planifie à la semaine.',
    answer:
      'Le planning de Pathélix affiche la journée de chaque chauffeur heure par heure, mission par mission. Il tient compte des indisponibilités, du camion affecté et de ses capacités, et se prépare à la journée ou à la semaine.',
    visual: 'planning',
    sections: [
      {
        heading: 'Une ligne par chauffeur',
        paragraphs: [
          'Le planning se lit comme un diagramme de Gantt : un bloc par mission, de la couleur de son type, les trajets entre les deux. La durée totale et les kilomètres de chaque tournée sont affichés.',
        ],
      },
      {
        heading: 'Les ressources',
        table: {
          caption: 'Ce que Pathélix sait de vos ressources',
          head: ['Ressource', 'Informations tenues'],
          rows: [
            ['Chauffeurs', 'Compétences, dépôt de rattachement, indisponibilités, heures'],
            [
              'Camions',
              'Gabarit, capacité en bennes ou en m³, entretiens, carburant, immobilisations',
            ],
            ['Exutoires', 'Horaires, jours de fermeture, déchets acceptés, temps de service'],
          ],
        },
      },
      {
        heading: 'À la semaine',
        paragraphs: [
          'Le planning semaine répartit les missions sur plusieurs jours. Les missions récurrentes sont générées d’avance à partir de leurs modèles, les jours fériés sont pris en compte.',
        ],
      },
      {
        heading: 'Le jour même',
        points: [
          'Avancement de chaque chauffeur en direct',
          'Alertes : mission sans chauffeur, mission sans coordonnées',
          'Notes de planning partagées entre exploitants',
          'Feuilles de route en PDF et CSV',
        ],
      },
    ],
    questions: [
      {
        question: 'Peut-on affecter une mission à la main ?',
        answer:
          'Oui. L’optimisation propose, vous disposez : une mission se déplace à la souris d’un chauffeur à un autre, et une étape peut être verrouillée.',
      },
    ],
    related: [
      '/fonctionnalites/optimisation-de-tournees',
      '/fonctionnalites/application-chauffeur',
      '/metiers/collecte-de-dechets',
      '/guides/temps-de-conduite-en-collecte',
    ],
    ...DATES,
  },
]
