/**
 * MapLibre popups/tooltips are built from raw HTML strings (`Popup.setHTML()`), unlike the
 * Leaflet `<Tooltip>`/`<Popup>` JSX this replaces, which auto-escaped its children through
 * React. Any DB-derived text (client name, address, driver name...) interpolated into that
 * HTML MUST go through this first — never interpolate untrusted/user-editable strings
 * directly, or a mission/client name containing markup becomes a stored XSS.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
