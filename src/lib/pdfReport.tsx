import React from 'react'
import {
  Document, Page, Text, View, StyleSheet, renderToBuffer,
} from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: {
    fontFamily:      'Helvetica',
    fontSize:        10,
    padding:         40,
    color:           '#1a1a1a',
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   24,
    paddingBottom:  12,
    borderBottom:   '1pt solid #e5e7eb',
  },
  title: {
    fontSize:   20,
    fontFamily: 'Helvetica-Bold',
    color:      '#0055A4',
  },
  subtitle: {
    fontSize: 10,
    color:    '#6b7280',
    marginTop: 2,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize:     12,
    fontFamily:   'Helvetica-Bold',
    color:        '#0055A4',
    marginBottom:  8,
    paddingBottom: 4,
    borderBottom:  '1pt solid #e5e7eb',
  },
  kpiRow: {
    flexDirection: 'row',
    gap:            8,
    marginBottom:   8,
  },
  kpiCard: {
    flex:            1,
    backgroundColor: '#f0f7ff',
    borderRadius:    6,
    padding:         10,
  },
  kpiValue: {
    fontSize:   16,
    fontFamily: 'Helvetica-Bold',
    color:      '#0055A4',
  },
  kpiLabel: {
    fontSize: 8,
    color:    '#6b7280',
    marginTop: 2,
  },
  table: {
    marginBottom: 12,
  },
  tableHead: {
    flexDirection:   'row',
    backgroundColor: '#0055A4',
    padding:          4,
    borderRadius:     2,
  },
  tableHeadCell: {
    flex:       1,
    fontSize:   8,
    fontFamily: 'Helvetica-Bold',
    color:      '#ffffff',
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: 'row',
    padding:        4,
    borderBottom:   '0.5pt solid #f0f0f0',
  },
  tableRowAlt: {
    backgroundColor: '#f9fafb',
  },
  tableCell: {
    flex:            1,
    fontSize:        9,
    color:           '#374151',
    paddingHorizontal: 4,
  },
  footer: {
    position:  'absolute',
    bottom:     30,
    left:       40,
    right:      40,
    fontSize:    8,
    color:       '#9ca3af',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
})

export interface MonthlyReportData {
  tenantName:        string
  month:             string
  period:            string
  totalMissions:     number
  completedMissions: number
  cancelledMissions: number
  totalDistanceKm:   number
  totalFuelEur:      number
  avgMissionDurMin:  number
  topDrivers: Array<{
    name:             string
    missionCount:     number
    distanceKm:       number
    avgDurationMin:   number
  }>
  missionsByType: Array<{
    type:  string
    count: number
    pct:   number
  }>
  generatedAt: string
}

function MonthlyReport({ data }: { data: MonthlyReportData }) {
  const completionRate = data.totalMissions > 0
    ? Math.round((data.completedMissions / data.totalMissions) * 100)
    : 0

  return (
    <Document title={`Rapport mensuel Pathélix — ${data.month}`}>
      <Page size="A4" style={styles.page}>

        {}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Pathélix</Text>
            <Text style={styles.subtitle}>{data.tenantName}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#1a1a1a', textAlign: 'right' }}>
              Rapport mensuel
            </Text>
            <Text style={{ fontSize: 10, color: '#6b7280', textAlign: 'right' }}>{data.month}</Text>
            <Text style={{ fontSize: 9, color: '#9ca3af', textAlign: 'right' }}>{data.period}</Text>
          </View>
        </View>

        {}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Résumé opérationnel</Text>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{data.totalMissions}</Text>
              <Text style={styles.kpiLabel}>Missions totales</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={[styles.kpiValue, { color: '#059669' }]}>{completionRate}%</Text>
              <Text style={styles.kpiLabel}>Taux de complétion</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{Math.round(data.totalDistanceKm)} km</Text>
              <Text style={styles.kpiLabel}>Distance totale</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={[styles.kpiValue, { color: '#f59e0b' }]}>{data.totalFuelEur.toFixed(0)} €</Text>
              <Text style={styles.kpiLabel}>Carburant estimé</Text>
            </View>
          </View>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{data.completedMissions}</Text>
              <Text style={styles.kpiLabel}>Missions effectuées</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={[styles.kpiValue, { color: '#ef4444' }]}>{data.cancelledMissions}</Text>
              <Text style={styles.kpiLabel}>Annulations</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{Math.round(data.avgMissionDurMin)} min</Text>
              <Text style={styles.kpiLabel}>Durée moy. intervention</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{(data.totalDistanceKm / Math.max(1, data.completedMissions)).toFixed(1)} km</Text>
              <Text style={styles.kpiLabel}>Distance moy./mission</Text>
            </View>
          </View>
        </View>

        {}
        {data.topDrivers.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top chauffeurs</Text>
            <View style={styles.table}>
              <View style={styles.tableHead}>
                <Text style={styles.tableHeadCell}>Chauffeur</Text>
                <Text style={styles.tableHeadCell}>Missions</Text>
                <Text style={styles.tableHeadCell}>Distance (km)</Text>
                <Text style={styles.tableHeadCell}>Durée moy. (min)</Text>
              </View>
              {data.topDrivers.slice(0, 10).map((d, i) => (
                <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
                  <Text style={styles.tableCell}>{d.name}</Text>
                  <Text style={styles.tableCell}>{d.missionCount}</Text>
                  <Text style={styles.tableCell}>{Math.round(d.distanceKm)}</Text>
                  <Text style={styles.tableCell}>{Math.round(d.avgDurationMin)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {}
        {data.missionsByType.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Répartition par type</Text>
            <View style={styles.table}>
              <View style={styles.tableHead}>
                <Text style={styles.tableHeadCell}>Type</Text>
                <Text style={styles.tableHeadCell}>Nb missions</Text>
                <Text style={styles.tableHeadCell}>% du total</Text>
              </View>
              {data.missionsByType.map((t, i) => (
                <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
                  <Text style={styles.tableCell}>{t.type}</Text>
                  <Text style={styles.tableCell}>{t.count}</Text>
                  <Text style={styles.tableCell}>{t.pct}%</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {}
        <View style={styles.footer} fixed>
          <Text>Généré par Pathélix le {data.generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function generateMonthlyReportPdf(data: MonthlyReportData): Promise<Buffer> {
  return renderToBuffer(<MonthlyReport data={data} />)
}
