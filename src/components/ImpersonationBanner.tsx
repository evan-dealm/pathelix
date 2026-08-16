'use client'

import { useState, useEffect } from 'react'
import { usePlanningStore } from '@/stores/planningStore'

interface MeData {
  userId: string
  role: string
  tenantId: string
}

export function ImpersonationBanner() {
  const [impersonation, setImpersonation] = useState<{ tenantId: string; tenantName: string } | null>(null)

  useEffect(() => {
    async function check() {
      try {
        // no-store: /api/settings carries Cache-Control: private, max-age=120 for the normal
        // case (repeat fetches within one tenant's session). That header has no `Vary` on the
        // session cookie — the URL is identical for every tenant — so the browser's own HTTP
        // cache can't tell tenant A's response from tenant B's. A superadmin switching
        // impersonation target twice inside that 2-minute window got the *previous* tenant's
        // name back from cache after a hard navigation to the new one, even though the
        // session/tenantId underneath was already correctly the new tenant. This component's
        // entire job is showing the tenant you're impersonating right now, so it can never
        // use a cached response.
        const res = await fetch('/api/auth/me', { cache: 'no-store' })
        if (!res.ok) return
        const me: MeData = await res.json()

        if (!me.userId.startsWith('sa:')) return

        // Not /api/superadmin/tenants/[id]: the impersonated session's role is the target
        // tenant's role (e.g. 'admin'), so that superadmin-only route always 403s here.
        // /api/settings is tenant-scoped and open to any authenticated role.
        const settingsRes = await fetch('/api/settings', { cache: 'no-store' })
        if (settingsRes.ok) {
          const settings = await settingsRes.json()
          setImpersonation({ tenantId: me.tenantId, tenantName: settings.tenantName || settings.companyDisplayName || me.tenantId })
        } else {
          setImpersonation({ tenantId: me.tenantId, tenantName: me.tenantId })
        }
      } catch {

      }
    }
    check()
  }, [])

  if (!impersonation) return null

  async function exitImpersonation() {

    try {
      const res = await fetch('/api/superadmin/exit-impersonation', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        // Clear planning data cached while impersonating this tenant — plans/startTimes/etc are
        // keyed by driverId, not tenantId, so leaving them in IndexedDB risks a stale entry
        // getting bundled into the next tenant's requests after a subsequent impersonation.
        await usePlanningStore.persist.clearStorage()
        window.location.href = data.redirectTo ?? '/superadmin'
      } else {

        await usePlanningStore.persist.clearStorage()
        await fetch('/api/auth/logout')
        window.location.href = '/login'
      }
    } catch {
      window.location.href = '/login'
    }
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white px-4 py-2.5 flex items-center justify-center gap-4 shadow-lg"
      role="alert"
    >
      <span className="text-lg">&#9888;&#65039;</span>
      <span className="font-semibold text-sm">
        GOD MODE : Vous agissez en tant que{' '}
        <span className="underline decoration-2 underline-offset-2">{impersonation.tenantName}</span>
      </span>
      <button
        onClick={exitImpersonation}
        className="ml-4 bg-white text-red-700 px-4 py-1 rounded-md text-sm font-bold hover:bg-red-50 transition shadow-sm"
      >
        Quitter l&apos;impersonation
      </button>
    </div>
  )
}
