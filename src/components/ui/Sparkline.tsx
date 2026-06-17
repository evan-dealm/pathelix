'use client'

export function Sparkline({ data, width = 60, height = 20, color = '#0055A4', className = '' }: {
  data: number[]
  width?: number
  height?: number
  color?: string
  className?: string
}) {
  if (data.length < 2) return null

  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const padding = 2

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = height - padding - ((v - min) / range) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')

  const firstX = padding
  const lastX = padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2)
  const areaPoints = `${firstX},${height - padding} ${points} ${lastX},${height - padding}`

  return (
    <svg width={width} height={height} className={className} viewBox={`0 0 ${width} ${height}`}>
      <polygon points={areaPoints} fill={color} opacity="0.1" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {}
      {(() => {
        const lastVal = data[data.length - 1]
        const x = lastX
        const y = height - padding - ((lastVal - min) / range) * (height - padding * 2)
        return <circle cx={x} cy={y} r="2" fill={color} />
      })()}
    </svg>
  )
}
