'use client'

import { useState } from 'react'
import { SubTabs } from './shared'
import { QuotesView } from './QuotesView'
import { OrdersView } from './OrdersView'
import { ContractsView } from './ContractsView'
import { PricingView } from './PricingView'

type View = 'quotes' | 'orders' | 'contracts' | 'pricing'

/** Sales: quotes → orders, framework contracts and price grids. */
export function SalesTab() {
  const [view, setView] = useState<View>('quotes')
  const [openOrder, setOpenOrder] = useState<string | null>(null)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-surface-200 px-4 py-3">
        <h1 className="font-display text-lg font-semibold text-surface-900">Ventes</h1>
        <SubTabs label="Ventes" value={view} onChange={setView} tabs={[['quotes', 'Devis'], ['orders', 'Commandes'], ['contracts', 'Contrats'], ['pricing', 'Tarifs']]} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {view === 'quotes' && <QuotesView onOpenOrder={id => { setOpenOrder(id); setView('orders') }} />}
        {view === 'orders' && <OrdersView openId={openOrder} onOpened={() => setOpenOrder(null)} />}
        {view === 'contracts' && <ContractsView />}
        {view === 'pricing' && <PricingView />}
      </div>
    </div>
  )
}
