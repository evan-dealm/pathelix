import type { Metadata } from 'next'
import { CtaBand } from '@/components/site/CtaBand'
import { PageIntro } from '@/components/site/PageIntro'
import { ProductChapters, ProductIndex } from '@/components/site/ProductChapters'

const DESCRIPTION =
  'Tableau de bord, missions, planning, optimisation des tournées, application chauffeur hors ligne, parc de bennes, devis et factures, portail client, statistiques : le produit Pathélix, module par module.'

export const metadata: Metadata = {
  title: 'Produit : missions, tournées, terrain, bennes, facturation',
  description: DESCRIPTION,
  alternates: { canonical: '/produit' },
  openGraph: {
    url: '/produit',
    title: 'Le produit Pathélix, module par module',
    description: DESCRIPTION,
  },
}

export default function ProduitPage() {
  return (
    <>
      <PageIntro
        crumb={{ href: '/produit', label: 'Produit' }}
        title="Le produit, module par module."
        lead="Pathélix couvre l’exploitation de bout en bout : de la demande du client à la facture, en passant par le planning, la tournée et le téléphone du chauffeur."
      />
      <ProductIndex />
      <ProductChapters />
      <CtaBand />
    </>
  )
}
