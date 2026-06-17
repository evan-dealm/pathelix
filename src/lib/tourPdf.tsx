import React from 'react'
import {
  Document, Page, Text, View, StyleSheet, renderToBuffer,
} from '@react-pdf/renderer'
import type { Driver, PlannedMission } from '@/lib/types'

function minToHHMM(min: number): string {
  const h = Math.floor(((min % 1440) + 1440) % 1440 / 60)
  const m = Math.floor(((min % 1440) + 1440) % 1440 % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const S = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize:   9,
    padding:    32,
    color:      '#1a1a1a',
  },
  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
    marginBottom:   16,
    paddingBottom:  12,
    borderBottom:   '2pt solid #0055A4',
  },
  title: {
    fontSize:   16,
    fontFamily: 'Helvetica-Bold',
    color:      '#0055A4',
  },
  sub: {
    fontSize:  9,
    color:     '#6b7280',
    marginTop: 2,
  },
  meta: {
    fontSize:  9,
    color:     '#374151',
    textAlign: 'right',
  },
  metaBold: {
    fontSize:   10,
    fontFamily: 'Helvetica-Bold',
    color:      '#0055A4',
    textAlign:  'right',
  },
  summaryRow: {
    flexDirection:   'row',
    gap:             12,
    marginBottom:    14,
    backgroundColor: '#f0f5ff',
    borderRadius:    4,
    padding:         8,
  },
  summaryBox: {
    flex:  1,
    alignItems: 'center',
  },
  summaryVal: {
    fontSize:   13,
    fontFamily: 'Helvetica-Bold',
    color:      '#0055A4',
  },
  summaryLbl: {
    fontSize: 8,
    color:    '#6b7280',
    marginTop: 2,
  },
  tableHeader: {
    flexDirection:   'row',
    backgroundColor: '#0055A4',
    color:           '#ffffff',
    fontFamily:      'Helvetica-Bold',
    fontSize:        8,
    padding:         '5pt 6pt',
    borderRadius:    '3pt 3pt 0 0',
  },
  row: {
    flexDirection: 'row',
    padding:       '5pt 6pt',
    borderBottom:  '0.5pt solid #e5e7eb',
    alignItems:    'flex-start',
  },
  rowAlt: {
    flexDirection: 'row',
    padding:       '5pt 6pt',
    borderBottom:  '0.5pt solid #e5e7eb',
    backgroundColor: '#f9fafb',
    alignItems:    'flex-start',
  },
  rowDone: {
    flexDirection: 'row',
    padding:       '5pt 6pt',
    borderBottom:  '0.5pt solid #e5e7eb',
    backgroundColor: '#f0fdf4',
    alignItems:    'flex-start',
  },

  colN:    { width: 22 },
  colTime: { width: 38 },
  colType: { width: 44 },
  colClient: { flex: 1 },
  colAddress: { flex: 2 },
  colDur:   { width: 34 },
  colSig:   { width: 36 },
  colTxt: { fontSize: 8, color: '#374151' },
  colTxtSmall: { fontSize: 7, color: '#6b7280', marginTop: 1 },
  note: {
    backgroundColor: '#fffbeb',
    borderLeft:      '2pt solid #f59e0b',
    padding:         '4pt 6pt',
    marginTop:       6,
    fontSize:        8,
    color:           '#92400e',
  },
  footer: {
    position: 'absolute',
    bottom:   20,
    left:     32,
    right:    32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize:  8,
    color:     '#9ca3af',
    borderTop: '0.5pt solid #e5e7eb',
    paddingTop: 6,
  },
})

interface TourStep {
  arrivalMin:   number
  roadDistKm:   number
  travelTimeMin: number
}

interface TourPdfProps {
  driver:    Driver
  missions:  PlannedMission[]
  date:      string
  startTime: string
  steps:     TourStep[]
  totalKm:   number
  totalMin:  number
}

