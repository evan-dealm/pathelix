'use client'

import { useState, useRef, useCallback } from 'react'
import { exportCSV, exportExcel, parseExcelFile, parseCSVFile, generateTemplate } from '@/lib/exportUtils'
import type { ExportColumn } from '@/lib/exportUtils'
import { geocodeBatch } from '@/lib/geocode'

type AnyRow = Record<string, any>

interface ImportExportBarProps {

  columns: ExportColumn[]

  data: AnyRow[]

  filename: string

  parseRows: (_rows: Record<string, string>[]) => AnyRow[]

  onImport: (_items: AnyRow[]) => Promise<void>

  needsGeocode?: boolean

  fieldMapping?: Record<string, string[]>
}

export function ImportExportBar({
  columns,
  data,
  filename,
  parseRows,
  onImport,
  needsGeocode = false,
}: ImportExportBarProps) {
  const [showImportModal, setShowImportModal] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)

  return (
    <div className="inline-flex items-center gap-1.5">
      {}
      <div className="relative">
        <button type="button" onClick={() => setShowExportMenu(v => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-surface-100 hover:bg-surface-200 text-surface-600 border border-surface-200 transition-colors">
          ⬇ Export
          <span className="text-[9px] ml-0.5">▾</span>
        </button>
        {showExportMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
            <div className="absolute right-0 top-full mt-1 bg-white border border-surface-200 rounded-xl shadow-xl z-50 overflow-hidden min-w-[160px]">
              <button type="button"
                onClick={() => { exportCSV(columns, data, filename); setShowExportMenu(false) }}
                className="w-full text-left px-3 py-2 text-xs text-surface-600 hover:bg-surface-100 transition-colors flex items-center gap-2">
                <span className="text-surface-400">📄</span> Export CSV
                <span className="text-[10px] text-surface-400 ml-auto">{data.length} lignes</span>
              </button>
              <button type="button"
                onClick={() => { void exportExcel(columns, data, filename); setShowExportMenu(false) }}
                className="w-full text-left px-3 py-2 text-xs text-surface-600 hover:bg-surface-100 transition-colors flex items-center gap-2 border-t border-surface-100">
                <span className="text-surface-400">📊</span> Export Excel
                <span className="text-[10px] text-surface-400 ml-auto">.xlsx</span>
              </button>
            </div>
          </>
        )}
      </div>

      {}
      <button type="button" onClick={() => setShowImportModal(true)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-surface-100 hover:bg-surface-200 text-surface-600 border border-surface-200 transition-colors">
        ⬆ Import
      </button>

      {}
      {showImportModal && (
        <ImportModal
          columns={columns}
          parseRows={parseRows}
          onImport={onImport}
          onClose={() => setShowImportModal(false)}
          needsGeocode={needsGeocode}
          filename={filename}
        />
      )}
    </div>
  )
}

function ImportModal({
  columns,
  parseRows,
  onImport,
  onClose,
  needsGeocode,
  filename,
}: {
  columns: ExportColumn[]
  parseRows: (_rows: Record<string, string>[]) => AnyRow[]
  onImport: (_items: AnyRow[]) => Promise<void>
  onClose: () => void
  needsGeocode: boolean
  filename: string
}) {
  const [step, setStep] = useState<'upload' | 'preview' | 'geocoding' | 'importing' | 'done' | 'error'>('upload')
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [parsedItems, setParsedItems] = useState<AnyRow[]>([])
  const [fileName, setFileName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [importResult, setImportResult] = useState({ count: 0, errors: 0 })
  const [geocodeProgress, setGeocodeProgress] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name)
    try {
      let rows: Record<string, string>[]
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        rows = await parseExcelFile(file)
      } else {
        const text = await file.text()
        rows = parseCSVFile(text)
      }

      if (rows.length === 0) {
        setErrorMsg('Aucune donnée trouvée dans le fichier.')
        setStep('error')
        return
      }

      setRawRows(rows)
      const parsed = parseRows(rows)
      setParsedItems(parsed)

      if (parsed.length === 0) {
        setErrorMsg(`Fichier lu (${rows.length} lignes) mais aucune ligne valide après traitement. Vérifiez les en-têtes.`)
        setStep('error')
        return
      }

      setStep('preview')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de la lecture du fichier')
      setStep('error')
    }
  }, [parseRows])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }, [handleFile])

  async function handleConfirmImport() {

    if (needsGeocode) {
      const toGeo = parsedItems.filter(
        (i: AnyRow) => i.address && (!i.latitude || !i.longitude || (i.latitude === 0 && i.longitude === 0)),
      )
      if (toGeo.length > 0) {
        setStep('geocoding')
        await geocodeBatch(toGeo, (done, total, addr) => {
          setGeocodeProgress(`${done}/${total} — ${addr.slice(0, 40)}`)
        })
      }
    }

    setStep('importing')
    try {
      await onImport(parsedItems)
      setImportResult({ count: parsedItems.length, errors: 0 })
      setStep('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de l\'import')
      setStep('error')
    }
  }

  function downloadTemplate() {
    const csv = '\uFEFF' + generateTemplate(columns)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `template_${filename}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const previewKeys = rawRows.length > 0
    ? Object.keys(rawRows[0]).slice(0, 8)
    : []

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
          <div>
            <h3 className="text-sm font-bold text-surface-900">Importer des données</h3>
            <p className="text-[11px] text-surface-400 mt-0.5">Formats acceptés : CSV, Excel (.xlsx)</p>
          </div>
          <button type="button" onClick={onClose} className="text-surface-400 hover:text-surface-600 text-lg">✕</button>
        </div>

        {}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {}
          {step === 'upload' && (
            <div className="space-y-4">
              {}
              <div
                className="border-2 border-dashed border-surface-200 rounded-xl p-8 text-center hover:border-[#0055A4]/40 hover:bg-[#0055A4]/5 transition-colors cursor-pointer"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <div className="text-3xl mb-2">📁</div>
                <div className="text-sm text-surface-600 font-medium">
                  Glisser un fichier ici ou <span className="text-[#0055A4] underline">parcourir</span>
                </div>
                <div className="text-[11px] text-surface-400 mt-1">CSV (.csv) ou Excel (.xlsx)</div>
              </div>

              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.txt"
                className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
                aria-label="Importer un fichier" title="Importer un fichier" />

              {}
              <div className="flex items-center justify-between bg-surface-50 rounded-lg px-4 py-3">
                <div>
                  <div className="text-xs font-semibold text-surface-600">Modèle CSV</div>
                  <div className="text-[10px] text-surface-400">Téléchargez le modèle avec les en-têtes attendues</div>
                </div>
                <button type="button" onClick={downloadTemplate}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors">
                  📄 Télécharger
                </button>
              </div>

              {}
              <div>
                <div className="text-[10px] text-surface-400 uppercase tracking-wider font-bold mb-2">Colonnes attendues</div>
                <div className="flex flex-wrap gap-1">
                  {columns.map(c => (
                    <span key={c.key} className="text-[10px] bg-surface-100 text-surface-500 rounded px-2 py-0.5">
                      {c.header}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-surface-600">{fileName}</div>
                  <div className="text-[11px] text-surface-400">
                    {rawRows.length} ligne(s) lue(s) — <span className="text-green-600 font-semibold">{parsedItems.length} valide(s)</span>
                    {rawRows.length !== parsedItems.length && (
                      <span className="text-orange-500"> — {rawRows.length - parsedItems.length} ignorée(s)</span>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => setStep('upload')}
                  className="text-xs text-surface-400 hover:text-surface-600 transition-colors">
                  Changer de fichier
                </button>
              </div>

              {}
              <div className="border border-surface-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[300px]">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-[10px] text-surface-400 font-bold uppercase tracking-wider">#</th>
                        {previewKeys.map(k => (
                          <th key={k} className="px-2 py-1.5 text-left text-[10px] text-surface-400 font-bold uppercase tracking-wider">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rawRows.slice(0, 20).map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/50'}>
                          <td className="px-2 py-1 text-surface-300">{i + 1}</td>
                          {previewKeys.map(k => (
                            <td key={k} className="px-2 py-1 text-surface-600 max-w-[150px] truncate">{row[k] || ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rawRows.length > 20 && (
                  <div className="text-center text-[10px] text-surface-400 py-1.5 bg-surface-50 border-t border-surface-200">
                    ... et {rawRows.length - 20} ligne(s) de plus
                  </div>
                )}
              </div>
            </div>
          )}

          {}
          {step === 'geocoding' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-10 h-10 border-2 border-[#0055A4] border-t-transparent rounded-full animate-spin" />
              <div className="text-sm text-surface-600 font-semibold">Géocodage des adresses...</div>
              <div className="text-xs text-surface-400">{geocodeProgress}</div>
            </div>
          )}

          {}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-10 h-10 border-2 border-[#0055A4] border-t-transparent rounded-full animate-spin" />
              <div className="text-sm text-surface-600 font-semibold">Import en cours...</div>
              <div className="text-xs text-surface-400">{parsedItems.length} élément(s) à importer</div>
            </div>
          )}

          {}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="text-4xl">✅</div>
              <div className="text-sm text-surface-900 font-bold">Import terminé</div>
              <div className="text-xs text-surface-500">
                {importResult.count} élément(s) importé(s)
                {importResult.errors > 0 && (
                  <span className="text-orange-500"> — {importResult.errors} erreur(s)</span>
                )}
              </div>
            </div>
          )}

          {}
          {step === 'error' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="text-4xl">❌</div>
              <div className="text-sm text-red-500 font-bold">Erreur</div>
              <div className="text-xs text-surface-500 text-center max-w-[400px]">{errorMsg}</div>
              <button type="button" onClick={() => setStep('upload')}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-surface-100 hover:bg-surface-200 text-surface-600 border border-surface-200 transition-colors">
                Réessayer
              </button>
            </div>
          )}
        </div>

        {}
        <div className="flex items-center justify-between px-5 py-3 border-t border-surface-200 bg-surface-50">
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-xs text-surface-400 hover:text-surface-600 transition-colors">
            {step === 'done' ? 'Fermer' : 'Annuler'}
          </button>
          {step === 'preview' && (
            <button type="button" onClick={() => void handleConfirmImport()}
              className="px-5 py-2 text-xs font-bold rounded-lg bg-[#0055A4] hover:bg-[#004080] text-white transition-colors shadow-sm">
              Importer {parsedItems.length} élément(s)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
