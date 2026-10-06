import { escapeHtml } from '@/lib/html'
import { qrUrl } from './shared'

/**
 * Opens a print sheet of QR labels (A4, 3 × 7 labels): fleet number, type and QR code pointing to
 * /c/<token>. Built in a new window so the admin UI is untouched; the user prints from there.
 */
export async function printQrLabels(items: Array<{ number: string; qrToken: string; typeName: string }>, company: string): Promise<void> {
  const QRCode = (await import('qrcode')).default
  const labels = await Promise.all(items.map(async it => {
    const svg = await QRCode.toString(qrUrl(it.qrToken), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
    return `<div class="label"><div class="qr">${svg}</div><div class="txt"><div class="num">${escapeHtml(it.number)}</div><div class="type">${escapeHtml(it.typeName)}</div><div class="co">${escapeHtml(company)}</div></div></div>`
  }))
  const w = window.open('', '_blank')
  if (!w) throw new Error('Autorisez les fenêtres pop-up pour imprimer les étiquettes')
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes QR</title><style>
    @page { size: A4; margin: 8mm }
    body { font-family: system-ui, sans-serif; margin: 0 }
    .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm }
    .label { border: 1px dashed #bbb; border-radius: 3mm; padding: 4mm; display: flex; gap: 4mm; align-items: center; height: 32mm; break-inside: avoid }
    .qr { width: 26mm; height: 26mm; flex: none } .qr svg { width: 100%; height: 100% }
    .num { font-size: 18pt; font-weight: 700; letter-spacing: .02em } .type { font-size: 10pt; color: #333 } .co { font-size: 8pt; color: #666; margin-top: 2mm }
  </style></head><body><div class="sheet">${labels.join('')}</div></body></html>`)
  w.document.close()
  // Printed from here: the new window inherits the app's CSP, which forbids an inline script.
  w.focus()
  window.setTimeout(() => w.print(), 300)
}
