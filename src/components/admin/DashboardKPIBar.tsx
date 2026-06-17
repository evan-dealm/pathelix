'use client'

import { formatDuration } from '@/lib/algorithm'
import { displayShort } from './hooks'
import { Sparkline } from '@/components/ui/Sparkline'
import { useMemo, useEffect, useState } from 'react'
import { KpiDrilldown, type KpiDrilldownMetric } from './KpiDrilldown'
import { cachedFetch } from '@/lib/clientCache'

interface KpiHistoryEntry {
  date:          string
  poolTotal:     number
  totalKm:       number
  totalFuelEur:  number
  avgWorkMin:    number
}

export function DashboardKPIBar({ poolTotal, poolToday, driversWithPlan, totalDrivers, p1Count, date,
  totalKm, totalFuelEur, avgWorkMin, unassignedCount }: {
  poolTotal:       number
  poolToday:       number
  driversWithPlan: number
  totalDrivers:    number
  p1Count:         number
  date:            string
  totalKm:         number
  totalFuelEur:    number
  avgWorkMin:      number
  unassignedCount: number
}) {
  const [history, setHistory] = useState<KpiHistoryEntry[]>([])
  const [drillMetric, setDrillMetric] = useState<KpiDrilldownMetric>(null)

  useEffect(() => {
    cachedFetch<{ history?: KpiHistoryEntry[] }>(`/api/kpi-history?days=7&date=${date}`, 60_000)
      .then(d => { if (d?.history) setHistory(d.history) })
      .catch(() => {})
  }, [date])

  const sparkData = useMemo(() => {
    if (history.length >= 2) {
      return {
        pool:  history.map(h => h.poolTotal),
        km:    history.map(h => h.totalKm),
        fuel:  history.map(h => h.totalFuelEur),
        work:  history.map(h => h.avgWorkMin),
      }
    }
    return {
      pool:  Array(7).fill(poolTotal),
      km:    Array(7).fill(totalKm),
      fuel:  Array(7).fill(totalFuelEur),
      work:  Array(7).fill(avgWorkMin),
    }
  }, [history, poolTotal, totalKm, totalFuelEur, avgWorkMin])

  type KpiDef = {
    label:      string
    value:      string | number
    color:      string
    sub:        string
    spark?:     number[]
    sparkColor?: string
    drillKey?:  KpiDrilldownMetric
  }

  const kpis: KpiDef[] = [
    { label: 'Pool total',           value: poolTotal,        color: 'text-brand-500',   sub: poolTotal === 1 ? 'mission en attente' : 'missions en attente', spark: sparkData.pool, sparkColor: '#0055A4', drillKey: 'missions' },
    { label: 'Aujourd\'hui',         value: poolToday,        color: 'text-surface-900', sub: displayShort(date) },
    { label: 'Chauffeurs planifiés', value: `${driversWithPlan}/${totalDrivers}`, color: driversWithPlan > 0 ? 'text-emerald-600' : 'text-surface-400', sub: 'avec des missions' },
    { label: 'Urgences P1',          value: p1Count,          color: p1Count > 0 ? 'text-red-500' : 'text-surface-300', sub: p1Count > 0 ? 'à traiter' : 'aucune' },
    { label: 'Distance totale',      value: totalKm > 0 ? `${Math.round(totalKm * 10) / 10} km` : '—', color: 'text-brand-500', sub: 'tous chauffeurs', spark: sparkData.km, sparkColor: '#0055A4', drillKey: 'km' },
    { label: 'Carburant estimé',     value: totalFuelEur > 0 ? `${totalFuelEur.toFixed(0)} €` : '—', color: 'text-amber-500', sub: 'coût journée', spark: sparkData.fuel, sparkColor: '#f59e0b', drillKey: 'fuel' },
    { label: 'Temps moy.',           value: avgWorkMin > 0 ? formatDuration(avgWorkMin) : '—', color: 'text-surface-600', sub: 'par chauffeur', spark: sparkData.work, sparkColor: '#6b7280', drillKey: 'work' },
    { label: 'Non assignées',        value: unassignedCount,  color: unassignedCount > 0 ? 'text-orange-500' : 'text-surface-300', sub: unassignedCount > 0 ? 'à réassigner' : 'tout assigné' },
  ]

  return (
    <>
      <div className="flex-shrink-0 border-b border-surface-200 bg-white p-2 md:p-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-px md:gap-0 md:grid-cols-none md:flex md:items-stretch md:divide-x md:divide-surface-200/60 overflow-x-auto">
          {kpis.map(k => (
            <div key={k.label}
              onClick={() => k.drillKey && setDrillMetric(k.drillKey)}
              className={`flex flex-col items-center justify-center px-3 md:px-4 py-2.5 gap-0.5 min-w-0 md:min-w-[100px] rounded md:rounded-none group hover:bg-surface-50 transition-colors
                ${k.drillKey ? 'cursor-pointer' : ''}`}>
              <span className={`text-lg md:text-xl font-black tabular-nums leading-none ${k.color}`}>{k.value}</span>
              <span className="text-[8px] md:text-[9px] text-surface-400 uppercase tracking-wider whitespace-nowrap font-medium">{k.label}</span>
              {k.spark && k.spark.some(v => v > 0) ? (
                <div className="relative">
                  <Sparkline data={k.spark} color={k.sparkColor} width={56} height={16} className="mt-0.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                  {k.drillKey && (
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-[8px] text-surface-500 bg-white/80 px-1 rounded">détails</span>
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-[8px] text-surface-300 whitespace-nowrap hidden sm:block">{k.sub}</span>
              )}
            </div>
          ))}
          <div className="hidden md:block flex-1" />
        </div>
      </div>

      {drillMetric && (
        <KpiDrilldown
          metric={drillMetric}
          history={history}
          onClose={() => setDrillMetric(null)}
        />
      )}
    </>
  )
}
