'use client'

import { useState, useEffect } from 'react'

// Server-side enforcement (getRequestContext + hasPermission()) already refuses any request a
// user isn't allowed to make — this hook exists only so the UI can proactively disable/hide a
// control instead of letting the user click it and land on a "Permission refusée" toast.
export function usePermissions(): { permissions: Set<string>; loading: boolean } {
  const [permissions, setPermissions] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const meRes = await fetch('/api/auth/me')
        if (!meRes.ok) return
        const me = await meRes.json()
        if (me.role === 'superadmin' || me.role === 'admin') {
          if (!cancelled) setPermissions(new Set(['*']))
          return
        }
        const permRes = await fetch(`/api/permissions?userId=${encodeURIComponent(me.userId)}`)
        if (!permRes.ok) return
        const data = await permRes.json()
        if (!cancelled && Array.isArray(data.permissions)) {
          setPermissions(new Set(data.permissions))
        }
      } catch {

      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return { permissions, loading }
}

export function hasPerm(permissions: Set<string>, perm: string): boolean {
  return permissions.has('*') || permissions.has(perm)
}
