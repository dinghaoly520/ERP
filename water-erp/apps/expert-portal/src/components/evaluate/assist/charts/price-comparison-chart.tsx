'use client';

// ── 报价对比横向柱状图（跨供应商）──

interface PriceData {
  name: string;
  price: number;
}

interface PriceComparisonChartProps {
  data: PriceData[];
  maxPrice?: number | null;
  highlightName?: string;
  /** 报价单位标签，如 "万元" */
  unit?: string;
}

export function PriceComparisonChart({
  data,
  maxPrice,
  highlightName,
  unit = '万元',
}: PriceComparisonChartProps) {
  if (data.length === 0) return null;

  // 柱状图比例基于数据最大值 + 15% 余量
  const dataMax = Math.max(...data.map((d) => d.price));
  const barScale = dataMax * 1.15;

  // 限价线：仅在单位一致（与报价同数量级）时绘制
  const limitPrice =
    maxPrice != null && maxPrice > 0 && maxPrice <= dataMax * 3 ? maxPrice : null;

  return (
    <div className="space-y-2.5">
      {/* 限价标注 */}
      {maxPrice != null && maxPrice > 0 && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-danger)]">
          {limitPrice != null && (
            <span className="inline-block w-4 border-t-2 border-dashed border-[var(--color-danger)]" />
          )}
          最高限价：{maxPrice}{unit}
        </div>
      )}

      {/* 柱状条 */}
      {data.map((d, i) => {
        const barPct = barScale > 0 ? (d.price / barScale) * 100 : 0;
        const isOver = limitPrice != null && d.price > limitPrice;
        const isHighlighted = highlightName && d.name === highlightName;

        const barColor = isOver
          ? '#fca5a5'
          : isHighlighted
            ? 'var(--color-primary)'
            : '#93c5fd';
        const barBg = isOver ? '#fef2f2' : '#eff6ff';
        const limitPct = limitPrice != null && barScale > 0 ? (limitPrice / barScale) * 100 : null;

        return (
          <div key={i} className="flex items-center gap-2">
            <span
              className={`w-24 shrink-0 truncate text-right text-xs ${
                isHighlighted ? 'font-semibold text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'
              }`}
              title={d.name}
            >
              {d.name.length > 8 ? d.name.slice(0, 8) + '…' : d.name}
            </span>
            <div className="flex-1 min-w-0">
              <div
                className="relative h-7 rounded-md border"
                style={{
                  background: barBg,
                  borderColor: isHighlighted ? 'var(--color-primary-border)' : 'transparent',
                }}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-md transition-all duration-500"
                  style={{
                    width: `${Math.min(barPct, 100)}%`,
                    background: barColor,
                    opacity: isHighlighted ? 1 : 0.75,
                  }}
                />
                {/* 限价虚线 */}
                {limitPct != null && limitPct <= 100 && (
                  <div
                    className="absolute top-0 bottom-0 w-0 border-l-2 border-dashed border-[var(--color-danger)]"
                    style={{ left: `${limitPct}%` }}
                  />
                )}
              </div>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-secondary)] min-w-[70px] text-right">
              {d.price.toFixed(2)}{unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}
