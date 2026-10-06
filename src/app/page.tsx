import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { Landing } from '@/components/landing/Landing'

export const metadata: Metadata = {
  title: 'Pathélix — Tournées de bennes optimisées',
  description: 'Planification et optimisation des tournées de bennes : pose, retrait, échange, vidage à l’exutoire. Application chauffeur hors ligne, suivi en direct, conformité CE 561 et Trackdéchets.',
  robots: { index: true, follow: true },
}

/** Public home: the product page for visitors; a signed-in user goes straight to their workspace. */
export default async function Home() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (session) {
    if (session.role === 'superadmin') redirect('/superadmin')
    if (session.role === 'driver') redirect(`/driver/${session.driverRef ?? session.sub}`)
    redirect('/admin')
  }
  return <Landing />
}
