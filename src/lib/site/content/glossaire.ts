/** Vocabulary of skip-bin and waste-collection operations, in plain words. */
export interface GlossaryTerm {
  id: string
  term: string
  definition: string
  /** Page that goes further, when there is one. */
  more?: string
}

export const GLOSSAIRE: GlossaryTerm[] = [
  {
    id: 'adr',
    term: 'ADR',
    definition:
      'Accord européen relatif au transport international des marchandises dangereuses par route. Par extension, la formation et l’attestation exigées du chauffeur qui transporte ces matières.',
  },
  {
    id: 'ampliroll',
    term: 'Ampliroll',
    definition:
      'Système de bras hydraulique à crochet qui permet à un camion de charger et de déposer une benne. Le mot désigne aussi, par usage, le camion et la benne correspondants.',
  },
  {
    id: 'bsd',
    term: 'BSD (bordereau de suivi de déchets)',
    definition:
      'Document qui accompagne certains déchets, notamment dangereux, du producteur jusqu’à l’installation de traitement, et que chaque intervenant signe.',
  },
  {
    id: 'caces',
    term: 'CACES',
    definition:
      'Certificat d’aptitude à la conduite en sécurité. Il atteste qu’une personne a été formée à la conduite d’une catégorie d’engins, par exemple une grue auxiliaire.',
  },
  {
    id: 'charge-utile',
    term: 'Charge utile',
    definition:
      'Poids maximal qu’un véhicule peut transporter : son PTAC moins son poids à vide. Pour les gravats ou la terre, elle est atteinte bien avant que la benne soit pleine en volume.',
    more: '/fonctionnalites/optimisation-de-tournees',
  },
  {
    id: 'chronotachygraphe',
    term: 'Chronotachygraphe',
    definition:
      'Appareil embarqué qui enregistre les temps de conduite, de travail et de repos du chauffeur. C’est lui qui fait foi lors d’un contrôle.',
    more: '/guides/temps-de-conduite-en-collecte',
  },
  {
    id: 'depot',
    term: 'Dépôt',
    definition:
      'Site d’où partent et où reviennent les camions, et où sont stockées les bennes vides. Une exploitation peut en avoir plusieurs.',
  },
  {
    id: 'dib',
    term: 'DIB (déchets industriels banals)',
    definition:
      'Déchets non dangereux et non inertes produits par les entreprises : bois, cartons, plastiques, emballages. On parle aussi de déchets d’activités économiques non dangereux.',
  },
  {
    id: 'enlevement',
    term: 'Enlèvement',
    definition:
      'Intervention qui consiste à reprendre une benne chez un client sans en laisser une autre. On dit aussi retrait.',
  },
  {
    id: 'exutoire',
    term: 'Exutoire',
    definition:
      'Lieu où le camion vide sa benne : déchetterie professionnelle, centre de tri, installation de stockage, plateforme de recyclage. Chaque exutoire a ses horaires et n’accepte que certains déchets.',
    more: '/guides/organiser-les-rotations-de-bennes',
  },
  {
    id: 'fenetre-horaire',
    term: 'Fenêtre horaire',
    definition:
      'Plage pendant laquelle une intervention doit avoir lieu, fixée par le client ou par les horaires d’un site. On dit aussi créneau.',
  },
  {
    id: 'gravats',
    term: 'Gravats (déchets inertes)',
    definition:
      'Déchets minéraux issus de chantiers — béton, briques, tuiles, terre — qui ne se décomposent pas et ne brûlent pas. Ils sont lourds : le poids limite le chargement avant le volume.',
  },
  {
    id: 'kilometres-a-vide',
    term: 'Kilomètres à vide',
    definition:
      'Distance parcourue par un camion sans benne ou avec une benne vide, sans prestation facturable. Les réduire est le premier levier d’économie d’une exploitation.',
    more: '/guides/reduire-les-kilometres-a-vide',
  },
  {
    id: 'mission',
    term: 'Mission',
    definition:
      'Dans Pathélix, une intervention à réaliser chez un client : son type, son adresse, son créneau, sa priorité, le déchet et la benne concernés.',
    more: '/produit',
  },
  {
    id: 'pesee',
    term: 'Pesée',
    definition:
      'Mesure du poids d’un chargement, généralement sur un pont-bascule à l’entrée de l’exutoire, qui donne lieu à un ticket. Elle sert à facturer le traitement et à justifier les quantités.',
    more: '/fonctionnalites/facturation-et-pesees',
  },
  {
    id: 'pose',
    term: 'Pose',
    definition: 'Intervention qui consiste à déposer une benne vide chez un client.',
  },
  {
    id: 'ptac',
    term: 'PTAC',
    definition:
      'Poids total autorisé en charge : poids maximal que peut atteindre un véhicule chargé, inscrit sur sa carte grise. Le dépasser est une infraction.',
  },
  {
    id: 'rotation',
    term: 'Rotation',
    definition:
      'Échange d’une benne pleine contre une benne vide chez un client. La benne pleine part ensuite à l’exutoire.',
    more: '/guides/organiser-les-rotations-de-bennes',
  },
  {
    id: 'tournee',
    term: 'Tournée',
    definition:
      'Suite ordonnée des interventions d’un chauffeur pour une journée, passages à l’exutoire et pauses compris.',
    more: '/fonctionnalites/optimisation-de-tournees',
  },
  {
    id: 'trackdechets',
    term: 'Trackdéchets',
    definition:
      'Service public numérique français de traçabilité des déchets, sur lequel sont établis et signés les bordereaux de suivi dématérialisés.',
  },
]
