import type { Metadata, Viewport } from 'next'
import { BRAND_ICON_VERSION } from '@/lib/branding'
import { Inter, Geist } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { QueryProvider } from '@/providers/QueryProvider'
import { DataProvider } from '@/providers/DataProvider'
import { SWProvider } from '@/providers/SWProvider'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ToastProvider } from '@/components/ui/Toast'
import { ImpersonationBanner } from '@/components/ImpersonationBanner'
import { OrbitalBackground } from '@/components/OrbitalBackground'
import '../globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'PATHÉLIX — Gestion de Tournées',
  description: 'Plateforme SaaS d\'optimisation logistique pour la gestion de tournées de collecte',
  icons: {
    icon: { url: `/favicon.png?v=${BRAND_ICON_VERSION}`, type: 'image/png', sizes: '48x48' },
    apple: { url: `/apple-touch-icon.png?v=${BRAND_ICON_VERSION}`, sizes: '180x180' },
  },
  manifest: `/manifest.json?v=${BRAND_ICON_VERSION}`,
  robots: { index: false, follow: false },
  openGraph: {
    title: 'PATHÉLIX',
    description: 'Optimisation intelligente de tournées de collecte',
    type: 'website',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pas de maximumScale : les chauffeurs doivent pouvoir zoomer sur le terrain
  // (soleil, gants) — bloquer le pinch-zoom est une violation d'accessibilité
  themeColor: '#F7F7F4',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className={`${inter.variable} ${geist.variable}`}>
      <body className="bg-surface-50 text-surface-900 min-h-screen antialiased font-sans" suppressHydrationWarning>
        {}
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
          <OrbitalBackground />
        </div>
        <ImpersonationBanner />
        <a href="#main-content" className="skip-link">Aller au contenu principal</a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SWProvider>
            <QueryProvider>
              <DataProvider>
                <ErrorBoundary><ToastProvider>{children}</ToastProvider></ErrorBoundary>
              </DataProvider>
            </QueryProvider>
          </SWProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
