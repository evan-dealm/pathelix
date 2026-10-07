/**
 * Shape of the website's long-form pages (trades, features, comparisons, guides). Content is
 * data so that one renderer, the sitemap, llms.txt and the structured data all read the same
 * source. Every statement about the product is checked against the application's behaviour.
 */
export type ContentKind = 'metier' | 'fonctionnalite' | 'comparatif' | 'guide'

export interface ContentTable {
  caption: string
  head: string[]
  rows: string[][]
}

export interface ContentSection {
  heading: string
  paragraphs?: string[]
  points?: string[]
  table?: ContentTable
}

export interface ContentQuestion {
  question: string
  answer: string
}

export type ContentVisual =
  | 'dashboard'
  | 'missions'
  | 'tournees'
  | 'statistiques'
  | 'planning'
  | 'clip-terrain'
  | 'clip-optimisation'
  | 'clip-imprevu'

export interface ContentPage {
  kind: ContentKind
  slug: string
  /** Short name, for lists and the breadcrumb. */
  name: string
  /** The page's h1. */
  title: string
  /** `<title>` — the layout appends « — Pathélix ». */
  metaTitle: string
  /** Meta description, also used in lists and llms.txt. */
  description: string
  /** First paragraph: answers the page's question directly, in two or three sentences. */
  answer: string
  visual?: ContentVisual
  sections: ContentSection[]
  questions?: ContentQuestion[]
  /** Paths of pages worth reading next. */
  related: string[]
  /** ISO dates (YYYY-MM-DD). */
  published: string
  updated: string
}
