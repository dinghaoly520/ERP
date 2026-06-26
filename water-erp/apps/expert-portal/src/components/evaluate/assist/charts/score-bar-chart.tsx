'use client';

// ── 分组柱状图 — 多供应商维度对比（仅显示评分维度：BUSINESS/TECHNICAL/PRICE）──

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

// 可显示柱状图的评分维度（排除 pass/fail 类型）
const SCORE_CATEGORIES = ['BUSINESS', 'TECHNICAL', 'PRICE'];

export function ScoreBarChart({ data, categoryMaxes }: ScoreBarChartProps) {
  const activeCategories = SCORE_CATEGORIES.filter(
    (cat) => categoryMaxes[cat] != null && categoryMaxes[cat] > 0,
  );
  if (activeCategories.length === 0 || data.length === 0) return null;

  const yMax = 100;
  const barWidth = 36;
  const gap = 8;
  const groupWidth = barWidth * activeCategories.length + gap * (activeCategories.length - 1);
  const groupGap = 64;
  const padLeft = 56;
  const padBottom = 64;
  const padTop = 36;
  const plotH = 260;
  const chartH = plotH + padBottom + padTop;
  const totalWidth = Math.max(520, data.length * groupWidth + (data.length - 1) * groupGap + padLeft + 60);

  // Y 轴刻度
  const yTicks = [0, 20, 40, 60, 80, 100];

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
          const y = padTop + plotH - (tick / yMax) * plotH;
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

        {/* 柱状组 */}
        {data.map((d, di) => {
          const groupX = padLeft + di * (groupWidth + groupGap);
          return (
            <g key={di}>
              {activeCategories.map((cat, ci) => {
                const score = d.categoryScores[cat] ?? 0;
                const maxScore = categoryMaxes[cat] ?? 0;
                const h = maxScore > 0 ? (score / maxScore) * plotH : 0;
                const barX = groupX + ci * (barWidth + gap);
                const barY = padTop + plotH - h;
                const color = CATEGORY_COLOR[cat] ?? '#0b63ce';

                return (
                  <g key={cat}>
                    {/* 柱 */}
                    <rect
                      x={barX}
                      y={barY}
                      width={barWidth}
                      height={h}
                      fill={color}
                      rx={2}
                    />
                    {/* 分数标签 */}
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
              {/* 供应商名（截断 8 字）*/}
              <text
                x={groupX + groupWidth / 2}
                y={padTop + plotH + 20}
                textAnchor="middle"
                className="text-[11px] font-medium"
                fill="oklch(0.45 0.01 264)"
              >
                {d.name.length > 8 ? d.name.slice(0, 8) + '…' : d.name}
              </text>
              {/* 总分 */}
              <text
                x={groupX + groupWidth / 2}
                y={padTop + plotH + 36}
                textAnchor="middle"
                className="text-[10px] font-semibold tabular-nums"
                fill="oklch(0.55 0.008 264)"
              >
                {d.totalScore.toFixed(1)}分
              </text>
            </g>
          );
        })}

        {/* 图例 */}
        <g transform={`translate(${padLeft}, ${padTop - 20})`}>
          {activeCategories.map((cat, i) => (
            <g key={cat} transform={`translate(${i * 80}, 0)`}>
              <rect
                x={0}
                y={0}
                width={10}
                height={10}
                rx={2}
                fill={CATEGORY_COLOR[cat] ?? '#0b63ce'}
              />
              <text x={14} y={9} className="text-[10px]" fill="oklch(0.5 0.008 264)">
                {CATEGORY_LABEL[cat] ?? cat}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
