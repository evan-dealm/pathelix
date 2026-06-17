'use client'

import { createContext, useContext, useMemo } from 'react'
import type { MissionType } from '@/lib/types'
import { MISSION_TYPE_LABELS, MISSION_TYPE_ICONS } from '@/lib/types'
import {
  type TradeId, type TradeConfig, type TradeVocabulary,
  TRADES, DEFAULT_TRADE, getTradeConfig,
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
  children: React.ReactNode
}

export function TradeProvider({ tradeId, children }: TradeProviderProps) {
  const value = useMemo<TradeContextValue>(() => {
    const resolvedId = (tradeId && tradeId in TRADES ? tradeId : DEFAULT_TRADE) as TradeId
    const config = getTradeConfig(resolvedId)
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
  }, [tradeId])

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
