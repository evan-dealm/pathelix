/**
 * Compresses a dataUrl image via canvas (browser-only).
 * Falls back to original if canvas unavailable (SSR / non-browser).
 * @param dataUrl - source image as data URL (any format)
 * @param maxWidth - max pixel width (aspect ratio preserved)
 * @param quality - JPEG quality 0–1
 */
export async function compressImage(dataUrl: string, maxWidth: number, quality: number): Promise<string> {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve(dataUrl)
      return
    }
    const img = new window.Image()
    img.onload = () => {
      const ratio = Math.min(1, maxWidth / img.width)
      const w = Math.round(img.width  * ratio)
      const h = Math.round(img.height * ratio)
      let canvas: HTMLCanvasElement
      try {
        canvas = document.createElement('canvas')
      } catch {
        resolve(dataUrl)
        return
      }
      canvas.width  = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(dataUrl); return }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}
