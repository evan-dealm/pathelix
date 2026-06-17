export interface ExportColumn {
  key: string
  header: string

  format?: (_value: unknown) => string | number
}

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function exportCSV(
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
  filename: string,
): void {
  const header = columns.map(c => escapeCSV(c.header)).join(';')
  const lines = rows.map(row =>
    columns.map(c => {
      const raw = row[c.key]
      const val = c.format ? c.format(raw) : raw
      return escapeCSV(val)
    }).join(';'),
  )
  const bom = '\uFEFF'
  const csv = bom + [header, ...lines].join('\r\n')
  downloadBlob(csv, `${filename}.csv`, 'text/csv;charset=utf-8;')
}

export async function exportExcel(
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
  filename: string,
): Promise<void> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Pathélix'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(filename)

  sheet.columns = columns.map(c => ({
    header: c.header,
    key: c.key,
    width: Math.max(12, c.header.length + 4),
  }))

  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, size: 11 }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0055A4' },
  }
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  headerRow.height = 28

  for (const row of rows) {
    const values: Record<string, unknown> = {}
    for (const c of columns) {
      const raw = row[c.key]
      values[c.key] = c.format ? c.format(raw) : (raw ?? '')
    }
    sheet.addRow(values)
  }

  if (rows.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: columns.length },
    }
  }

  for (let i = 2; i <= rows.length + 1; i++) {
    if (i % 2 === 0) {
      sheet.getRow(i).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F7FA' },
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(
    buffer as ArrayBuffer,
    `${filename}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
}

function downloadBlob(content: string | ArrayBuffer, filename: string, mimeType: string): void {
  const blob = content instanceof ArrayBuffer
    ? new Blob([content], { type: mimeType })
    : new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function parseExcelFile(file: File): Promise<Record<string, string>[]> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const buffer = await file.arrayBuffer()
  await workbook.xlsx.load(buffer)

  const sheet = workbook.worksheets[0]
  if (!sheet || sheet.rowCount < 2) return []

  const headers: string[] = []
  const headerRow = sheet.getRow(1)
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]/g, '')
  })

  const rows: Record<string, string>[] = []
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i)
    if (!row.hasValues) continue
    const obj: Record<string, string> = {}
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1]
      if (header) {
        obj[header] = cell.value !== null && cell.value !== undefined
          ? String(cell.value).trim()
          : ''
      }
    })

    if (Object.values(obj).some(v => v !== '')) {
      rows.push(obj)
    }
  }

  return rows
}

export function parseCSVFile(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const sep = lines[0].includes(';') ? ';' : ','
  function splitRow(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (ch === sep && !inQuotes) { result.push(current.trim()); current = ''; continue }
      current += ch
    }
    result.push(current.trim())
    return result
  }

  const headers = splitRow(lines[0]).map(h =>
    h.toLowerCase().trim().replace(/[^a-z0-9_]/g, ''),
  )

  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i])
    const obj: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) obj[headers[j]] = cols[j] ?? ''
    }
    if (Object.values(obj).some(v => v !== '')) {
      rows.push(obj)
    }
  }
  return rows
}

export function generateTemplate(columns: ExportColumn[]): string {
  return columns.map(c => escapeCSV(c.header)).join(';')
}
