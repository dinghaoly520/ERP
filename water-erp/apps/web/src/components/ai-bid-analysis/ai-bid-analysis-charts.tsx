'use client';

import type { AiBidder } from '@/lib/types/ai-bid-analysis';

// ── 评分柱状图 ──

interface BarChartProps {
  data: Array<{ name: string; technical: number; commercial: number; price: number; total: number }>;
}

export function ScoreBarChart({ data }: BarChartProps) {
  if (data.length === 0) return null;

  const maxVal = 100;
  const barWidth = 48;
  const groupGap = 80;
  const chartHeight = 360;
  const padLeft = 60;
  const padBottom = 70;
  const padTop = 40;
  const plotH = chartHeight - padBottom - padTop;

  const groupWidth = barWidth * 3 + 20;
  const totalWidth = data.length * groupWidth + (data.length - 1) * groupGap;
  const chartWidth = Math.max(600, totalWidth + padLeft + 60);

  return (
    <div className="overflow-x-auto w-full">
      <svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="min-w-[500px]">
        {/* Y轴刻度 */}
        {[0, 20, 40, 60, 80, 100].map(v => {
          const y = padTop + plotH - (v / maxVal) * plotH;
          return (
            <g key={v}>
              <line x1={padLeft} y1={y} x2={padLeft + totalWidth} y2={y} stroke="var(--border)" strokeDasharray={v === 0 ? 'none' : '4,4'} />
              <text x={padLeft - 12} y={y + 5} textAnchor="end" className="text-sm fill-current opacity-50">{v}</text>
            </g>
          );
        })}

        {/* 柱状图 */}
        {data.map((d, i) => {
          const gx = padLeft + i * (groupWidth + groupGap);
          const hT = (d.technical / maxVal) * plotH;
          const hC = (d.commercial / maxVal) * plotH;
          const hP = (d.price / maxVal) * plotH;

          return (
            <g key={i}>
              <rect x={gx} y={padTop + plotH - hT} width={barWidth} height={hT} rx={5} fill="#3b82f6" opacity={0.85} />
              <text x={gx + barWidth / 2} y={padTop + plotH - hT - 8} textAnchor="middle" className="text-sm fill-blue-600 font-semibold">{d.technical.toFixed(1)}</text>

              <rect x={gx + barWidth + 8} y={padTop + plotH - hC} width={barWidth} height={hC} rx={5} fill="#8b5cf6" opacity={0.85} />
              <text x={gx + barWidth + 8 + barWidth / 2} y={padTop + plotH - hC - 8} textAnchor="middle" className="text-sm fill-purple-600 font-semibold">{d.commercial.toFixed(1)}</text>

              <rect x={gx + (barWidth + 8) * 2} y={padTop + plotH - hP} width={barWidth} height={hP} rx={5} fill="#10b981" opacity={0.85} />
              <text x={gx + (barWidth + 8) * 2 + barWidth / 2} y={padTop + plotH - hP - 8} textAnchor="middle" className="text-sm fill-emerald-600 font-semibold">{d.price.toFixed(1)}</text>

              <text x={gx + groupWidth / 2} y={chartHeight - 25} textAnchor="middle" className="text-base fill-current opacity-70 font-medium">
                {d.name.length > 10 ? d.name.slice(0, 10) + '…' : d.name}
              </text>
            </g>
          );
        })}

        {/* 图例 */}
        <rect x={padLeft} y={8} width={14} height={14} rx={4} fill="#3b82f6" />
        <text x={padLeft + 20} y={20} className="text-sm fill-current opacity-60">技术分</text>
        <rect x={padLeft + 70} y={8} width={14} height={14} rx={4} fill="#8b5cf6" />
        <text x={padLeft + 88} y={20} className="text-sm fill-current opacity-60">商务分</text>
        <rect x={padLeft + 140} y={8} width={14} height={14} rx={4} fill="#10b981" />
        <text x={padLeft + 158} y={20} className="text-sm fill-current opacity-60">报价分</text>
      </svg>
    </div>
  );
}

// ── 维度雷达图 ──

interface RadarChartProps {
  bidders: Array<{
    name: string;
    scores: { technical: number; commercial: number; price: number };
  }>;
}

