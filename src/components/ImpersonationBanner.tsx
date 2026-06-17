'use client'

import { useState, useEffect } from 'react'

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
        const res = await fetch('/api/auth/me')
        if (!res.ok) return
        const me: MeData = await res.json()

        if (!me.userId.startsWith('sa:')) return

        const tenantRes = await fetch(`/api/superadmin/tenants/${me.tenantId}`)
        if (tenantRes.ok) {
          const tenant = await tenantRes.json()
          setImpersonation({ tenantId: me.tenantId, tenantName: tenant.name ?? me.tenantId })
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
        window.location.href = data.redirectTo ?? '/superadmin'
      } else {

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
