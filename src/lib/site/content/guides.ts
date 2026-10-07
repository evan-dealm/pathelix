import type { ContentPage } from './types'

const DATES = { published: '2026-10-07', updated: '2026-10-07' }

export const GUIDES: ContentPage[] = [
  {
    kind: 'guide',
    slug: 'organiser-les-rotations-de-bennes',
    name: 'Organiser les rotations de bennes',
    title: 'Comment organiser les rotations de bennes.',
    metaTitle: 'Comment organiser les rotations de bennes',
    description:
      'Méthode pour organiser les rotations de bennes : qualifier la demande, regrouper par exutoire, tenir compte de la capacité des camions, garder de la marge pour les urgences.',
    answer:
      'Organiser les rotations, c’est décider chaque jour quelle benne est échangée par quel camion, et quand ce camion va vider. La méthode tient en quatre gestes : qualifier chaque demande, raisonner par exutoire, respecter la capacité des camions, garder de la place pour l’imprévu.',
    sections: [
      {
        heading: '1. Qualifier la demande au moment où elle arrive',
        paragraphs: [
          'Une rotation mal qualifiée se paie sur la route. À la prise de demande, il faut cinq informations.',
        ],
        points: [
          'Le type exact : pose, enlèvement, ou échange d’une pleine contre une vide',
          'La taille de la benne',
          'Le déchet : il détermine l’exutoire possible',
          'Le créneau du client, s’il en a un',
          'Les conditions d’accès au site',
        ],
      },
      {
        heading: '2. Raisonner par exutoire',
        paragraphs: [
          'Le passage à l’exutoire est l’étape la plus coûteuse d’une rotation. Deux enlèvements du même déchet, proches l’un de l’autre, gagnent à être vidés au même endroit dans la même tournée.',
          'Vérifiez les horaires avant de planifier : une benne enlevée à 11 h 30 pour un exutoire qui ferme à midi finit la journée sur le camion.',
        ],
      },
      {
        heading: '3. Respecter ce que porte le camion',
        points: [
          'Un camion porte un nombre limité de bennes : une fois plein, il doit vider avant de continuer',
          'Toutes les bennes ne vont pas sur tous les camions',
          'Le poids compte autant que le volume pour les gravats et la terre',
        ],
      },
      {
        heading: '4. Garder de la marge',
        paragraphs: [
          'Une journée remplie à 100 % le matin est en retard à 10 h. Les urgences arrivent toujours. Mieux vaut des tournées qui laissent de quoi absorber une ou deux demandes du jour.',
        ],
      },
      {
        heading: 'Les erreurs les plus fréquentes',
        table: {
          caption: 'Erreurs courantes dans l’organisation des rotations',
          head: ['Erreur', 'Conséquence'],
          rows: [
            ['Déchet non précisé', 'Benne refusée à l’exutoire'],
            ['Horaires de l’exutoire ignorés', 'Benne pleine qui reste sur le camion'],
            ['Benne affectée au mauvais camion', 'Aller-retour à vide'],
            ['Aucune trace de la benne posée', 'Benne « perdue » chez un client'],
            [
              'Plan refait entièrement à chaque imprévu',
              'Chauffeurs désorganisés, clients prévenus trop tard',
            ],
          ],
        },
      },
      {
        heading: 'Ce que fait un logiciel dans cette méthode',
        paragraphs: [
          'Il n’invente pas la méthode : il l’applique sans oubli. Dans Pathélix, la mission porte le type, la taille et le déchet ; le calcul insère le passage à l’exutoire en respectant ses horaires et ce qu’il accepte ; une benne incompatible avec un camion ne lui est pas donnée ; et une urgence se replanifie sans défaire les arrêts déjà faits.',
        ],
      },
    ],
    related: [
      '/metiers/location-de-bennes',
      '/fonctionnalites/parc-de-bennes',
      '/fonctionnalites/optimisation-de-tournees',
      '/guides/reduire-les-kilometres-a-vide',
    ],
    ...DATES,
  },
  {
    kind: 'guide',
    slug: 'cout-d-une-tournee',
    name: 'Calculer le coût d’une tournée',
    title: 'Comment calculer le coût d’une tournée de bennes.',
    metaTitle: 'Calculer le coût d’une tournée de bennes ou de collecte',
    description:
      'Les postes de coût d’une tournée de bennes ou de collecte — chauffeur, carburant, usure, péages, exutoire — et comment les ramener à la mission pour savoir ce qui est rentable.',
    answer:
      'Le coût d’une tournée est la somme de cinq postes : le temps du chauffeur, le carburant, l’usure du véhicule, les péages et le coût de traitement à l’exutoire. Le calcul n’a d’intérêt que ramené à la mission : c’est ce qui dit si une prestation est rentable.',
    sections: [
      {
        heading: 'Les cinq postes',
        table: {
          caption: 'Postes de coût d’une tournée',
          head: ['Poste', 'Dépend de', 'Où trouver la donnée'],
          rows: [
            ['Chauffeur', 'Durée de la tournée', 'Coût horaire chargé × heures'],
            ['Carburant', 'Kilomètres et consommation du camion', 'Relevés de carburant'],
            ['Usure', 'Kilomètres', 'Entretien et amortissement, par kilomètre'],
            ['Péages', 'Itinéraire', 'Factures de péage'],
            ['Exutoire', 'Poids et nature du déchet', 'Tarifs de l’exutoire, tickets de pesée'],
          ],
        },
      },
      {
        heading: 'La formule',
        paragraphs: [
          'Coût de la tournée = (heures × coût horaire) + (km × coût carburant au km) + (km × coût d’usure au km) + péages + traitement.',
          'Le coût au kilomètre du carburant se calcule à partir de la consommation réelle de chaque camion, pas d’une moyenne de flotte : un porteur chargé de gravats ne consomme pas comme un camion à vide.',
        ],
      },
      {
        heading: 'Ramener le coût à la mission',
        paragraphs: [
          'Diviser le coût de la tournée par le nombre de missions donne une moyenne trompeuse. Une mission à quarante kilomètres du dépôt coûte plus qu’une mission au coin de la rue.',
          'Une répartition plus juste affecte à chaque mission le temps passé sur place, le trajet pour s’y rendre et sa part du passage à l’exutoire.',
        ],
      },
      {
        heading: 'Ce qui fait dériver le coût',
        points: [
          'Les kilomètres à vide : retours au dépôt et passages à l’exutoire mal placés',
          'Les attentes : client absent, file à l’exutoire',
          'Les allers-retours causés par une information manquante',
          'Les tournées déséquilibrées, où un chauffeur finit tôt et un autre en heures supplémentaires',
        ],
      },
      {
        heading: 'Dans Pathélix',
        paragraphs: [
          'Pathélix affiche pour chaque tournée sa durée, ses kilomètres et un coût estimé qui additionne carburant, péages et usure. Les relevés de carburant et les entretiens se saisissent par véhicule. L’accès aux coûts est une permission à part : tous les utilisateurs ne les voient pas.',
          'Le coût du chauffeur et le coût de traitement à l’exutoire ne sont pas calculés par Pathélix à ce jour : ils restent à ajouter de votre côté.',
        ],
      },
    ],
    related: [
      '/guides/reduire-les-kilometres-a-vide',
      '/fonctionnalites/optimisation-de-tournees',
      '/fonctionnalites/facturation-et-pesees',
      '/metiers/recyclage',
    ],
    ...DATES,
  },
  {
    kind: 'guide',
    slug: 'temps-de-conduite-en-collecte',
    name: 'Temps de conduite en collecte',
    title: 'Temps de conduite et pauses : les règles à connaître pour planifier.',
    metaTitle: 'Temps de conduite CE 561/2006 : règles pour planifier bennes et collecte',
    description:
      'Rappel des règles du règlement CE 561/2006 utiles au planificateur — conduite continue, pause de 45 minutes, conduite journalière et hebdomadaire — et ce qu’un logiciel peut ou non garantir.',
    answer:
      'Pour les véhicules de plus de 3,5 tonnes, le règlement européen CE 561/2006 limite la conduite continue à 4 h 30, après quoi une pause de 45 minutes est due, et la conduite journalière à 9 heures. Un planning qui ignore ces règles produit des journées impossibles à tenir. Cette page résume ce qu’un planificateur doit avoir en tête ; elle ne remplace pas le texte ni un conseil juridique.',
    sections: [
      {
        heading: 'Les règles principales',
        table: {
          caption: 'Principales limites du règlement CE 561/2006',
          head: ['Règle', 'Limite'],
          rows: [
            ['Conduite continue', '4 h 30 au plus, puis pause'],
            ['Pause', '45 minutes, fractionnable en 15 puis 30 minutes'],
            ['Conduite journalière', '9 heures, 10 heures deux fois par semaine'],
            ['Conduite hebdomadaire', '56 heures au plus'],
            ['Conduite sur deux semaines', '90 heures au plus'],
            [
              'Repos journalier',
              '11 heures, réductible à 9 heures trois fois entre deux repos hebdomadaires',
            ],
          ],
        },
        paragraphs: [
          'Certaines activités peuvent relever de dérogations nationales. Vérifiez votre situation auprès de votre organisation professionnelle ou de l’administration compétente.',
        ],
      },
      {
        heading: 'Conduite n’est pas travail',
        paragraphs: [
          'Le temps passé à poser une benne, à attendre à l’exutoire ou à charger n’est pas de la conduite, mais c’est du temps de travail. Une tournée peut respecter les limites de conduite et dépasser la durée de travail. Les deux se planifient.',
        ],
      },
      {
        heading: 'Ce que cela change pour le planning',
        points: [
          'Une tournée longue doit prévoir la pause, et un endroit où la prendre',
          'Les arrêts courts ne remplacent pas la pause de 45 minutes',
          'Deux journées à 10 heures de conduite par semaine, pas plus',
          'Une urgence ajoutée en fin de journée peut faire dépasser une limite',
        ],
      },
      {
        heading: 'Ce qu’un logiciel peut faire, et ce qu’il ne peut pas',
        paragraphs: [
          'Un logiciel de planification peut intégrer ces limites dans son calcul et insérer les pauses, pour ne pas proposer une tournée intenable. Il ne peut pas garantir la conformité : il ne connaît que le plan, pas ce que le chauffeur a réellement conduit. Le chronotachygraphe reste la référence.',
          'Pathélix intègre les pauses et les durées du règlement dans le calcul des tournées, ainsi que la durée de travail et la pause déjeuner. Limite connue : un arrêt de déchargement à l’exutoire est compté comme une coupure de conduite, alors qu’un arrêt de quinze à vingt minutes n’équivaut pas à une pause de 45 minutes. Sur une tournée très longue avec plusieurs vidages, une pause peut donc être sous-estimée.',
        ],
      },
    ],
    related: [
      '/fonctionnalites/optimisation-de-tournees',
      '/fonctionnalites/planning-chauffeurs',
      '/metiers/collecte-de-dechets',
      '/guides/cout-d-une-tournee',
    ],
    ...DATES,
  },
  {
    kind: 'guide',
    slug: 'reduire-les-kilometres-a-vide',
    name: 'Réduire les kilomètres à vide',
    title: 'Comment réduire les kilomètres à vide.',
    metaTitle: 'Réduire les kilomètres à vide en bennes et en collecte',
    description:
      'D’où viennent les kilomètres à vide dans une exploitation de bennes ou de collecte, et six leviers concrets pour les réduire.',
    answer:
      'Les kilomètres à vide viennent de trois endroits : les retours au dépôt, les passages à l’exutoire mal placés et les allers-retours causés par une information manquante. On les réduit en enchaînant enlèvement et pose, en vidant au bon moment et au bon endroit, et en fiabilisant la prise de demande.',
    sections: [
      {
        heading: 'D’où viennent les kilomètres à vide',
        points: [
          'Le camion rentre au dépôt chercher une benne vide alors qu’il vient d’en vider une',
          'Il traverse le secteur pour un exutoire, puis revient là d’où il vient',
          'Il arrive chez un client absent, ou avec la mauvaise benne',
          'Deux chauffeurs se croisent sur le même secteur',
        ],
      },
      {
        heading: 'Six leviers',
        table: {
          caption: 'Leviers pour réduire les kilomètres à vide',
          head: ['Levier', 'Principe'],
          rows: [
            ['Enchaîner', 'La benne vidée repart directement sur une pose proche'],
            ['Vider au bon moment', 'Passer à l’exutoire quand le camion est plein, pas avant'],
            ['Choisir l’exutoire', 'Le plus proche qui accepte le déchet et qui est ouvert'],
            ['Sectoriser', 'Un chauffeur par zone, pour éviter les croisements'],
            ['Fiabiliser la demande', 'Taille, déchet et accès connus avant le départ'],
            ['Regrouper', 'Servir le même jour les demandes voisines qui peuvent attendre'],
          ],
        },
      },
      {
        heading: 'Mesurer avant d’agir',
        paragraphs: [
          'On ne réduit que ce qu’on mesure. Relevez pendant deux semaines les kilomètres de chaque tournée et le nombre de missions réalisées. Le rapport entre les deux, suivi dans le temps, dit si vos changements ont un effet.',
        ],
      },
      {
        heading: 'La limite de l’optimisation à la main',
        paragraphs: [
          'Avec six chauffeurs et quarante missions, le nombre de façons de répartir la journée dépasse ce qu’une personne peut comparer. Un bon planificateur trouve une solution correcte ; il ne peut pas vérifier qu’il n’en existe pas de meilleure, surtout quand le plan change à 10 h.',
        ],
      },
      {
        heading: 'Dans Pathélix',
        paragraphs: [
          'Le calcul des tournées place les passages à l’exutoire là où ils coûtent le moins, choisit un exutoire ouvert qui accepte le déchet, et équilibre la charge entre chauffeurs. Les kilomètres de chaque tournée sont affichés, et les statistiques suivent les kilomètres par jour.',
          'Pathélix n’annonce pas de pourcentage de gain : il dépend de votre point de départ.',
        ],
      },
    ],
    related: [
      '/fonctionnalites/optimisation-de-tournees',
      '/guides/cout-d-une-tournee',
      '/guides/organiser-les-rotations-de-bennes',
      '/comparatifs/logiciel-metier-ou-optimiseur-generaliste',
    ],
    ...DATES,
  },
]
