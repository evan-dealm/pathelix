/**
 * Escapes a value for interpolation into an HTML string (text content or a quoted attribute).
 * Required for every user/tenant-controlled value written with document.write / innerHTML —
 * mission notes, client names and addresses come from imports, webhooks and other users.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
