'use client'

export function MiniMap({ lat, lng, zoom: _zoom = 14, className = '' }: {
  lat: number
  lng: number
  zoom?: number
  className?: string
}) {
  if (!lat || !lng || (lat === 0 && lng === 0)) return null

  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01},${lat - 0.005},${lng + 0.01},${lat + 0.005}&layer=mapnik&marker=${lat},${lng}`

  return (
    <div className={`rounded-lg overflow-hidden border border-surface-200 ${className}`}>
      <iframe
        src={src}
        width="100%"
        height="120"
        style={{ border: 0 }}
        title={`Carte ${lat.toFixed(4)}, ${lng.toFixed(4)}`}
        loading="lazy"
      />
      <div className="flex items-center justify-between px-2 py-1 bg-surface-50 text-[10px] text-surface-400">
        <span className="font-mono">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
        <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noopener noreferrer"
          className="text-brand-500 hover:underline">
          Google Maps
        </a>
      </div>
    </div>
  )
}
