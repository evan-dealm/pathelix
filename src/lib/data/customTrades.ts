import { unscopedPrisma } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { registerCustomTrade, unregisterCustomTrade, type TradeConfig, type TradeVocabulary } from '@/lib/trades'
import type { MissionType } from '@/lib/types'

const log = createLogger('data/customTrades')

interface CustomTradeRow {
  tradeKey:            string
  tradeName:           string
  tradeDescription:    string
  tradeIcon:           string
  vocabulary:          unknown
  enabledMissionTypes: unknown
}

export function customTradeRowToConfig(row: CustomTradeRow): TradeConfig {
  const baseVocab = row.vocabulary && typeof row.vocabulary === 'object'
    ? row.vocabulary as Record<string, unknown>
    : {}

  const vocabulary: TradeVocabulary = {
    tradeName:        row.tradeName,
    tradeDescription:  row.tradeDescription,
    tradeIcon:         row.tradeIcon,
    driver:            String(baseVocab.driver ?? 'Chauffeur'),
    drivers:           String(baseVocab.drivers ?? 'Chauffeurs'),
    vehicle:           String(baseVocab.vehicle ?? 'Véhicule'),
    vehicles:          String(baseVocab.vehicles ?? 'Véhicules'),
    mission:           String(baseVocab.mission ?? 'Mission'),
    missions:          String(baseVocab.missions ?? 'Missions'),
    exutoire:          String(baseVocab.exutoire ?? 'Site'),
    exutoires:         String(baseVocab.exutoires ?? 'Sites'),
    depot:             String(baseVocab.depot ?? 'Dépôt'),
    client:            String(baseVocab.client ?? 'Client'),
    tour:              String(baseVocab.tour ?? 'Tournée'),
    tours:              String(baseVocab.tours ?? 'Tournées'),
    binSize:           String(baseVocab.binSize ?? 'Taille'),
    wasteType:         String(baseVocab.wasteType ?? 'Type'),
    optimize:          String(baseVocab.optimize ?? 'Optimiser'),
    collect:           String(baseVocab.collect ?? 'Collecter'),
    missionTypeLabels: (baseVocab.missionTypeLabels as TradeVocabulary['missionTypeLabels']) ?? {},
    missionTypeIcons:  (baseVocab.missionTypeIcons as TradeVocabulary['missionTypeIcons']) ?? {},
  }

  return {
    id:                  row.tradeKey,
    vocabulary,
    enabledMissionTypes: Array.isArray(row.enabledMissionTypes)
      ? row.enabledMissionTypes as MissionType[]
      : [],
  }
}

let loaded = false

export async function ensureCustomTradesLoaded(): Promise<void> {
  if (loaded) return
  await loadCustomTradesFromDb()
}

export async function loadCustomTradesFromDb(): Promise<void> {
  try {
    // CustomTrade is intentionally global (superadmin-managed, shared across all tenants).
    const rows = await unscopedPrisma.customTrade.findMany()
    for (const row of rows) {
      registerCustomTrade(row.tradeKey, customTradeRowToConfig(row))
    }
    loaded = true
    log.info('Custom trades loaded', { count: rows.length })
  } catch (err) {
    log.error('Failed to load custom trades', { err: err instanceof Error ? err.message : String(err) })
  }
}

export function syncCustomTradeRegistered(row: CustomTradeRow): void {
  registerCustomTrade(row.tradeKey, customTradeRowToConfig(row))
}

export function syncCustomTradeUnregistered(tradeKey: string): void {
  unregisterCustomTrade(tradeKey)
}
