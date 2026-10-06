'use client'

import { useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { formatDuration } from '@/lib/algorithm'

interface KpiHistoryEntry {
  date:          string
  poolTotal:     number
  totalKm:       number
  totalFuelEur:  number
  avgWorkMin:    number
  driversWithPlan?: number
  totalDrivers?: number
}

export type KpiDrilldownMetric = 'missions' | 'km' | 'fuel' | 'work' | null

interface Props {
  metric:  KpiDrilldownMetric
  history: KpiHistoryEntry[]
  onClose: () => void
}

const LABELS: Record<NonNullable<KpiDrilldownMetric>, string> = {
  missions: 'Missions en pool',
  km:       'Distance totale (km)',
  fuel:     'Carburant estimé (€)',
  work:     'Temps moyen par chauffeur',
}

const COLORS: Record<NonNullable<KpiDrilldownMetric>, string> = {
  missions: '#0055A4',
  km:       '#0055A4',
  fuel:     '#f59e0b',
  work:     '#6b7280',
}

function shortDate(d: string) {
  const parts = d.split('-')
  return `${parts[2]}/${parts[1]}`
}

function formatValue(metric: NonNullable<KpiDrilldownMetric>, value: number): string {
  if (metric === 'fuel')  return `${value.toFixed(0)} €`
  if (metric === 'km')    return `${Math.round(value * 10) / 10} km`
  if (metric === 'work')  return formatDuration(value)
  return String(value)
}

export function KpiDrilldown({ metric, history, onClose }: Props) {
  const data = useMemo(() => history.map(h => ({
    date:     shortDate(h.date),
    missions: h.poolTotal,
    km:       Math.round(h.totalKm * 10) / 10,
    fuel:     Math.round(h.totalFuelEur),
    work:     Math.round(h.avgWorkMin),
  })), [history])

  if (!metric) return null

  const color = COLORS[metric]

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Détail de l'indicateur"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-surface-900">{LABELS[metric]} — 7 derniers jours</h2>
          <button type="button" onClick={onClose}
            className="text-surface-400 hover:text-surface-600 text-xl leading-none transition-colors">
            ✕
          </button>
        </div>

        {data.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-surface-400">
            Pas de données disponibles
          </div>
        ) : (
          <>
            {}
            <div className="h-52 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                {metric === 'missions' ? (
                  <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip
                      formatter={(v: unknown) => [formatValue(metric, Number(v ?? 0)), LABELS[metric]]}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', fontSize: 12 }}
                    />
                    <Bar dataKey={metric} fill={color} radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : metric === 'work' ? (
                  <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={color} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40}
                      tickFormatter={(v: number) => `${Math.round(v / 60)}h`} />
                    <Tooltip
                      formatter={(v: unknown) => [formatValue(metric, Number(v ?? 0)), LABELS[metric]]}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', fontSize: 12 }}
                    />
                    <Area type="monotone" dataKey={metric} stroke={color} strokeWidth={2}
                      fill="url(#areaGrad)" dot={{ fill: color, r: 3 }} />
                  </AreaChart>
                ) : (
                  <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip
                      formatter={(v: unknown) => [formatValue(metric, Number(v ?? 0)), LABELS[metric]]}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey={metric} stroke={color} strokeWidth={2}
                      dot={{ fill: color, r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>

            {}
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-surface-400 border-b border-surface-100">
                    <th className="text-left py-1.5 font-medium">Date</th>
                    <th className="text-right py-1.5 font-medium">Valeur</th>
                    <th className="text-right py-1.5 font-medium">vs veille</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d, i) => {
                    const val  = d[metric]
                    const prev = i > 0 ? data[i - 1][metric] : null
                    const diff = prev !== null ? val - prev : null
                    return (
                      <tr key={d.date} className="border-b border-surface-50 hover:bg-surface-50">
                        <td className="py-1.5 text-surface-600">{d.date}</td>
                        <td className="py-1.5 text-right font-semibold text-surface-900">
                          {formatValue(metric, val)}
                        </td>
                        <td className={`py-1.5 text-right ${diff === null ? 'text-surface-300' : diff > 0 ? 'text-red-500' : diff < 0 ? 'text-emerald-500' : 'text-surface-400'}`}>
                          {diff === null ? '—' : diff > 0 ? `+${formatValue(metric, diff)}` : formatValue(metric, diff)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
