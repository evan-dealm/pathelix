'use client'

import { useState, useMemo, useEffect } from 'react'
import { MissionType, MISSION_TYPE_HEX } from '@/lib/types'
import { useTrade } from '@/providers/TradeProvider'
import { formatDuration } from '@/lib/algorithm'
import { usePlanningStore } from '@/stores/planningStore'
import { Sparkline } from '@/components/ui/Sparkline'
import { SYNTHETIC_TYPES } from '../types'
import { today, addDays, displayShort, getWeekDays, useDebounce } from '../hooks'
import { loadAllMissionsIntoStore } from '@/lib/loadAllMissions'
import { loadPlansForDate } from '@/lib/loadPlansForDate'
import { ReportsPanel } from '../ReportsPanel'

function MiniBarChart({ data, barClass = 'bg-[#0055A4]/70' }: {
  data: { label: string; value: number; max: number; barClass?: string }[]
  barClass?: string
}) {
  if (data.length === 0) return null
  return (
    <div className="space-y-1.5">
      {data.map(({ label, value, max, barClass: rowClass }) => {
        const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
        const cls = rowClass ?? barClass
        return (
          <div key={label} className="flex items-center gap-2">
            <span className="text-[11px] text-surface-400 w-28 flex-shrink-0 truncate">{label}</span>
            <div className="flex-1 h-4 bg-surface-100 rounded overflow-hidden">
              <div
                className={`h-full rounded transition-all duration-500 ${cls}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs font-bold tabular-nums text-surface-600 w-8 text-right">{value}</span>
          </div>
        )
      })}
    </div>
  )
}

function GaugeCircle({ value, max, label, color = '#0055A4' }: {
  value: number; max: number; label: string; color?: string
}) {
  const pct = max > 0 ? Math.min(1, value / max) : 0
  const r = 28, cx = 36, cy = 36
  const circ = 2 * Math.PI * r
  const dash = pct * circ
  const cls = pct >= 0.9 ? '#ef4444' : pct >= 0.75 ? '#f97316' : color
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth="7" />
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={cls} strokeWidth="7"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
          className="fill-white font-bold" fontSize="13">
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <span className="text-[10px] text-surface-400 text-center leading-tight">{label}</span>
    </div>
  )
}

export function StatsTab() {
  const { missionIcon, missionLabel } = useTrade()
  const storeDrivers = usePlanningStore(s => s.drivers)
  const storeMissions = usePlanningStore(s => s.missions)
  const storePlans = usePlanningStore(s => s.plans)
  const [statsSearch, setStatsSearch] = useState('')
  const debouncedStatsSearch = useDebounce(statsSearch, 200)
  const [sectorFilter, setSectorFilter] = useState('all')
  const [statsDate, setStatsDate] = useState(today())

  // storeMissions/storePlans only ever hold *today's* data from DataProvider's initial load —
  // this tab lets the user pick any date, but nothing fetched that date's data, so every date
  // but today silently showed all-zero stats regardless of what existed in the DB. Same root
  // cause as loadAllMissions.ts (Missions tab) / loadPlansForDate.ts (Tournées tab).
  useEffect(() => {
    const controller = { cancelled: false }
    loadAllMissionsIntoStore(controller)
    return () => { controller.cancelled = true }
  }, [])

  useEffect(() => { loadPlansForDate(statsDate) }, [statsDate])

  const { allMissions, p1Count, p2Count, p3Count, noGps } = useMemo(() => {
    const all: typeof storeMissions extends (infer T)[] ? T[] : never[] = []
    let p1 = 0, p2 = 0, p3 = 0, bad = 0
    for (const m of (Array.isArray(storeMissions) ? storeMissions : [])) {
      if (SYNTHETIC_TYPES.includes(m.type)) continue
      all.push(m)
      if (m.priority === 1) p1++
      else if (m.priority === 2) p2++
      else p3++
      if (m.latitude === 0 && m.longitude === 0) bad++
    }
    return { allMissions: all, p1Count: p1, p2Count: p2, p3Count: p3, noGps: bad }
  }, [storeMissions])

  const byType = useMemo(() => {
    const map: Record<string, number> = {}
    allMissions.forEach(m => { map[m.type] = (map[m.type] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [allMissions])
  const maxTypeCount = Math.max(1, ...byType.map(([, n]) => n))

  const assignmentStats = useMemo(() => {
    const poolForDate = allMissions.filter(m => m.date === statsDate)
    const assignedIds = new Set<string>()
    for (const [key, plan] of Object.entries(storePlans)) {
      if (key.endsWith(`|${statsDate}`)) {
        plan.filter(m => !m.isSynthetic).forEach(m => assignedIds.add(m.id))
      }
    }
    const assigned = poolForDate.filter(m => assignedIds.has(m.id)).length
    const total = poolForDate.length
    const p1Total = poolForDate.filter(m => m.priority === 1).length
    const p1Assigned = poolForDate.filter(m => m.priority === 1 && assignedIds.has(m.id)).length
    const driversActive = (Array.isArray(storeDrivers) ? storeDrivers : []).filter(d =>
      !d.archived && (storePlans[`${d.id}|${statsDate}`] || []).filter(m => !m.isSynthetic).length > 0
    ).length
    const totalDrivers = (Array.isArray(storeDrivers) ? storeDrivers : []).filter(d => !d.archived).length
    return { assigned, total, unassigned: total - assigned, p1Total, p1Assigned, driversActive, totalDrivers }
  }, [allMissions, storePlans, storeDrivers, statsDate])

  const next7 = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today(), i)), [])
  const missionsByDate = useMemo(() => {
    const map: Record<string, number> = {}
    allMissions.forEach(m => { map[m.date] = (map[m.date] || 0) + 1 })
    return map
  }, [allMissions])

  const driverStats = useMemo(() => {
    const weekDays = getWeekDays(today())
    return ( Array.isArray(storeDrivers) ? storeDrivers : [] ).map(driver => {
      let totalMissions = 0, totalMin = 0
      for (const day of weekDays) {
        const key = `${driver.id}|${day}`
        const plan = storePlans[key] || []
        const realPlan = plan.filter(m => !m.isSynthetic)
        totalMissions += realPlan.length

        totalMin += realPlan.reduce((s, m) => s + (m.estimatedDurationMin || 0) + (m.maneuverTimeMin || 0), 0)
      }

      const totalKm = totalMissions * 5
      return { driver, totalMissions, totalKm: Math.round(totalKm * 10) / 10, totalMin, avgDayMin: totalMissions > 0 ? Math.round(totalMin / 7) : 0 }
    })
  }, [storeDrivers, storePlans])

  const sectors = useMemo(() => {
    const set = new Set<string>()
    for (const d of (Array.isArray(storeDrivers) ? storeDrivers : [])) { if (d.sector) set.add(d.sector) }
    return Array.from(set).sort()
  }, [storeDrivers])

  const filteredDriverStats = useMemo(() => {
    const q = debouncedStatsSearch.toLowerCase()
    return driverStats.filter(({ driver }) => {
      if (q && !`${driver.firstName} ${driver.lastName}`.toLowerCase().includes(q)) return false
      if (sectorFilter !== 'all' && driver.sector !== sectorFilter) return false
      return true
    })
  }, [driverStats, debouncedStatsSearch, sectorFilter])

  const legalIssues = useMemo(() => {
    const issues: Array<{ driver: string; msg: string; severity: 'error' | 'warning' }> = []
    for (const driver of (Array.isArray(storeDrivers) ? storeDrivers : [])) {
      const key = `${driver.id}|${today()}`
      const plan = storePlans[key] || []
      if (plan.length === 0) continue

      const estWorkMin = plan.reduce((s, m) => s + (m.estimatedDurationMin || 0) + (m.maneuverTimeMin || 0), 0)
      const name = `${driver.firstName} ${driver.lastName}`
      if (estWorkMin > 600) {
        issues.push({ driver: name, msg: `Durée de travail estimée ${Math.round(estWorkMin)} min (max 600)`, severity: 'error' })
      } else if (estWorkMin > 540) {
        issues.push({ driver: name, msg: `Durée de travail estimée ${Math.round(estWorkMin)} min (proche du max)`, severity: 'warning' })
      }
    }
    return issues
  }, [storeDrivers, storePlans])

  const maxBar = Math.max(1, ...next7.map(d => missionsByDate[d] || 0))

  const last7Days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6)), [])

  const weekOverview = useMemo(() => {
    const activeDrivers = (Array.isArray(storeDrivers) ? storeDrivers : []).filter(d => !d.archived)
    const missionsPerDay: number[] = []
    const kmPerDay: number[] = []
    const driversPerDay: number[] = []
    const avgDurationPerDay: number[] = []

    for (const day of last7Days) {
      let dayMissions = 0
      let dayDriversActive = 0
      let dayTotalMin = 0

      for (const driver of activeDrivers) {
        const key = `${driver.id}|${day}`
        const plan = storePlans[key] || []
        const realCount = plan.filter((m: { isSynthetic?: boolean }) => !m.isSynthetic).length
        if (realCount > 0) {
          dayMissions += realCount
          dayDriversActive++

          dayTotalMin += plan.reduce((s: number, m: { estimatedDurationMin?: number; maneuverTimeMin?: number }) =>
            s + (m.estimatedDurationMin || 0) + (m.maneuverTimeMin || 0), 0)
        }
      }

      missionsPerDay.push(dayMissions)
      kmPerDay.push(Math.round(dayMissions * 5))
      driversPerDay.push(dayDriversActive)
      avgDurationPerDay.push(dayDriversActive > 0 ? Math.round(dayTotalMin / dayDriversActive) : 0)
    }

    return { missionsPerDay, kmPerDay, driversPerDay, avgDurationPerDay }
  }, [last7Days, storeDrivers, storePlans])

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2 border-b border-surface-200 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Statistiques</span>
        <input value={statsSearch} onChange={e => setStatsSearch(e.target.value)} placeholder="Rechercher chauffeur…"
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 placeholder-surface-400 text-xs focus:outline-none focus:border-[#0055A4] w-36 md:w-48" />
        <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}
          title="Filtrer par secteur"
          aria-label="Filtrer par secteur"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Tous les secteurs</option>
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-surface-400 text-xs hidden sm:block">Date :</span>
          <input type="date" value={statsDate} onChange={e => setStatsDate(e.target.value)}
            title="Date d'analyse"
            aria-label="Date d'analyse"
            className="bg-surface-100 border border-surface-200 rounded px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]" />
        </div>
      </div>
    <div className="flex-1 overflow-auto px-3 md:px-6 py-4 md:py-6 space-y-6 md:space-y-8">
      <ReportsPanel />

      {}
      <div>
        <h2 className="text-surface-900 font-bold text-sm mb-3 uppercase tracking-wider">Aperçu 7 jours</h2>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {([
            { label: 'Missions / jour', data: weekOverview.missionsPerDay, unit: '', color: '#0055A4' },
            { label: 'Km / jour', data: weekOverview.kmPerDay, unit: ' km', color: '#8b5cf6' },
            { label: 'Chauffeurs actifs / jour', data: weekOverview.driversPerDay, unit: '', color: '#22c55e' },
            { label: 'Durée moy. / jour', data: weekOverview.avgDurationPerDay, unit: ' min', color: '#f97316' },
          ] as const).map(card => {
            const todayVal = card.data[card.data.length - 1]
            const yesterdayVal = card.data[card.data.length - 2]
            const diff = todayVal - yesterdayVal
            const trendUp = diff > 0
            return (
              <div key={card.label} className="bg-white border border-surface-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <Sparkline data={card.data} width={80} height={24} color={card.color} />
                  {diff !== 0 && (
                    <span className={`text-xs font-semibold ${trendUp ? 'text-green-500' : 'text-red-500'}`}>
                      {trendUp ? '↑' : '↓'} {Math.abs(diff)}{card.unit}
                    </span>
                  )}
                  {diff === 0 && <span className="text-xs text-surface-400">=</span>}
                </div>
                <div className="text-2xl font-black tabular-nums" style={{ color: card.color }}>
                  {todayVal}{card.unit}
                </div>
                <div className="text-[10px] text-surface-400 uppercase tracking-wider mt-0.5">{card.label}</div>
              </div>
            )
          })}
        </div>
      </div>

      {}
      <div>
        <h2 className="text-surface-900 font-bold text-sm mb-3 uppercase tracking-wider flex items-center gap-2">
          Assignation — <span className="text-surface-400 capitalize font-normal normal-case">{displayShort(statsDate)}</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
          {[
            { label: 'Total pool',     value: assignmentStats.total,        color: 'text-surface-600',     icon: '📋' },
            { label: 'Assignées',      value: assignmentStats.assigned,     color: 'text-green-400',    icon: '✓' },
            { label: 'Non assignées',  value: assignmentStats.unassigned,   color: assignmentStats.unassigned > 0 ? 'text-orange-400' : 'text-surface-400', icon: '⏳' },
            { label: 'P1 assignées',   value: `${assignmentStats.p1Assigned}/${assignmentStats.p1Total}`, color: assignmentStats.p1Total > 0 && assignmentStats.p1Assigned < assignmentStats.p1Total ? 'text-red-400' : 'text-green-400', icon: '🔥' },
            { label: 'Chauffeurs actifs', value: `${assignmentStats.driversActive}/${assignmentStats.totalDrivers}`, color: 'text-[#0055A4]', icon: '👤' },
          ].map(k => (
            <div key={k.label} className="bg-white border border-surface-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-base">{k.icon}</span>
                <span className="text-surface-400 text-[10px] uppercase tracking-wider">{k.label}</span>
              </div>
              <div className={`text-2xl font-black tabular-nums ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>
        {}
        {assignmentStats.total > 0 && (
          <div className="bg-white border border-surface-200 rounded-xl p-5">
            <div className="flex flex-wrap gap-6 justify-center sm:justify-start">
              <GaugeCircle
                value={assignmentStats.assigned}
                max={assignmentStats.total}
                label="Missions assignées"
                color="#22c55e"
              />
              {assignmentStats.p1Total > 0 && (
                <GaugeCircle
                  value={assignmentStats.p1Assigned}
                  max={assignmentStats.p1Total}
                  label="P1 couvertes"
                  color="#ef4444"
                />
              )}
              <GaugeCircle
                value={assignmentStats.driversActive}
                max={assignmentStats.totalDrivers}
                label="Chauffeurs actifs"
                color="#0055A4"
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-surface-900 font-bold text-sm mb-3 uppercase tracking-wider">Vue d&apos;ensemble du pool</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Missions pool', value: allMissions.length, color: 'text-[#0055A4]', icon: '📋' },
            { label: 'P1 Urgents', value: p1Count, color: p1Count > 0 ? 'text-red-400' : 'text-surface-400', icon: '🔥' },
            { label: 'Chauffeurs', value: (Array.isArray(storeDrivers) ? storeDrivers : []).filter(d => !d.archived).length, color: 'text-green-400', icon: '👤' },
            { label: 'Sans GPS', value: noGps, color: noGps > 0 ? 'text-yellow-400' : 'text-surface-400', icon: '📍' },
          ].map(k => (
            <div key={k.label} className="bg-white border border-surface-200 rounded-xl px-4 py-4">
              <div className="flex items-center gap-2 mb-1">
                <span>{k.icon}</span>
                <span className="text-surface-400 text-[11px] uppercase tracking-wider">{k.label}</span>
              </div>
              <div className={`text-3xl font-black tabular-nums ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white border border-surface-200 rounded-xl p-5">
          <h3 className="text-surface-900 font-bold text-sm mb-4 uppercase tracking-wider">📅 Missions — 7 prochains jours</h3>
          <div className="space-y-2">
            {next7.map(d => {
              const count = missionsByDate[d] || 0
              const isToday = d === today()
              return (
                <div key={d} className="flex items-center gap-3">
                  <span className={`text-[11px] w-24 flex-shrink-0 capitalize ${isToday ? 'text-[#0055A4] font-bold' : 'text-surface-400'}`}>
                    {isToday ? '→ ' : ''}{displayShort(d)}
                  </span>
                  <div className="flex-1 h-5 bg-surface-100 rounded-md overflow-hidden">
                    <div className="h-full bg-[#0055A4] rounded-md transition-all duration-300"
                      style={{ width: `${(count / maxBar) * 100}%` }} />
                  </div>
                  <span className={`text-xs font-bold tabular-nums w-5 text-right ${count > 0 ? 'text-surface-900' : 'text-surface-300'}`}>{count}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-white border border-surface-200 rounded-xl p-5">
          <h3 className="text-surface-900 font-bold text-sm mb-4 uppercase tracking-wider">📊 Répartition par type</h3>
          {byType.length === 0 ? (
            <div className="text-surface-400 text-sm text-center py-4">Aucune mission dans le pool</div>
          ) : (
            <MiniBarChart
              data={byType.map(([type, count]) => ({
                label: `${missionIcon(type as MissionType)} ${missionLabel(type as MissionType)}`,
                value: count,
                max: maxTypeCount,
                barClass: (MISSION_TYPE_HEX[type as MissionType]
                  ? `bg-[${MISSION_TYPE_HEX[type as MissionType]}]/60`
                  : 'bg-surface-300/60'),
              }))}
            />
          )}
          <div className="mt-4 pt-4 border-t border-surface-200 grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'P1 Urgent', value: p1Count, cls: 'text-red-400 bg-red-50' },
              { label: 'P2 Normal', value: p2Count, cls: 'text-surface-600 bg-surface-100' },
              { label: 'P3 Flexible', value: p3Count, cls: 'text-surface-400 bg-white' },
            ].map(p => (
              <div key={p.label} className={`rounded-lg py-2 ${p.cls}`}>
                <div className="font-black text-lg tabular-nums">{p.value}</div>
                <div className="text-[9px] uppercase tracking-wider mt-0.5 opacity-70">{p.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-surface-200 rounded-xl p-5">
        <h3 className="text-surface-900 font-bold text-sm mb-4 uppercase tracking-wider">🚛 Performance chauffeurs — Semaine courante</h3>
        {filteredDriverStats.length === 0 ? (
          <div className="text-surface-400 text-sm text-center py-4">Aucun chauffeur</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[560px]">
            <thead>
              <tr>
                {['Chauffeur', 'Secteur', 'Missions', 'Km (sem.)', 'Charge km', 'Durée moy./jour'].map(h => (
                  <th key={h} className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-3 py-2 border-b border-surface-200 font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const maxKm = Math.max(1, ...filteredDriverStats.map(s => s.totalKm))
                return filteredDriverStats.map(({ driver, totalMissions, totalKm, avgDayMin }) => {
                  const kmPct = Math.min(100, (totalKm / maxKm) * 100)
                  const barCls = kmPct >= 90 ? 'bg-red-500/70' : kmPct >= 70 ? 'bg-orange-500/70' : 'bg-[#0055A4]/70'
                  return (
                <tr key={driver.id} className="border-b border-surface-100 hover:bg-surface-50">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-[#0055A4]/20 text-[#0055A4] flex items-center justify-center font-bold text-xs flex-shrink-0">
                        {(driver.firstName || '?')[0]}
                      </div>
                      <span className="text-surface-900 font-semibold text-sm">{driver.firstName} {driver.lastName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-surface-500 text-xs">{driver.sector}</td>
                  <td className="px-3 py-2.5">
                    <span className={`font-bold tabular-nums ${totalMissions > 0 ? 'text-surface-900' : 'text-surface-300'}`}>{totalMissions}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`font-bold tabular-nums ${totalKm > 0 ? 'text-[#0055A4]' : 'text-surface-300'}`}>{totalKm} km</span>
                  </td>
                  <td className="px-3 py-2.5 min-w-[100px]">
                    <div className="h-3 bg-surface-100 rounded overflow-hidden">
                      <div className={`h-full rounded transition-all duration-500 ${barCls}`} style={{ width: `${kmPct}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-xs ${avgDayMin > 0 ? 'text-surface-600' : 'text-surface-300'}`}>{avgDayMin > 0 ? formatDuration(avgDayMin) : '—'}</span>
                  </td>
                </tr>
              )
            })}
            )()}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="bg-white border border-surface-200 rounded-xl p-5">
        <h3 className="text-surface-900 font-bold text-sm mb-4 uppercase tracking-wider">⚠ Alertes légales — Aujourd&apos;hui</h3>
        {legalIssues.length === 0 ? (
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <span>✓</span>
            <span>Aucune alerte légale — toutes les tournées sont conformes</span>
          </div>
        ) : (
          <div className="space-y-2">
            {legalIssues.map((issue, i) => (
              <div key={i} className={`flex items-start gap-3 text-xs px-3 py-2 rounded-lg ${issue.severity === 'error' ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/20'}`}>
                <span className="flex-shrink-0 font-bold">{issue.driver}</span>
                <span>→ {issue.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
    </div>
  )
}
