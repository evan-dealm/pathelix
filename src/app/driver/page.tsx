'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { today } from '@/lib/dateUtils'

type DriverEntry = {
  id: string
  firstName: string
  lastName: string
  sector: string
  depotName: string
}

export default function DriverIndexPage() {
  const [drivers, setDrivers] = useState<DriverEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [date, setDate]     = useState(today())

  useEffect(() => {
    fetch('/api/driver-list')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setDrivers(data)
        else setError(data.error || 'Erreur')
      })
      .catch(() => setError('Impossible de contacter le serveur'))
      .finally(() => setLoading(false))
  }, [])

  const bySector = drivers.reduce<Record<string, DriverEntry[]>>((acc, d) => {
    if (!acc[d.sector]) acc[d.sector] = []
    acc[d.sector].push(d)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div>
            <h1 className="font-bold text-white text-lg">🚛 PATHÉLIX</h1>
            <p className="text-xs text-gray-400 mt-0.5">Sélectionnez votre profil</p>
          </div>
          <input
            type="date"
            title="Date de la tournée"
            aria-label="Date de la tournée"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg text-xs text-white px-2 py-1.5 focus:outline-none focus:border-blue-500"
          />
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        {loading && (
          <div className="text-center py-16 text-gray-500">
            <div className="text-3xl mb-2 animate-spin">⏳</div>
            <p className="text-sm">Chargement…</p>
          </div>
        )}

        {error && (
          <div className="bg-red-950/40 border border-red-800/30 rounded-xl p-4 text-red-300 text-sm text-center">
            {error}
          </div>
        )}

        {!loading && !error && drivers.length === 0 && (
          <div className="text-center py-16 text-gray-600">
            <div className="text-4xl mb-3">👤</div>
            <p>Aucun chauffeur configuré.</p>
            <p className="text-xs mt-1">Contactez votre dispatcher.</p>
          </div>
        )}

        {Object.entries(bySector).map(([sector, sDrivers]) => (
          <div key={sector} className="mb-6">
            <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
              📍 {sector}
            </h2>
            <div className="space-y-2">
              {sDrivers.map(d => (
                <Link
                  key={d.id}
                  href={`/driver/${d.id}?date=${date}`}
                  className="flex items-center gap-3 bg-gray-900 hover:bg-gray-800 active:bg-gray-700 border border-gray-800 rounded-xl px-4 py-3 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {(d.firstName || '?')[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-white">{d.firstName} {d.lastName}</div>
                    <div className="text-xs text-gray-400 truncate">{d.depotName}</div>
                  </div>
                  <div className="ml-auto text-gray-600">›</div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  )
}
