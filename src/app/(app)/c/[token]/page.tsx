import type { Metadata } from 'next'
import { unscopedPrisma } from '@/lib/tenantDb'

export const metadata: Metadata = { title: 'Contenant — Pathélix', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

/**
 * Where a bin's QR code leads when scanned with any phone camera. Public by design (the code is
 * printed on the bin): shows only the fleet number, its type and the owner's name — nothing about
 * customers, sites or missions. Drivers scan from their app, which reads the code directly.
 */
export default async function ContainerQrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const valid = /^[A-Za-z0-9_-]{16,64}$/.test(token)
  // Cross-tenant lookup by an unguessable token — the token is the credential (like /track).
  const container = valid
    ? await unscopedPrisma.container.findUnique({
        where: { qrToken: token },
        select: { number: true, archived: true, type: { select: { name: true } }, tenant: { select: { name: true, settings: { select: { companyDisplayName: true } } } } },
      }).catch(() => null)
    : null

  return (
    <main className="grid min-h-dvh place-items-center bg-surface-50 p-6 text-center">
      <div className="max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-surface-200">
        {container && !container.archived ? (
          <>
            <p className="text-sm text-surface-500">Contenant</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-surface-900">{container.number}</h1>
            <p className="mt-2 text-surface-600">{container.type.name}</p>
            <p className="mt-6 text-sm text-surface-500">
              Propriété de <strong className="text-surface-800">{container.tenant.settings?.companyDisplayName || container.tenant.name}</strong>.
            </p>
            <p className="mt-4 text-xs text-surface-400">Chauffeurs : scannez ce code depuis l&apos;application Pathélix.</p>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-semibold text-surface-900">Code inconnu</h1>
            <p className="mt-2 text-sm text-surface-500">Ce code ne correspond à aucun contenant en service.</p>
          </>
        )}
      </div>
    </main>
  )
}
