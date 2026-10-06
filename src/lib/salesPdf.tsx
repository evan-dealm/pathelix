import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import type { SalesDocumentData } from '@/lib/sales/document'

// Rendered by the PDF worker only (see pdfWorker.ts): @react-pdf cannot run inside Next's bundle.

const KIND_TITLE = { QUOTE: 'Devis', INVOICE: 'Facture', CREDIT_NOTE: 'Avoir', ORDER: 'Bon de commande' } as const
const UNIT: Record<string, string> = { UNIT: '', DAY: 'j', TON: 't', KM: 'km', PCT: '', FLAT: '', HOUR: 'h', M3: 'm³' }
const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`.replace(/ | /g, ' ')
const fr = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '')

const S = StyleSheet.create({
  page:   { fontFamily: 'Helvetica', fontSize: 9, padding: 36, color: '#1f2937' },
  header: { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '2pt solid #0055A4', paddingBottom: 10, marginBottom: 12 },
  title:  { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#0055A4', textAlign: 'right' },
  bold:   { fontFamily: 'Helvetica-Bold' },
  muted:  { color: '#6b7280', fontSize: 8 },
  parties:{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  box:    { border: '1pt solid #e5e7eb', borderRadius: 4, padding: 8, width: '48%' },
  th:     { flexDirection: 'row', borderBottom: '1pt solid #d1d5db', paddingBottom: 4, color: '#6b7280', fontSize: 8 },
  tr:     { flexDirection: 'row', borderBottom: '0.5pt solid #f1f5f9', paddingVertical: 4 },
  cLabel: { width: '44%' }, cNum: { width: '11.2%', textAlign: 'right' },
  totals: { marginLeft: 'auto', width: '45%', marginTop: 10 },
  trow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grand:  { flexDirection: 'row', justifyContent: 'space-between', borderTop: '1pt solid #1f2937', paddingTop: 4, marginTop: 2, fontFamily: 'Helvetica-Bold', fontSize: 11 },
  footer: { position: 'absolute', bottom: 24, left: 36, right: 36, fontSize: 7.5, color: '#6b7280', borderTop: '0.5pt solid #e5e7eb', paddingTop: 4 },
})

function SalesDoc({ d }: { d: SalesDocumentData }) {
  const balance = d.amountPaid !== undefined && d.amountPaid > 0 ? d.totals.totalTTC - d.amountPaid : null
  return (
    <Document title={`${KIND_TITLE[d.kind]} ${d.number}`}>
      <Page size="A4" style={S.page}>
        <View style={S.header}>
          <View>
            <Text style={[S.bold, { fontSize: 11 }]}>{d.company.name || d.company.legalName}</Text>
            <Text style={S.muted}>{d.company.address}</Text>
          </View>
          <View>
            <Text style={S.title}>{KIND_TITLE[d.kind]}</Text>
            <Text style={[S.bold, { textAlign: 'right' }]}>{d.number}</Text>
            {d.draft && <Text style={{ textAlign: 'right', color: '#b45309' }}>Brouillon — sans valeur</Text>}
            {!!d.issueDate && <Text style={{ textAlign: 'right' }}>Date : {fr(d.issueDate)}</Text>}
            {!!d.validUntil && <Text style={{ textAlign: 'right' }}>Valable jusqu&apos;au {fr(d.validUntil)}</Text>}
            {!!d.dueDate && <Text style={{ textAlign: 'right' }}>Échéance : {fr(d.dueDate)}</Text>}
            {!!d.periodStart && !!d.periodEnd && <Text style={{ textAlign: 'right' }}>Période : {fr(d.periodStart)} – {fr(d.periodEnd)}</Text>}
            {!!d.creditedNumber && <Text style={{ textAlign: 'right' }}>Avoir sur la facture {d.creditedNumber}</Text>}
          </View>
        </View>
        <View style={S.parties}>
          <View style={{ width: '48%' }}>
            {!!d.title && <Text style={S.bold}>{d.title}</Text>}
            {!!d.site && <Text style={S.muted}>Chantier : {d.site.name}{d.site.address ? `, ${d.site.address}` : ''}</Text>}
          </View>
          <View style={S.box}>
            <Text style={S.muted}>Client</Text>
            <Text style={S.bold}>{d.client.name}</Text>
            <Text>{d.client.address}</Text>
            {!!d.client.siret && <Text style={S.muted}>SIRET {d.client.siret}</Text>}
          </View>
        </View>
        <View style={S.th}>
          <Text style={S.cLabel}>Désignation</Text><Text style={S.cNum}>Qté</Text><Text style={S.cNum}>PU HT</Text>
          <Text style={S.cNum}>Remise</Text><Text style={S.cNum}>TVA</Text><Text style={S.cNum}>Total HT</Text>
        </View>
        {d.lines.map((l, i) => (
          <View key={i} style={S.tr} wrap={false}>
            <View style={S.cLabel}><Text>{l.label}</Text>{!!l.description && <Text style={S.muted}>{l.description}</Text>}</View>
            <Text style={S.cNum}>{`${l.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}${UNIT[l.unit] ? ` ${UNIT[l.unit]}` : ''}`}</Text>
            <Text style={S.cNum}>{eur(l.unitPrice)}</Text>
            <Text style={S.cNum}>{l.discountPct ? `${l.discountPct} %` : ''}</Text>
            <Text style={S.cNum}>{l.vatRate} %</Text>
            <Text style={S.cNum}>{eur(l.amountHT)}</Text>
          </View>
        ))}
        <View style={S.totals}>
          <View style={S.trow}><Text>Total HT</Text><Text>{eur(d.totals.totalHT)}</Text></View>
          {d.totals.vatByRate.map(v => <View key={v.rate} style={S.trow}><Text>TVA {v.rate} % sur {eur(v.base)}</Text><Text>{eur(v.vat)}</Text></View>)}
          <View style={S.grand}><Text>Total TTC</Text><Text>{eur(d.totals.totalTTC)}</Text></View>
          {balance !== null && <View style={S.trow}><Text>Déjà réglé</Text><Text>{eur(d.amountPaid ?? 0)}</Text></View>}
          {balance !== null && <View style={[S.trow, S.bold]}><Text>Reste à payer</Text><Text>{eur(balance)}</Text></View>}
        </View>
        {!!d.notes && <Text style={{ marginTop: 10 }}>{d.notes}</Text>}
        {!!d.terms && <Text style={[S.muted, { marginTop: 6 }]}>{d.terms}</Text>}
        {d.kind === 'QUOTE' && <Text style={{ marginTop: 14 }}>Bon pour accord — date, nom et signature :</Text>}
        <View style={S.footer} fixed>
          {d.kind !== 'QUOTE' && !!d.paymentTerms && <Text>{d.paymentTerms}</Text>}
          {d.kind !== 'QUOTE' && !!d.company.iban && <Text>Règlement par virement : IBAN {d.company.iban}</Text>}
          <Text>{[d.company.legalName, d.company.siret ? `SIRET ${d.company.siret}` : '', d.company.vatNumber ? `TVA ${d.company.vatNumber}` : ''].filter(Boolean).join(' — ')}</Text>
        </View>
      </Page>
    </Document>
  )
}

export async function renderSalesPdf(d: SalesDocumentData): Promise<Buffer> {
  return renderToBuffer(<SalesDoc d={d} />)
}
