import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import { BRAND_ICON_VERSION } from '@/lib/branding'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site/config'
import { SiteHeader } from '@/components/site/SiteHeader'
import { SiteFooter } from '@/components/site/SiteFooter'
import './site.css'

/**
 * Root layout of the public website. It shares nothing with the application layout
 * (src/app/(app)/layout.tsx): no data providers, no service worker, its own stylesheet — a
 * visitor downloads the marketing pages only.
 */

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

const DEFAULT_TITLE = 'Pathélix — Logiciel d’exploitation pour bennes, collecte et recyclage'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: DEFAULT_TITLE, template: '%s — Pathélix' },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  icons: {
    icon: { url: `/favicon.png?v=${BRAND_ICON_VERSION}`, type: 'image/png', sizes: '48x48' },
    apple: { url: `/apple-touch-icon.png?v=${BRAND_ICON_VERSION}`, sizes: '180x180' },
  },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'fr_FR',
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: 'summary_large_image' },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FFFFFF',
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={geist.variable}>
      <body className="bg-paper font-sans text-ink">
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
        >
          Aller au contenu
        </a>
        <SiteHeader />
        <main id="contenu">{children}</main>
        <SiteFooter />
      </body>
    </html>
  )
}
