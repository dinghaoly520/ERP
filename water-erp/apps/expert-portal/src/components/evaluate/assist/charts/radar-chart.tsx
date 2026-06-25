'use client';

// ── 多维雷达图（支持 5 维 per-item 分类 + 多供应商叠加）──

export interface RadarAxis {
  key: string;
  label: string;
  max: number;
}

interface BidderRadarData {
  name: string;
  scores: Record<string, number>; // key → score
}

interface RadarChartProps {
  axes: RadarAxis[];
  bidders: BidderRadarData[];
  size?: number;
}

const RADAR_COLORS = [
  '#0b63ce', // primary blue
  '#11a874', // green
  '#f5a623', // amber
  '#8b5cf6', // purple
  '#e74c3c', // red
];

export function RadarChart({ axes, bidders, size = 380 }: RadarChartProps) {
  if (axes.length === 0 || bidders.length === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = Math.min(size / 2 - 50, 150); // 留足标签空间
  const angles = axes.map((_, i) => (i * 2 * Math.PI) / axes.length - Math.PI / 2);

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
      >
        {/* 同心网格（5 层） */}
        {[0.2, 0.4, 0.6, 0.8, 1].map((scale) => (
          <polygon
            key={scale}
            points={angles
              .map((a) => `${cx + r * scale * Math.cos(a)},${cy + r * scale * Math.sin(a)}`)
              .join(' ')}
            fill="none"
            stroke="oklch(0.91 0.006 264)"
            strokeWidth={1}
          />
        ))}

        {/* 轴线 + 标签 */}
        {axes.map((axis, i) => {
          const x = cx + r * Math.cos(angles[i]);
          const y = cy + r * Math.sin(angles[i]);
          return (
            <g key={axis.key}>
              <line
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke="oklch(0.91 0.006 264)"
                strokeWidth={1}
              />
              <text
                x={cx + (r + 28) * Math.cos(angles[i])}
                y={cy + (r + 28) * Math.sin(angles[i]) + 5}
                textAnchor="middle"
                className="text-xs font-medium"
                fill="oklch(0.45 0.01 264)"
              >
                {axis.label}
              </text>
              <text
                x={cx + (r + 28) * Math.cos(angles[i])}
                y={cy + (r + 28) * Math.sin(angles[i]) + 20}
                textAnchor="middle"
                className="text-[10px]"
                fill="oklch(0.62 0.008 264)"
              >
                (满分{axis.max})
              </text>
            </g>
          );
        })}

        {/* 数据多边形 */}
        {bidders.map((bidder, bi) => {
          const color = RADAR_COLORS[bi % RADAR_COLORS.length];
          const points = axes
            .map((axis, i) => {
              const val = bidder.scores[axis.key] ?? 0;
              const ratio = Math.min(val / axis.max, 1);
              return `${cx + r * ratio * Math.cos(angles[i])},${cy + r * ratio * Math.sin(angles[i])}`;
            })
            .join(' ');

          return (
            <polygon
              key={bi}
              points={points}
              fill={color}
              fillOpacity={0.15}
              stroke={color}
              strokeWidth={2}
            />
          );
        })}

        {/* 数据点 */}
        {bidders.map((bidder, bi) =>
          axes.map((axis, i) => {
            const val = bidder.scores[axis.key] ?? 0;
            const ratio = Math.min(val / axis.max, 1);
            return (
              <circle
                key={`${bi}-${i}`}
                cx={cx + r * ratio * Math.cos(angles[i])}
                cy={cy + r * ratio * Math.sin(angles[i])}
                r={4}
                fill={RADAR_COLORS[bi % RADAR_COLORS.length]}
              />
            );
          }),
        )}
      </svg>

      {/* 图例 */}
      {bidders.length > 1 && (
        <div className="flex flex-col gap-2 text-sm">
          {bidders.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className="w-3.5 h-3.5 rounded-full shrink-0"
                style={{ background: RADAR_COLORS[i % RADAR_COLORS.length] }}
              />
              <span className="text-[var(--color-text-secondary)] truncate max-w-[140px]">
                {b.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
