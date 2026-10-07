import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const mockFindMany = vi.hoisted(() => vi.fn())
const mockFindUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: { customTrade: { findMany: mockFindMany, findUnique: mockFindUnique } },
}))

// Same contract as the real bus: bust() runs this process's handlers, then tells the others.
const bus = vi.hoisted(() => ({
  handlers: [] as Array<(_key: string) => void>,
  published: [] as Array<{ kind: string; key: string }>,
}))
vi.mock('@/lib/cacheBus', () => ({
  onBust: (_kind: string, handler: (_key: string) => void) => { bus.handlers.push(handler) },
  bust: (kind: string, key: string) => { for (const h of bus.handlers) h(key); bus.published.push({ kind, key }) },
}))
/** What an instance receives when another one changed a trade. */
const fromAnotherInstance = async (tradeKey: string) => {
  for (const h of bus.handlers) h(tradeKey)
  await new Promise(resolve => setTimeout(resolve, 0))
}

import {
  customTradeRowToConfig, loadCustomTradesFromDb, syncCustomTradeRegistered, syncCustomTradeUnregistered,
} from '../customTrades'
import { getTradeConfig, unregisterCustomTrade } from '@/lib/trades'

const ROW = {
  tradeKey:            'transport_medical',
  tradeName:           'Transport Médical',
  tradeDescription:    'Transport de patients',
  tradeIcon:           '🚑',
  vocabulary:          { driver: 'Ambulancier', drivers: 'Ambulanciers', missionTypeLabels: { POSER: 'Prise en charge' } },
  enabledMissionTypes: ['POSER', 'RETIRER'],
}

afterEach(() => {
  unregisterCustomTrade('transport_medical')
  vi.clearAllMocks()
})

describe('customTradeRowToConfig', () => {
  it('maps a DB row to a TradeConfig, overlaying the top-level columns onto vocabulary', () => {
    const config = customTradeRowToConfig(ROW)
    expect(config.id).toBe('transport_medical')
    expect(config.vocabulary.tradeName).toBe('Transport Médical')
    expect(config.vocabulary.tradeIcon).toBe('🚑')
    expect(config.vocabulary.driver).toBe('Ambulancier')
    expect(config.vocabulary.missionTypeLabels.POSER).toBe('Prise en charge')
    expect(config.enabledMissionTypes).toEqual(['POSER', 'RETIRER'])
  })

  it('falls back to sane defaults for vocabulary fields the row does not provide', () => {
    const config = customTradeRowToConfig({ ...ROW, vocabulary: {} })
    expect(config.vocabulary.driver).toBe('Chauffeur')
    expect(config.vocabulary.mission).toBe('Mission')
  })

  it('does not throw on a malformed (non-object) vocabulary field', () => {
    expect(() => customTradeRowToConfig({ ...ROW, vocabulary: 'not-an-object' })).not.toThrow()
  })

  it('does not throw on a non-array enabledMissionTypes field', () => {
    const config = customTradeRowToConfig({ ...ROW, enabledMissionTypes: null })
    expect(config.enabledMissionTypes).toEqual([])
  })
})

describe('loadCustomTradesFromDb / syncCustomTradeRegistered / syncCustomTradeUnregistered', () => {
  it('registers every row returned by the DB', async () => {
    mockFindMany.mockResolvedValue([ROW])
    await loadCustomTradesFromDb()
    expect(getTradeConfig('transport_medical').id).toBe('transport_medical')
  })

  it('does not throw if the DB query fails (server boot must not crash on a transient DB issue)', async () => {
    mockFindMany.mockRejectedValue(new Error('DB unavailable'))
    await expect(loadCustomTradesFromDb()).resolves.toBeUndefined()
  })

  it('syncCustomTradeRegistered makes the trade immediately resolvable', () => {
    syncCustomTradeRegistered(ROW)
    expect(getTradeConfig('transport_medical').vocabulary.tradeName).toBe('Transport Médical')
  })

  it('syncCustomTradeUnregistered makes getTradeConfig fall back to default again', () => {
    syncCustomTradeRegistered(ROW)
    syncCustomTradeUnregistered('transport_medical')
    expect(getTradeConfig('transport_medical').id).not.toBe('transport_medical')
  })
})

// The registry is per process: without this, a second instance kept serving the default trade.
describe('custom trades across instances', () => {
  it('a change is announced to the other instances, and the instance that made it does not re-read the database', () => {
    bus.published.length = 0
    syncCustomTradeRegistered(ROW)
    syncCustomTradeUnregistered('transport_medical')
    expect(bus.published).toEqual([
      { kind: 'trades', key: 'transport_medical' },
      { kind: 'trades', key: 'transport_medical' },
    ])
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('an instance told about a new or edited trade reads it and resolves it', async () => {
    mockFindUnique.mockResolvedValue({ ...ROW, tradeName: 'Transport sanitaire' })
    await fromAnotherInstance('transport_medical')
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { tradeKey: 'transport_medical' } })
    expect(getTradeConfig('transport_medical').vocabulary.tradeName).toBe('Transport sanitaire')
  })

  it('an instance told about a deleted trade stops resolving it', async () => {
    syncCustomTradeRegistered(ROW)
    mockFindUnique.mockResolvedValue(null)
    await fromAnotherInstance('transport_medical')
    expect(getTradeConfig('transport_medical').id).not.toBe('transport_medical')
  })

  it('keeps the trade it knows when the database cannot be read', async () => {
    syncCustomTradeRegistered(ROW)
    mockFindUnique.mockRejectedValue(new Error('DB unavailable'))
    await fromAnotherInstance('transport_medical')
    expect(getTradeConfig('transport_medical').id).toBe('transport_medical')
  })
})
