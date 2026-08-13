'use client'

import { createContext, useContext, useMemo } from 'react'
import type { MissionType } from '@/lib/types'
import { MISSION_TYPE_LABELS, MISSION_TYPE_ICONS } from '@/lib/types'
import {
  type TradeId, type TradeConfig, type TradeVocabulary,
  DEFAULT_TRADE, getTradeConfig,
} from '@/lib/trades'

interface TradeContextValue {
  tradeId:    TradeId
  config:     TradeConfig
  vocab:      TradeVocabulary

  missionLabel: (_type: MissionType) => string

  missionIcon:  (_type: MissionType) => string

  isMissionEnabled: (_type: MissionType) => boolean

  enabledTypes: MissionType[]
}

const TradeContext = createContext<TradeContextValue | null>(null)

interface TradeProviderProps {
  tradeId: string | null | undefined
  // A9 (AUDIT_BUGS.md M5): custom trades are registered in a server-only, per-process registry
  // (instrumentation.ts) that the browser's own JS bundle never sees. When `tradeId` is a custom
  // trade, the caller (DataProvider) fetches its resolved config from /api/settings and passes
  // it here directly, bypassing the client's empty registry lookup in getTradeConfig().
  customConfig?: TradeConfig | null
  children: React.ReactNode
}

export function TradeProvider({ tradeId, customConfig, children }: TradeProviderProps) {
  const value = useMemo<TradeContextValue>(() => {
    // Delegate entirely to getTradeConfig — it already knows how to resolve built-in AND
    // custom trades (falling back to DEFAULT_TRADE only if truly unknown). Previously this
    // pre-check only accepted `tradeId in TRADES` (built-ins), silently discarding any custom
    // trade id before getTradeConfig ever got a chance to look it up.
    const config = customConfig && customConfig.id === tradeId ? customConfig : getTradeConfig(tradeId)
    const resolvedId = config.id as TradeId
    const vocab = config.vocabulary

    return {
      tradeId: resolvedId,
      config,
      vocab,
      missionLabel: (type: MissionType) =>
        vocab.missionTypeLabels[type] || MISSION_TYPE_LABELS[type] || type,
      missionIcon: (type: MissionType) =>
        vocab.missionTypeIcons[type] || MISSION_TYPE_ICONS[type] || '📋',
      isMissionEnabled: (type: MissionType) =>
        config.enabledMissionTypes.includes(type),
      enabledTypes: config.enabledMissionTypes,
    }
  }, [tradeId, customConfig])

  return (
    <TradeContext.Provider value={value}>
      {children}
    </TradeContext.Provider>
  )
}

export function useTrade(): TradeContextValue {
  const ctx = useContext(TradeContext)
  if (!ctx) {

    const config = getTradeConfig(DEFAULT_TRADE)
    return {
      tradeId: DEFAULT_TRADE,
      config,
      vocab: config.vocabulary,
      missionLabel: (type: MissionType) =>
        config.vocabulary.missionTypeLabels[type] || MISSION_TYPE_LABELS[type] || type,
      missionIcon: (type: MissionType) =>
        config.vocabulary.missionTypeIcons[type] || MISSION_TYPE_ICONS[type] || '📋',
      isMissionEnabled: (type: MissionType) =>
        config.enabledMissionTypes.includes(type),
      enabledTypes: config.enabledMissionTypes,
    }
  }
  return ctx
}
