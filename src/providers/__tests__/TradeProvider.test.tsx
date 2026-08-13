// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TradeProvider, useTrade } from '@/providers/TradeProvider'
import type { TradeConfig } from '@/lib/trades'

afterEach(cleanup)

function Probe() {
  const { tradeId, vocab, missionLabel } = useTrade()
  return (
    <div>
      <span data-testid="tradeId">{tradeId}</span>
      <span data-testid="driverLabel">{vocab.driver}</span>
      <span data-testid="poserLabel">{missionLabel('POSER')}</span>
    </div>
  )
}

const CUSTOM_CONFIG: TradeConfig = {
  id: 'transport_medical',
  vocabulary: {
    tradeName: 'Transport Médical', tradeDescription: '', tradeIcon: '🚑',
    driver: 'Ambulancier', drivers: 'Ambulanciers',
    vehicle: 'Ambulance', vehicles: 'Ambulances',
    mission: 'Course', missions: 'Courses',
    exutoire: 'Site', exutoires: 'Sites',
    depot: 'Dépôt', client: 'Patient', tour: 'Tournée', tours: 'Tournées',
    binSize: 'Taille', wasteType: 'Type', optimize: 'Optimiser', collect: 'Collecter',
    missionTypeLabels: { POSER: 'Prise en charge' },
    missionTypeIcons: {},
  },
  enabledMissionTypes: ['POSER', 'RETIRER'],
}

describe('TradeProvider — custom trade client hydration (A9)', () => {
  // Regression: without a client-hydrated config, a custom (superadmin-created) trade id falls
  // through getTradeConfig()'s client-side registry (always empty in the browser — custom trades
  // are only ever registered server-side via instrumentation.ts) straight to DEFAULT_TRADE,
  // silently showing the wrong vocabulary to any tenant using a custom trade.
  it('uses server-fetched customConfig when tradeId matches a non-built-in trade', () => {
    render(
      <TradeProvider tradeId="transport_medical" customConfig={CUSTOM_CONFIG}>
        <Probe />
      </TradeProvider>,
    )
    expect(screen.getByTestId('tradeId').textContent).toBe('transport_medical')
    expect(screen.getByTestId('driverLabel').textContent).toBe('Ambulancier')
    expect(screen.getByTestId('poserLabel').textContent).toBe('Prise en charge')
  })

  it('falls back to built-in trade resolution when customConfig is absent', () => {
    render(
      <TradeProvider tradeId="collecte_recyclage">
        <Probe />
      </TradeProvider>,
    )
    expect(screen.getByTestId('tradeId').textContent).toBe('collecte_recyclage')
    expect(screen.getByTestId('driverLabel').textContent).toBe('Chauffeur')
  })

  it('ignores customConfig when its id does not match the current tradeId', () => {
    render(
      <TradeProvider tradeId="collecte_recyclage" customConfig={CUSTOM_CONFIG}>
        <Probe />
      </TradeProvider>,
    )
    expect(screen.getByTestId('tradeId').textContent).toBe('collecte_recyclage')
    expect(screen.getByTestId('driverLabel').textContent).toBe('Chauffeur')
  })
})
