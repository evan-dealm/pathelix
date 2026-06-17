'use client'

import { Driver, PlannedMission, MISSION_TYPE_HEX } from '@/lib/types'
import { TourResult, formatDuration } from '@/lib/algorithm'
import { Modal, Btn } from '../ui'
import { mTitle, displayShort } from '../hooks'
import { useTrade } from '@/providers/TradeProvider'

export function DriverDetailModal({ driver, result, plan, planDate, onEdit, onDelete, onClose }: {
  driver: Driver
  result: TourResult | null
  plan: PlannedMission[]
  planDate: string
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const { missionIcon } = useTrade()
  const initials = `${(driver.firstName || '?')[0]}`
  const warnings = result?.warnings || []
  return (
    <Modal title="Détail du chauffeur" onClose={onClose}>
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-[#0055A4]/20 text-[#0055A4] flex items-center justify-center font-black text-xl flex-shrink-0 overflow-hidden">{initials}</div>
        <div>
          <div className="text-surface-900 font-bold text-lg">{driver.firstName} {driver.lastName}</div>
          {driver.sector && <div className="text-surface-500 text-sm">{driver.sector}</div>}
          {driver.depotName && <div className="text-surface-400 text-xs">{driver.depotName}</div>}
        </div>
      </div>
      <div>
        <div className="text-surface-400 text-[11px] uppercase tracking-wider mb-1">Position dépôt</div>
        <div className="text-surface-500 text-xs font-mono">{driver.depotLat}, {driver.depotLng}</div>
        <a href={`https://www.google.com/maps?q=${encodeURIComponent(driver.depotLat)},${encodeURIComponent(driver.depotLng)}`} target="_blank" rel="noopener noreferrer" className="text-[#0055A4] hover:underline text-xs mt-0.5 inline-block">Voir sur Google Maps →</a>
      </div>
      <div>
        <div className="text-surface-400 text-[11px] uppercase tracking-wider mb-2">Planning du <span className="capitalize">{displayShort(planDate)}</span></div>
        {plan.length === 0 ? (
          <div className="text-surface-400 text-sm bg-surface-100 rounded-lg px-3 py-3 text-center">Aucune mission planifiée</div>
        ) : (
          <div className="space-y-1">
            {[...plan].sort((a, b) => a.sequenceOrder - b.sequenceOrder).map(pm => (
              <div key={pm.id} className="flex items-center gap-2 bg-surface-100 rounded-lg px-3 py-1.5">
                <span style={{ color: MISSION_TYPE_HEX[pm.type] }}>{missionIcon(pm.type)}</span>
                <span className="text-surface-900 text-xs flex-1 truncate">{mTitle(pm)}</span>
                <span className="text-surface-400 text-[11px]">{formatDuration(pm.estimatedDurationMin + pm.maneuverTimeMin)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {result && (
        <div className="bg-surface-100 rounded-xl p-4">
          <div className="grid grid-cols-2 gap-4 mb-3">
            {[
              { label: 'Durée totale',   value: formatDuration(result.totalDurationMin), color: 'text-surface-900' },
              { label: 'Distance route', value: `${result.totalRoadDistKm} km`,          color: 'text-[#0055A4]' },
              { label: 'Conduite',       value: formatDuration(result.totalDrivingMin),  color: 'text-yellow-400' },
              { label: 'Sur site',       value: formatDuration(result.totalOnSiteMin),   color: 'text-green-400' },
            ].map(s => (
              <div key={s.label}>
                <div className={`font-bold ${s.color}`}>{s.value}</div>
                <div className="text-surface-400 text-xs">{s.label}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="text-surface-400 text-xs mb-0.5">Fin de journée prévue</div>
            <div className="text-surface-900 font-semibold">{result.finishStr}</div>
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className={`text-xs px-3 py-2 rounded-lg flex items-start gap-2 ${w.severity === 'error' ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/20'}`}>
              <span>⚠</span><span>{w.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 pt-2 border-t border-surface-200">
        <Btn onClick={() => { onEdit(); onClose() }} variant="primary" size="sm">✏ Modifier</Btn>
        <Btn onClick={() => { onDelete(); onClose() }} variant="danger" size="sm">✕ Supprimer</Btn>
      </div>
    </Modal>
  )
}
