'use client';

/**
 * Hero river illustration — a flowing Bézier path with travelling particles,
 * tuned for a LIGHT background (more saturation than a dark canvas).
 */
export function FlowRiver({ accent = 'brand' }: { accent?: 'brand' | 'water' }) {
  const main = accent === 'water' ? 'oklch(0.5 0.12 175)' : 'oklch(0.5 0.16 258)';
  const gid = `riv-${accent}`;
  const path = 'M -40 120 C 180 50, 340 200, 560 110 S 880 40, 1080 150 S 1320 110, 1440 130';
  const ys = [110, 140, 95, 150, 120];

  return (
    <svg viewBox="0 0 1400 240" className="flow-river" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={main} stopOpacity="0" />
          <stop offset="18%" stopColor={main} stopOpacity="0.85" />
          <stop offset="50%" stopColor="oklch(0.55 0.13 175)" stopOpacity="0.95" />
          <stop offset="82%" stopColor={main} stopOpacity="0.85" />
          <stop offset="100%" stopColor={main} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* wide soft band */}
      <path d={path} fill="none" stroke={main} strokeOpacity="0.14" strokeWidth="46" strokeLinecap="round" />
      {/* outer faint line */}
      <path d={path} fill="none" stroke={main} strokeOpacity="0.4" strokeWidth="1.5" />
      {/* flowing current */}
      <path d={path} fill="none" stroke={`url(#${gid})`} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 12">
        <animate attributeName="stroke-dashoffset" from="0" to="-140" dur="2.6s" repeatCount="indefinite" />
      </path>

      {/* station marks */}
      {[120, 420, 720, 1020, 1320].map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={ys[i]} r="5" fill={main} fillOpacity="0.9" />
          <circle cx={x} cy={ys[i]} r="10" fill="none" stroke={main} strokeOpacity="0.3" strokeWidth="1" />
        </g>
      ))}

      {/* travelling particles */}
      <circle r="5" fill="oklch(0.5 0.16 258)">
        <animateMotion dur="6.5s" repeatCount="indefinite" path={path} />
      </circle>
      <circle r="3.5" fill="oklch(0.55 0.13 175)">
        <animateMotion dur="6.5s" begin="2.1s" repeatCount="indefinite" path={path} />
      </circle>
      <circle r="2.5" fill="oklch(0.4 0.04 258)">
        <animateMotion dur="6.5s" begin="4.3s" repeatCount="indefinite" path={path} />
      </circle>
    </svg>
  );
}
