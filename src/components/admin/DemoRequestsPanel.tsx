'use client'

import { useCallback, useEffect, useState } from 'react'
import { FLEET_SIZE_LABELS, type FleetSize } from '@/lib/site/config'

interface DemoRequestRow {
  id: string
  firstName: string
  lastName: string
  company: string
  email: string
  phone: string
  fleetSize: string
  message: string
  createdAt: string
  handledAt: string | null
}

const isFleetSize = (v: string): v is FleetSize => v in FLEET_SIZE_LABELS

/** Superadmin view of the demo requests sent from the public website's /contact form. */
export function DemoRequestsPanel() {
  const [rows, setRows] = useState<DemoRequestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/superadmin/demo-requests')
      if (!res.ok) throw new Error(`Chargement impossible (${res.status})`)
      const body = (await res.json()) as { requests: DemoRequestRow[] }
      setRows(body.requests)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setHandled(id: string, handled: boolean) {
    const res = await fetch('/api/superadmin/demo-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, handled }),
    })
    if (!res.ok) {
      setError(`Mise à jour impossible (${res.status})`)
      return
    }
    await load()
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400">
          Demandes de démonstration
        </h2>
        <p className="mt-1 text-xs text-zinc-600">
          Envoyées depuis le formulaire du site public (/contact).
        </p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {rows === null && !error && <p className="text-sm text-zinc-500">Chargement…</p>}
      {rows?.length === 0 && (
        <p className="text-sm text-zinc-500">Aucune demande pour l’instant.</p>
      )}
      {rows?.map(r => (
        <div
          key={r.id}
          className={`rounded-2xl border border-zinc-800 bg-zinc-900 p-5 ${r.handledAt ? 'opacity-60' : ''}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-semibold">
                {r.firstName} {r.lastName}{' '}
                <span className="font-normal text-zinc-400">— {r.company}</span>
              </div>
              <div className="mt-1 text-sm text-zinc-400">
                <a
                  href={`mailto:${r.email}`}
                  className="underline underline-offset-2 hover:text-white"
                >
                  {r.email}
                </a>
                {r.phone && <span> · {r.phone}</span>}
                {isFleetSize(r.fleetSize) && <span> · {FLEET_SIZE_LABELS[r.fleetSize]}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span>
                {new Date(r.createdAt).toLocaleString('fr-FR', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
              <button
                type="button"
                onClick={() => void setHandled(r.id, !r.handledAt)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 font-medium text-zinc-200 transition hover:border-zinc-500"
              >
                {r.handledAt ? 'Rouvrir' : 'Marquer comme traitée'}
              </button>
            </div>
          </div>
          {r.message && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{r.message}</p>
          )}
        </div>
      ))}
    </div>
  )
}
