/** Questions a prospect actually asks. Every answer is checked against the product's behaviour. */
export interface FaqEntry {
  question: string
  answer: string
}

export const FAQ: FaqEntry[] = [
  {
    question: 'Pathélix remplace-t-il mon logiciel actuel ?',
    answer:
      'Pas forcément. Pathélix peut couvrir toute la chaîne, du devis à la facture, ou se concentrer sur la planification et le terrain : il reçoit alors les missions de votre logiciel de gestion et lui renvoie ce qui a été réalisé. Le périmètre se décide pendant la démonstration, à partir de vos outils.',
  },
  {
    question: 'Comment fonctionne l’optimisation ?',
    answer:
      'Vous lancez le calcul pour une journée. Pathélix répartit les missions entre les chauffeurs disponibles et ordonne chaque tournée en respectant priorités, créneaux, capacité des camions, exutoires, compétences et temps de conduite. Le résultat arrive en quelques secondes, avec les missions qu’il n’a pas pu placer et la raison. Vous ajustez ensuite ce que vous voulez à la main.',
  },
  {
    question: 'Que se passe-t-il quand un chauffeur n’a plus de réseau ?',
    answer:
      'L’application continue de fonctionner. Statuts, photos, signatures et poids sont enregistrés sur le téléphone, puis envoyés au retour de la connexion. Un envoi répété ne crée pas de doublon.',
  },
  {
    question: 'Pathélix gère-t-il plusieurs dépôts ?',
    answer:
      'Oui. Chaque chauffeur est rattaché à son dépôt, et sa tournée en part. Les indisponibilités des chauffeurs et des véhicules sont prises en compte dans le planning.',
  },
  {
    question: 'Les temps de conduite sont-ils garantis conformes ?',
    answer:
      'Pathélix intègre les pauses et les durées du règlement CE 561/2006 dans le calcul des tournées, ce qui évite de planifier une journée intenable. Il ne remplace pas le chronotachygraphe, qui reste la référence du contrôle.',
  },
  {
    question: 'Pathélix est-il connecté à Trackdéchets ?',
    answer:
      'Le connecteur Trackdéchets (bordereaux et signatures) est développé et en cours de validation. Il n’est pas ouvert en production à ce jour ; nous vous dirons où il en est pendant la démonstration.',
  },
  {
    question: 'Combien coûte Pathélix ?',
    answer:
      'Le tarif est établi selon votre exploitation. Nous vous le communiquons après la démonstration, une fois le périmètre défini avec vous.',
  },
]
