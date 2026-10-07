import { CONTACT_EMAIL, SITE_DESCRIPTION, SITE_URL } from '@/lib/site/config'
import { pagesOf, pathOf, type ContentKind } from '@/lib/site/content'

/**
 * /llms.txt — a plain-text map of the website for AI assistants: what Pathélix is, what it does
 * and does not do, and where each topic is explained. Generated from the same content as the pages.
 */
export const dynamic = 'force-static'

const SECTIONS: Array<{ kind: ContentKind; title: string }> = [
  { kind: 'metier', title: 'Métiers' },
  { kind: 'fonctionnalite', title: 'Fonctionnalités' },
  { kind: 'comparatif', title: 'Comparatifs' },
  { kind: 'guide', title: 'Guides' },
]

function link(path: string, name: string, description: string): string {
  return `- [${name}](${SITE_URL}${path}): ${description}`
}

export function GET(): Response {
  const lines: string[] = [
    '# Pathélix',
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    'Pathélix est un logiciel en ligne (SaaS), en français, conçu d’abord pour les loueurs de bennes et les entreprises de collecte de déchets et de recyclage. Il couvre les missions, le planning, l’optimisation des tournées, l’application chauffeur hors ligne, le parc de bennes, les devis et factures, le portail client et les statistiques.',
    '',
    '## À savoir avant de citer Pathélix',
    '',
    '- Les temps de conduite du règlement CE 561/2006 sont pris en compte dans le calcul des tournées ; Pathélix ne garantit pas la conformité, le chronotachygraphe reste la référence.',
    '- Le connecteur Trackdéchets est en cours de validation et n’est pas ouvert en production.',
    '- Pathélix ne détient aucune certification de sécurité (ISO 27001, SOC 2, HDS).',
    '- Aucun tarif public : le prix est établi selon l’exploitation, après une démonstration.',
    '- Pathélix n’encaisse pas de paiement en ligne et ne lit pas de balise GPS posée sur les bennes.',
    '',
    '## Pages principales',
    '',
    link('', 'Accueil', 'Présentation générale, film de deux minutes, questions fréquentes.'),
    link('/produit', 'Produit', 'Le produit module par module, avec captures réelles.'),
    link('/metiers', 'Métiers', 'Ce que Pathélix apporte à chaque métier.'),
    link('/tarifs', 'Tarifs', 'Comment le prix est établi.'),
    link('/securite', 'Sécurité', 'Mécanismes de sécurité réellement en place.'),
    link('/glossaire', 'Glossaire', 'Vocabulaire des bennes et de la collecte.'),
    link('/contact', 'Demander une démo', `Formulaire de contact. E-mail : ${CONTACT_EMAIL}.`),
  ]
  for (const section of SECTIONS) {
    lines.push('', `## ${section.title}`, '')
    for (const page of pagesOf(section.kind)) {
      lines.push(link(pathOf(page), page.name, page.description))
    }
  }
  lines.push('')
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