export function DimensionRadarChart({ bidders }: RadarChartProps) {
  if (bidders.length === 0) return null;

  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const r = 150;
  const axes = [
    { label: '技术方案', key: 'technical' as const, max: 50 },
    { label: '商务能力', key: 'commercial' as const, max: 30 },
    { label: '报价评分', key: 'price' as const, max: 20 },
  ];
  const angles = axes.map((_, i) => (i * 2 * Math.PI) / axes.length - Math.PI / 2);
  const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="flex items-center justify-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* 网格 */}
        {[0.25, 0.5, 0.75, 1].map(scale => (
          <polygon
            key={scale}
            points={angles.map(a => `${cx + r * scale * Math.cos(a)},${cy + r * scale * Math.sin(a)}`).join(' ')}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}

        {/* 轴线 + 标签 */}
        {axes.map((axis, i) => (
          <g key={i}>
            <line x1={cx} y1={cy} x2={cx + r * Math.cos(angles[i])} y2={cy + r * Math.sin(angles[i])} stroke="var(--border)" strokeWidth={1} />
            <text
              x={cx + (r + 30) * Math.cos(angles[i])}
              y={cy + (r + 30) * Math.sin(angles[i]) + 6}
              textAnchor="middle"
              className="text-base fill-current opacity-70 font-medium"
            >
              {axis.label}
            </text>
            <text
              x={cx + (r + 30) * Math.cos(angles[i])}
              y={cy + (r + 30) * Math.sin(angles[i]) + 24}
              textAnchor="middle"
              className="text-sm fill-current opacity-50"
            >
              (满分{axis.max})
            </text>
          </g>
        ))}

        {/* 数据多边形 */}
        {bidders.map((bidder, bi) => {
          const points = axes.map((axis, i) => {
            const val = bidder.scores[axis.key] || 0;
            const ratio = Math.min(val / axis.max, 1);
            return `${cx + r * ratio * Math.cos(angles[i])},${cy + r * ratio * Math.sin(angles[i])}`;
          }).join(' ');

          return (
            <g key={bi}>
              <polygon points={points} fill={colors[bi % colors.length]} fillOpacity={0.2} stroke={colors[bi % colors.length]} strokeWidth={2.5} />
            </g>
          );
        })}

        {/* 数据点 */}
        {bidders.map((bidder, bi) =>
          axes.map((axis, i) => {
            const val = bidder.scores[axis.key] || 0;
            const ratio = Math.min(val / axis.max, 1);
            return (
              <circle
                key={`${bi}-${i}`}
                cx={cx + r * ratio * Math.cos(angles[i])}
                cy={cy + r * ratio * Math.sin(angles[i])}
                r={6}
                fill={colors[bi % colors.length]}
              />
            );
          })
        )}
      </svg>
      {/* 图例 */}
      <div className="flex flex-col gap-3">
        {bidders.map((b, i) => (
          <div key={i} className="flex items-center gap-3 text-base">
            <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: colors[i % colors.length] }} />
            <span className="truncate max-w-[120px] opacity-70">{b.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 报价对比横向柱状图 ──

interface PriceChartProps {
  data: Array<{ name: string; price: number }>;
  maxPrice?: number;
}

export function PriceComparisonChart({ data, maxPrice }: PriceChartProps) {
  if (data.length === 0) return null;

  // 标尺只基于投标报价的最大值，柱状条按此比例绘制
  const dataMax = Math.max(...data.map(d => d.price));
  const barScale = dataMax * 1.15;

  // 判断 maxPrice 是否与投标报价在同一数量级（允许 3 倍差异）
  // 如果差异过大，说明单位不一致，不绘制限价线
  const limitPrice =
    maxPrice != null && maxPrice > 0 && maxPrice <= dataMax * 3 ? maxPrice : null;

  return (
    <div className="space-y-2">
      {/* 限价标注：单位一致时带红色虚线图例，不一致时仅文字 */}
      {maxPrice != null && (
        <div className="flex items-center gap-2 text-xs text-red-500">
          {limitPrice != null && (
            <span className="inline-block w-4 border-t-2 border-dashed border-red-400" />
          )}
          最高限价：{maxPrice}万
        </div>
      )}

      {data.map((d, i) => {
        const barPct = (d.price / barScale) * 100;
        const isOver = limitPrice != null && d.price > limitPrice;
        const barColor = isOver ? '#fca5a5' : '#60a5fa';
        const barBg = isOver ? '#fef2f2' : '#eff6ff';
        const limitPct = limitPrice != null ? (limitPrice / barScale) * 100 : null;

        return (
          <div key={i} className="flex items-center gap-2">
            <span
              className="w-24 shrink-0 truncate text-right text-xs opacity-70"
              title={d.name}
            >
              {d.name.length > 8 ? d.name.slice(0, 8) + '…' : d.name}
            </span>
            <div className="flex-1 min-w-0">
              <div className="relative h-6 rounded-md" style={{ background: barBg }}>
                {/* 柱状条 */}
                <div
                  className="absolute inset-y-0 left-0 rounded-md"
                  style={{
                    width: `${barPct}%`,
                    background: barColor,
                    opacity: 0.85,
                  }}
                />
                {/* 限价虚线 */}
                {limitPct != null && limitPct <= 100 && (
                  <div
                    className="absolute top-0 bottom-0 w-0 border-l-2 border-dashed border-red-400"
                    style={{ left: `${limitPct}%` }}
                  />
                )}
              </div>
            </div>
            <span className="shrink-0 text-xs tabular-nums opacity-70">
              {d.price.toFixed(2)}万
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── 风险等级环形图 ──

interface RiskDonutProps {
  high: number;
  medium: number;
  low: number;
}

export function RiskDonutChart({ high, medium, low }: RiskDonutProps) {
  const total = high + medium + low;
  if (total === 0) return null;

  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 50;
  const innerR = 30;

  const segments = [
    { count: high, color: '#ef4444', label: '高' },
    { count: medium, color: '#f59e0b', label: '中' },
    { count: low, color: '#22c55e', label: '低' },
  ];

  let startAngle = -Math.PI / 2;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size}>
        {segments.map((seg, i) => {
          if (seg.count === 0) return null;
          const angle = (seg.count / total) * 2 * Math.PI;
          const endAngle = startAngle + angle;
          const largeArc = angle > Math.PI ? 1 : 0;

          const x1 = cx + outerR * Math.cos(startAngle);
          const y1 = cy + outerR * Math.sin(startAngle);
          const x2 = cx + outerR * Math.cos(endAngle);
          const y2 = cy + outerR * Math.sin(endAngle);
          const x3 = cx + innerR * Math.cos(endAngle);
          const y3 = cy + innerR * Math.sin(endAngle);
          const x4 = cx + innerR * Math.cos(startAngle);
          const y4 = cy + innerR * Math.sin(startAngle);

          const d = `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;

          startAngle = endAngle;

          return <path key={i} d={d} fill={seg.color} opacity={0.85} />;
        })}
        <text x={cx} y={cy + 5} textAnchor="middle" className="text-lg font-bold fill-current">{total}</text>
        <text x={cx} y={cy - 8} textAnchor="middle" className="text-[10px] fill-current opacity-50">总计</text>
      </svg>
      <div className="flex flex-col gap-2 text-xs">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ background: seg.color }} />
            <span className="opacity-70">{seg.label}风险</span>
            <span className="font-medium">{seg.count} 家</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 评分分项进度条 ──

interface ScoreBreakdownProps {
  items: Array<{ label: string; score: number; maxScore: number; comment?: string }>;
  color?: string;
}

export function ScoreBreakdownBars({ items, color = '#3b82f6' }: ScoreBreakdownProps) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-xs mb-0.5">
            <span className="opacity-70">{item.label}</span>
            <span className="font-medium">{item.score.toFixed(1)}/{item.maxScore}</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--muted)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${item.maxScore > 0 ? (item.score / item.maxScore) * 100 : 0}%`,
                background: color,
              }}
            />
          </div>
          {item.comment && <p className="text-[10px] opacity-50 mt-0.5 ml-1">{item.comment}</p>}
        </div>
      ))}
    </div>
  );
}
