/**
 * Hero illustration: one skip-bin round as the optimiser plans it — depot, sites, the dump
 * (exutoire) visit between a pickup and the next drop, back to depot. The route is drawn once on
 * load (CSS only, disabled under prefers-reduced-motion); stops are illustrative.
 */
const STOPS = [
  { x: 70,  y: 300, kind: 'depot',    label: 'Dépôt',    time: '7:00' },
  { x: 150, y: 170, kind: 'bin',      label: 'Pose',     time: '7:25' },
  { x: 285, y: 95,  kind: 'bin',      label: 'Retrait',  time: '8:10' },
  { x: 430, y: 150, kind: 'dump',     label: 'Exutoire', time: '8:40' },
  { x: 395, y: 290, kind: 'bin',      label: 'Échange',  time: '9:35' },
  { x: 240, y: 330, kind: 'bin',      label: 'Pose',     time: '10:20' },
] as const

const PATH = 'M70 300 C 95 240, 115 200, 150 170 S 240 90, 285 95 S 400 110, 430 150 S 440 250, 395 290 S 300 345, 240 330 S 110 330, 70 300'

export function RouteSketch() {
  return (
    <figure className="relative mx-auto w-full max-w-[520px]">
      <svg viewBox="0 0 500 400" role="img" aria-labelledby="route-sketch-title" className="h-auto w-full">
        <title id="route-sketch-title">Exemple de tournée : dépôt, pose et retrait de bennes, vidage à l’exutoire, retour au dépôt</title>
        <defs>
          <pattern id="route-grid" width="25" height="25" patternUnits="userSpaceOnUse">
            <path d="M25 0H0V25" fill="none" stroke="#D9E0E6" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="500" height="400" rx="20" fill="#FFFFFF" />
        <rect x="0" y="0" width="500" height="400" rx="20" fill="url(#route-grid)" opacity="0.7" />

        <path d={PATH} fill="none" stroke="#0055A4" strokeOpacity="0.12" strokeWidth="10" strokeLinecap="round" />
        <path d={PATH} fill="none" stroke="#0055A4" strokeWidth="3" strokeLinecap="round" className="route-draw" pathLength={1} />

        {STOPS.map((s, i) => (
          <g key={i} transform={`translate(${s.x} ${s.y})`}>
            {s.kind === 'depot' && <rect x="-11" y="-11" width="22" height="22" rx="4" fill="#13212F" />}
            {s.kind === 'dump' && (
              <g>
                <circle r="15" fill="#13212F" />
                <path d="M-6 4 L-6 -3 L-2 -6 L-2 -1 L2 -4 L2 -1 L6 -4 L6 4 Z" fill="#FFFFFF" />
              </g>
            )}
            {s.kind === 'bin' && (
              <g>
                <circle r="13" fill="#FFFFFF" stroke="#13212F" strokeWidth="2" />
                <path d="M-7 -3 L7 -3 L5 5 L-5 5 Z" fill="#E9A400" />
              </g>
            )}
            <text x={s.x > 400 ? -20 : 20} y="-6" textAnchor={s.x > 400 ? 'end' : 'start'} className="fill-[#13212F] font-display" fontSize="14" fontWeight="600" stroke="#FFFFFF" strokeWidth="5" strokeLinejoin="round" paintOrder="stroke">{s.label}</text>
            <text x={s.x > 400 ? -20 : 20} y="11" textAnchor={s.x > 400 ? 'end' : 'start'} className="fill-[#13212F]/55" fontSize="12" stroke="#FFFFFF" strokeWidth="5" strokeLinejoin="round" paintOrder="stroke">{s.time}</text>
          </g>
        ))}
      </svg>
      <style>{`
        .route-draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: route-draw 2.4s cubic-bezier(.45,.05,.25,1) .3s forwards; }
        @keyframes route-draw { to { stroke-dashoffset: 0; } }
        @media (prefers-reduced-motion: reduce) { .route-draw { animation: none; stroke-dashoffset: 0; } }
      `}</style>
    </figure>
  )
}
