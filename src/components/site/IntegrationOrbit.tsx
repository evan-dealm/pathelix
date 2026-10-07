import { ORBIT_A, ORBIT_B, ORBIT_VIEWBOX } from './Orbit'

/**
 * The orbit as a diagram: Pathélix at the centre, the systems it exchanges with on the two
 * orbits — the same picture as in the film. Positions are points of the ellipses, expressed in
 * percent of the viewBox so the labels are real text.
 */
const NODES: Array<{
  label: string
  x: number
  y: number
  cx: number
  cy: number
  side: 'left' | 'right'
}> = [
  { label: 'API REST', cx: -113, cy: -225, x: 30.5, y: 5, side: 'right' },
  { label: 'ERP', cx: 236, cy: -38, x: 90.7, y: 42.4, side: 'left' },
  { label: 'Facturation', cx: -251, cy: 23, x: 6.7, y: 54.6, side: 'right' },
  { label: 'Télématique', cx: 122, cy: 225, x: 71, y: 95, side: 'left' },
]

export function IntegrationOrbit() {
  return (
    <div
      className="relative mx-auto w-full max-w-[34rem]"
      role="img"
      aria-label="Pathélix au centre, relié à l’API REST, à l’ERP, à la facturation et à la télématique."
    >
      <svg
        viewBox={ORBIT_VIEWBOX}
        fill="none"
        aria-hidden="true"
        className="block h-auto w-full text-ink"
      >
        <path
          d={ORBIT_A}
          stroke="currentColor"
          strokeOpacity="0.28"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={ORBIT_B}
          stroke="currentColor"
          strokeOpacity="0.28"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <circle r="5" fill="currentColor" />
        {NODES.map(n => (
          <circle key={n.label} cx={n.cx} cy={n.cy} r="4" fill="currentColor" />
        ))}
      </svg>
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 translate-x-3 -translate-y-1/2 text-[0.8125rem] font-semibold tracking-[-0.01em]"
      >
        Pathélix
      </span>
      {NODES.map(n => (
        <span
          key={n.label}
          aria-hidden="true"
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
          className={`absolute -translate-y-1/2 whitespace-nowrap text-[0.875rem] font-medium tracking-[-0.01em] ${
            n.side === 'right' ? 'translate-x-3' : '-translate-x-[calc(100%+0.75rem)]'
          }`}
        >
          {n.label}
        </span>
      ))}
    </div>
  )
}
