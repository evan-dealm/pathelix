/**
 * The Pathélix signature: two crossed orbits, as in the logo. Used sparingly — behind the hero
 * product shot, in the integration diagram, on the 404 page, in the footer. Decorative.
 */

export const ORBIT_A = 'M 260,0 A 260,90 0 0,1 -260,0 A 260,90 0 0,1 260,0'
export const ORBIT_B = 'M 137.8,220.5 A 260,90 58 0,1 -137.8,-220.5 A 260,90 58 0,1 137.8,220.5'
export const ORBIT_VIEWBOX = '-290 -250 580 500'

interface OrbitProps {
  className?: string
  /** Draws both orbits once on load. */
  animated?: boolean
}

export function Orbit({ className, animated = false }: OrbitProps) {
  return (
    <svg
      viewBox={ORBIT_VIEWBOX}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d={ORBIT_A}
        pathLength={1}
        stroke="currentColor"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className={animated ? 'orbit-draw' : undefined}
      />
      <path
        d={ORBIT_B}
        pathLength={1}
        stroke="currentColor"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className={animated ? 'orbit-draw orbit-draw-late' : undefined}
      />
    </svg>
  )
}