function TourDocument({ driver, missions, date, startTime, steps, totalKm, totalMin }: TourPdfProps) {
  const real    = missions.filter(m => !m.isSynthetic)
  const dateStr = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const generatedAt = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <Document>
      <Page size="A4" style={S.page}>

        {}
        <View style={S.header}>
          <View>
            <Text style={S.title}>Feuille de route</Text>
            <Text style={S.sub}>{dateStr}</Text>
          </View>
          <View>
            <Text style={S.metaBold}>{driver.firstName} {driver.lastName}</Text>
            <Text style={S.meta}>Secteur : {driver.sector}</Text>
            <Text style={S.meta}>Départ : {startTime}</Text>
          </View>
        </View>

        {}
        <View style={S.summaryRow}>
          <View style={S.summaryBox}>
            <Text style={S.summaryVal}>{real.length}</Text>
            <Text style={S.summaryLbl}>missions</Text>
          </View>
          <View style={S.summaryBox}>
            <Text style={S.summaryVal}>{Math.round(totalKm)} km</Text>
            <Text style={S.summaryLbl}>distance totale</Text>
          </View>
          <View style={S.summaryBox}>
            <Text style={S.summaryVal}>{minToHHMM(totalMin)}</Text>
            <Text style={S.summaryLbl}>durée estimée</Text>
          </View>
          <View style={S.summaryBox}>
            <Text style={S.summaryVal}>{driver.vehicleCapacity ?? 1}</Text>
            <Text style={S.summaryLbl}>benne(s)</Text>
          </View>
        </View>

        {}
        <View style={S.tableHeader}>
          <Text style={S.colN}>#</Text>
          <Text style={S.colTime}>Heure</Text>
          <Text style={S.colType}>Type</Text>
          <Text style={S.colClient}>Client</Text>
          <Text style={S.colAddress}>Adresse</Text>
          <Text style={S.colDur}>Durée</Text>
          <Text style={S.colSig}>Signature</Text>
        </View>

        {}
        {real.map((m, idx) => {
          const step = steps[idx]
          const rowStyle = idx % 2 === 0 ? S.row : S.rowAlt
          return (
            <View key={m.id} style={rowStyle} wrap={false}>
              <Text style={{ ...S.colN, ...S.colTxt }}>{idx + 1}</Text>
              <Text style={{ ...S.colTime, ...S.colTxt }}>{step ? minToHHMM(step.arrivalMin) : '—'}</Text>
              <Text style={{ ...S.colType, ...S.colTxt }}>{m.type}</Text>
              <View style={S.colClient}>
                <Text style={S.colTxt}>{m.clientName || m.outletName || '—'}</Text>
                {m.wasteTypeLabel && <Text style={S.colTxtSmall}>{m.wasteTypeLabel}</Text>}
              </View>
              <View style={S.colAddress}>
                <Text style={S.colTxt}>{m.address}</Text>
                {m.accessNotes && <Text style={S.colTxtSmall}>⚠ {m.accessNotes}</Text>}
                {m.timeWindow && (
                  <Text style={S.colTxtSmall}>
                    Créneau : {minToHHMM(m.timeWindow.openMin)}–{minToHHMM(m.timeWindow.closeMin)}
                  </Text>
                )}
              </View>
              <Text style={{ ...S.colDur, ...S.colTxt }}>
                {m.estimatedDurationMin + m.maneuverTimeMin}min
              </Text>
              {}
              <View style={{ ...S.colSig, height: 24, border: '0.5pt solid #d1d5db', borderRadius: 2 }} />
            </View>
          )
        })}

        {}
        {driver.notes && (
          <View style={S.note}>
            <Text>Note chauffeur : {driver.notes}</Text>
          </View>
        )}

        {}
        <View style={S.footer} fixed>
          <Text>Pathélix — {driver.firstName} {driver.lastName} — {date}</Text>
          <Text>Généré le {generatedAt}</Text>
        </View>

      </Page>
    </Document>
  )
}

export async function renderTourPdf(props: TourPdfProps): Promise<Buffer> {
  return renderToBuffer(<TourDocument {...props} />)
}
