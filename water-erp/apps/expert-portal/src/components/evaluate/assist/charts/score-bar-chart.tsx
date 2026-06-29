'use client';

// ── 分组柱状图 — 按维度分组，每组内多家供应商对比 ──
// X 轴 = 维度（商务/技术/价格），每组内 = 各供应商柱子并排

import { CATEGORY_LABEL, CATEGORY_COLOR } from './score-breakdown-bars';

export interface ScoreBarChartData {
  name: string;
  categoryScores: Record<string, number>; // category → score
  totalScore: number;
}

interface ScoreBarChartProps {
  data: ScoreBarChartData[];
  categoryMaxes: Record<string, number>;
}

const SCORE_CATEGORIES = ['BUSINESS', 'TECHNICAL', 'PRICE'];

// 供应商配色（与雷达图一致）
const SUPPLIER_COLORS = [
  'oklch(0.48 0.18 264)',
  'oklch(0.52 0.14 180)',
  'oklch(0.55 0.16 60)',
  'oklch(0.50 0.16 20)',
  'oklch(0.50 0.14 310)',
];

export function ScoreBarChart({ data, categoryMaxes }: ScoreBarChartProps) {
  const activeCategories = SCORE_CATEGORIES.filter(
    (cat) => categoryMaxes[cat] != null && categoryMaxes[cat] > 0,
  );
  if (activeCategories.length === 0 || data.length === 0) return null;

  const barWidth = 28;
  const barGap = 4;
  const supplierGroupW = barWidth + barGap;
  const groupInnerW = data.length * supplierGroupW - barGap;
  const groupGap = 48;
  const padLeft = 62;
  const padBottom = 72;
  const padTop = 32;
  const plotH = 240;
  const chartH = plotH + padBottom + padTop;
  const totalWidth = Math.max(
    480,
    padLeft + activeCategories.length * groupInnerW + (activeCategories.length - 1) * groupGap + 40,
  );

  const yTicks = [0, 20, 40, 60, 80, 100];

  // 供应商名截断
  const shortName = (name: string) => name.length > 5 ? name.slice(0, 5) + '…' : name;

  return (
    <div className="overflow-x-auto">
      <svg
        width={totalWidth}
        height={chartH}
        viewBox={`0 0 ${totalWidth} ${chartH}`}
        className="shrink-0"
      >
        {/* Y 轴网格线 + 标签 */}
        {yTicks.map((tick) => {
          const y = padTop + plotH - (tick / 100) * plotH;
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                y1={y}
                x2={totalWidth - 20}
                y2={y}
                stroke="oklch(0.91 0.006 264)"
                strokeWidth={1}
                strokeDasharray={tick === 0 ? undefined : '4 2'}
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="text-[11px]"
                fill="oklch(0.55 0.008 264)"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* 按维度分组：每组内供应商并排 */}
        {activeCategories.map((cat, ci) => {
          const catColor = CATEGORY_COLOR[cat] ?? '#0b63ce';
          const maxScore = categoryMaxes[cat] ?? 0;
          const groupX = padLeft + ci * (groupInnerW + groupGap);

          return (
            <g key={cat}>
              {/* 供应商柱子 */}
              {data.map((d, di) => {
                const score = d.categoryScores[cat] ?? 0;
                const h = maxScore > 0 ? (score / maxScore) * plotH : 0;
                const barX = groupX + di * supplierGroupW;
                const barY = padTop + plotH - h;
                const color = SUPPLIER_COLORS[di % SUPPLIER_COLORS.length];

                return (
                  <g key={di}>
                    <rect
                      x={barX}
                      y={barY}
                      width={barWidth}
                      height={Math.max(h, 1)}
                      fill={color}
                      rx={2}
                    />
                    <text
                      x={barX + barWidth / 2}
                      y={barY - 6}
                      textAnchor="middle"
                      className="text-[10px] font-semibold tabular-nums"
                      fill="oklch(0.35 0.01 264)"
                    >
                      {score.toFixed(1)}
                    </text>
                  </g>
                );
              })}

              {/* 维度名 */}
              <text
                x={groupX + groupInnerW / 2}
                y={padTop + plotH + 16}
                textAnchor="middle"
                className="text-[11px] font-bold"
                fill="oklch(0.35 0.01 264)"
              >
                {CATEGORY_LABEL[cat] ?? cat}
              </text>
              {/* 满分 */}
              <text
                x={groupX + groupInnerW / 2}
                y={padTop + plotH + 30}
                textAnchor="middle"
                className="text-[10px]"
                fill="oklch(0.55 0.008 264)"
              >
                满分 {maxScore}
              </text>

              {/* 维度分隔线（除最后一组）*/}
              {ci < activeCategories.length - 1 && (
                <line
                  x1={groupX + groupInnerW + groupGap / 2}
                  y1={padTop}
                  x2={groupX + groupInnerW + groupGap / 2}
                  y2={padTop + plotH}
                  stroke="oklch(0.93 0.004 264)"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
              )}
            </g>
          );
        })}

        {/* 图例：供应商名 × 色块 */}
        <g transform={`translate(${padLeft}, ${chartH - 6})`}>
          {data.map((d, di) => (
            <g key={di} transform={`translate(${di * 130}, 0)`}>
              <rect
                x={0}
                y={0}
                width={10}
                height={10}
                rx={2}
                fill={SUPPLIER_COLORS[di % SUPPLIER_COLORS.length]}
              />
              <text x={14} y={9} className="text-[10px] font-medium" fill="oklch(0.40 0.01 264)">
                {shortName(d.name)}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
