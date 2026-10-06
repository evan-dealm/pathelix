'use client'

import { useState, useEffect } from 'react'

interface ServiceStatus {
  name: string
  status: 'operational' | 'degraded' | 'outage'
  latencyMs?: number
  message?: string
}

interface StatusData {
  status: string
  services: ServiceStatus[]
  timestamp: string
  sla: { target: string; description: string }
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'operational') return <span className="inline-block w-3 h-3 rounded-full bg-green-500" />
  if (status === 'degraded') return <span className="inline-block w-3 h-3 rounded-full bg-yellow-500" />
  return <span className="inline-block w-3 h-3 rounded-full bg-red-500 animate-pulse" />
}

export default function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null)

  useEffect(() => {
    async function load() {
      const r = await fetch('/api/status')
      if (r.ok) setData(await r.json())
    }
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="relative z-[1] max-w-2xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold">PATHÉLIX Status</h1>
          <p className="text-zinc-500 mt-2">État des services en temps réel</p>
        </div>

        {data ? (
          <>
            {}
            <div className={`rounded-xl p-6 mb-8 text-center ${
              data.status === 'operational' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' :
              data.status === 'degraded' ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800' :
              'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
            }`}>
              <StatusIcon status={data.status} />
              <span className="ml-3 text-lg font-semibold">
                {data.status === 'operational' ? 'Tous les systemes sont operationnels' :
                 data.status === 'degraded' ? 'Performances degradees sur certains services' :
                 'Incident en cours'}
              </span>
            </div>

            {}
            <div className="space-y-3 mb-12">
              {data.services.map(s => (
                <div key={s.name} className="flex items-center justify-between px-5 py-4 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <StatusIcon status={s.status} />
                    <div>
                      <div className="font-medium text-sm">{s.name}</div>
                      {s.message && <div className="text-xs text-zinc-500">{s.message}</div>}
                    </div>
                  </div>
                  <div className="text-right">
                    {s.latencyMs !== undefined && s.latencyMs > 0 && (
                      <div className="text-xs font-mono text-zinc-500">{s.latencyMs}ms</div>
                    )}
                    <div className={`text-xs font-bold uppercase ${
                      s.status === 'operational' ? 'text-green-600 dark:text-green-400' :
                      s.status === 'degraded' ? 'text-yellow-600 dark:text-yellow-400' :
                      'text-red-600 dark:text-red-400'
                    }`}>{s.status === 'operational' ? 'Operationnel' : s.status === 'degraded' ? 'Degrade' : 'Panne'}</div>
                  </div>
                </div>
              ))}
            </div>

            {}
            <div className="bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
              <h2 className="font-bold text-sm mb-2">Engagement de niveau de service (SLA)</h2>
              <p className="text-zinc-500 text-sm">{data.sla.description}</p>
              <p className="text-2xl font-bold mt-3">{data.sla.target} <span className="text-sm text-zinc-500 font-normal">uptime garanti</span></p>
            </div>

            <div className="text-center mt-8 text-xs text-zinc-400">
              Derniere verification : {new Date(data.timestamp).toLocaleString('fr-FR')} — Rafraichi toutes les 30s
            </div>
          </>
        ) : (
          <div className="text-center text-zinc-500 animate-pulse">Chargement...</div>
        )}
      </div>
    </div>
  )
}
