'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { usePlanningStore } from '@/stores/planningStore'
import { TradeProvider } from '@/providers/TradeProvider'
import type { Driver, Mission } from '@/lib/types'
import { cachedFetch } from '@/lib/clientCache'
import { fetchAllPages } from '@/lib/apiClient'
import type { SettingsApiResponse } from '@/lib/types'
import type { TradeConfig } from '@/lib/trades'

const PUBLIC_PATH_PREFIXES = ['/login', '/driver']


// UTC-based to match src/lib/dateUtils.ts's today() (used for mission creation, driver pages,
// e2e/global-setup.ts seeding) — this used to read local Date components instead, which silently
// disagreed with every other "today" in the app for the ~1-2h window each night where local and
// UTC calendar dates differ, fetching the wrong day's missions/plans with no error.
function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const setInitialData = usePlanningStore(s => s.setInitialData)
  const mergePlansFromDB = usePlanningStore(s => s.mergePlansFromDB)
  const pathname = usePathname()
  const isPublic = PUBLIC_PATH_PREFIXES.some(p => pathname?.startsWith(p))

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [trade, setTrade] = useState<string | null>(null)
  const [customTradeConfig, setCustomTradeConfig] = useState<TradeConfig | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (isPublic || startedRef.current) return
    startedRef.current = true

    const today = todayStr()

    const cached = usePlanningStore.getState()
    if (cached.drivers.length > 0) {
      setReady(true)
    }

    ;(async () => {
      try {

        setStep(1)
        const [drivers, missions, settingsRes, plansJson] = await Promise.all([
          // Every page: list routes cap page size at 100 (a tenant with 150 drivers saw 100).
          fetchAllPages<Driver>('/api/drivers'),
          fetchAllPages<Mission>(`/api/missions?date=${today}`),
          cachedFetch<SettingsApiResponse>('/api/settings', 120_000).catch(() => null as SettingsApiResponse | null),
          fetch(`/api/plans?date=${today}`).then(r => r.ok ? r.json() : null).catch(() => null),
        ])

        if (settingsRes?.trade) setTrade(settingsRes.trade)
        if (settingsRes?.customTradeConfig) setCustomTradeConfig(settingsRes.customTradeConfig)

        setStep(2)
        setInitialData(drivers, missions)

        if (plansJson) {
          const plans = Array.isArray(plansJson) ? plansJson : (plansJson?.data ?? [])
          if (plans.length > 0) mergePlansFromDB(plans)
        }

        setReady(true)

      } catch (err) {

        if (!usePlanningStore.getState().drivers.length) {
          setError(err instanceof Error ? err.message : 'Impossible de charger les données')
        }
      }
    })()
  }, [isPublic, setInitialData, mergePlansFromDB])

  useEffect(() => {
    if (isPublic || !ready) return
    const interval = setInterval(async () => {
      if (document.hidden) return
      try {
        const today = todayStr()
        const [drivers, missions] = await Promise.all([
          fetchAllPages<Driver>('/api/drivers'),
          fetchAllPages<Mission>(`/api/missions?date=${today}`),
        ])
        // upsertMissions (not setInitialData) — a full replace here would silently wipe out
        // any other dates' missions loaded separately (e.g. by the Missions tab's full-history
        // preload) every 120s, reverting the tab back to "today only" a couple minutes after
        // it was fixed to show the full catalog. See src/lib/loadAllMissions.ts.
        usePlanningStore.setState({ drivers })
        usePlanningStore.getState().upsertMissions(missions)
      } catch {  }
    }, 120_000)
    return () => clearInterval(interval)
  }, [isPublic, ready, setInitialData])

  if (isPublic) return <TradeProvider tradeId={trade} customConfig={customTradeConfig}>{children}</TradeProvider>

  if (error) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-surface-50">
        <div className="flex flex-col items-center gap-5">
          <div className="w-[72px] h-[72px] rounded-[18px] overflow-hidden ring-1 ring-black/10 shadow-elevated">
            <Image src="/logo%20seul.svg" alt="PATHÉLIX" width={72} height={72} className="w-full h-full object-cover" priority />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-surface-900 text-base font-bold tracking-tight font-display">PATHÉLIX</span>
            <span className="text-danger-500 text-[13px]">Erreur de connexion</span>
          </div>
          <p className="text-surface-400 text-[12px] text-center max-w-[260px] leading-relaxed">{error}</p>
          <button type="button" onClick={() => window.location.reload()}
            className="h-9 px-5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-[13px] font-semibold transition-colors shadow-soft">
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  if (!ready) {
    const progressClass = step === 0 ? 'w-[12%]' : step === 1 ? 'w-[60%]' : 'w-[90%]'
    const stepLabel     = step === 0 ? 'Initialisation…' : step === 1 ? 'Chargement des données…' : "Préparation de l'espace de travail…"
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-surface-50">
        <div className="flex flex-col items-center gap-7">

          {}
          <div className="w-[72px] h-[72px] rounded-[18px] overflow-hidden ring-1 ring-black/10 shadow-elevated">
            <Image src="/logo%20seul.svg" alt="PATHÉLIX" width={72} height={72} className="w-full h-full object-cover" priority />
          </div>

          {}
          <div className="flex flex-col items-center gap-2">
            <span className="text-surface-900 text-[18px] font-bold tracking-[-0.025em] leading-none font-display">
              PATHÉLIX
            </span>
            <span className="text-surface-400 text-[13px]">{stepLabel}</span>
          </div>

          {}
          <div className="w-44 h-[2px] bg-surface-200 rounded-full overflow-hidden">
            <div className={`h-full bg-brand-500 rounded-full transition-[width] duration-700 ease-out ${progressClass}`} />
          </div>

        </div>
      </div>
    )
  }

  return <TradeProvider tradeId={trade} customConfig={customTradeConfig}>{children}</TradeProvider>
}
