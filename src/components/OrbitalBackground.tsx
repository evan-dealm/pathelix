'use client'

export function OrbitalBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden text-surface-900 dark:text-surface-400"
      aria-hidden
    >
      <svg
        width="680" height="680"
        viewBox="-340 -340 680 680"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <path id="bg-orb1" d="M 260,0 A 260,90 0 0,1 -260,0 A 260,90 0 0,1 260,0" />
          <path id="bg-orb2" d="M 137.8,220.5 A 260,90 58 0,1 -137.8,-220.5 A 260,90 58 0,1 137.8,220.5" />

          <filter id="bg-ring-glow" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="bg-center-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="bg-pt-glow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {}
        <path d="M 260,0 A 260,90 0 0,1 -260,0 A 260,90 0 0,1 260,0"
          stroke="currentColor" strokeWidth="10" strokeOpacity="0.03" />
        <path d="M 254,0 A 254,88 0 0,1 -254,0 A 254,88 0 0,1 254,0"
          stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.15"
          filter="url(#bg-ring-glow)" />
        <path d="M 266,0 A 266,92 0 0,1 -266,0 A 266,92 0 0,1 266,0"
          stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.15"
          filter="url(#bg-ring-glow)" />

        {}
        <path d="M 137.8,220.5 A 260,90 58 0,1 -137.8,-220.5 A 260,90 58 0,1 137.8,220.5"
          stroke="currentColor" strokeWidth="10" strokeOpacity="0.03" />
        <path d="M 134.6,215.5 A 254,88 58 0,1 -134.6,-215.5 A 254,88 58 0,1 134.6,215.5"
          stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.15"
          filter="url(#bg-ring-glow)" />
        <path d="M 141.0,225.6 A 266,92 58 0,1 -141.0,-225.6 A 266,92 58 0,1 141.0,225.6"
          stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.15"
          filter="url(#bg-ring-glow)" />

        {}
        <circle r="90" fill="currentColor" fillOpacity="0.02" />
        <circle r="45" fill="currentColor" fillOpacity="0.04" filter="url(#bg-center-glow)" />
        <circle r="22" fill="currentColor" fillOpacity="0.40" />

        {}
        <circle r="4.5" fill="currentColor" fillOpacity="0.40" filter="url(#bg-pt-glow)">
          <animateMotion dur="22s" repeatCount="indefinite" begin="0s">
            <mpath href="#bg-orb1" />
          </animateMotion>
        </circle>

        {}
        <circle r="4" fill="currentColor" fillOpacity="0.40" filter="url(#bg-pt-glow)">
          <animateMotion dur="30s" repeatCount="indefinite" begin="-11s">
            <mpath href="#bg-orb2" />
          </animateMotion>
        </circle>
      </svg>
    </div>
  )
}
