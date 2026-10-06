import type * as maplibregl from 'maplibre-gl'

/**
 * OpenFreeMap's font glyph server has no pictographic/emoji coverage — a `text-field` with
 * a literal emoji silently 404s per Unicode range and renders as a blank glyph (see
 * ARCHITECTURE.md §9). This draws the emoji to an offscreen canvas
 * using the browser's own emoji font and registers it as a raster `icon-image` instead, which
 * bypasses the glyph pipeline entirely.
 *
 * Idempotent: `map.hasImage()` is the source of truth (not a local cache), so this is safe to
 * call on every render and correctly re-registers after a real style reload.
 */
export function ensureEmojiImage(map: maplibregl.Map, emoji: string): void {
  if (map.hasImage(emoji)) return

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const size = 24
  const px = Math.round(size * dpr)

  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.font = `${Math.round(px * 0.82)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, px / 2, px / 2 + px * 0.04)

  const imageData = ctx.getImageData(0, 0, px, px)
  if (map.hasImage(emoji)) return // registered concurrently while we were drawing
  map.addImage(emoji, imageData, { pixelRatio: dpr })
}

/**
 * Safety net for any icon-image referenced before `ensureEmojiImage` ran for it. This app's
 * only `icon-image` usage is mission-type emoji, so any missing id here is one of ours.
 */
export function installEmojiImageFallback(map: maplibregl.Map): void {
  map.on('styleimagemissing', (e: { id: string }) => ensureEmojiImage(map, e.id))
}
