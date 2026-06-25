'use client';

import type { AiScoreItem } from '@water-erp/shared';

// ── 分类标签与颜色（与 page.tsx 中的 CATEGORY_LABEL / CATEGORY_COLOR 保持一致）──

export const CATEGORY_LABEL: Record<string, string> = {
  QUALIFICATION: '资格审查',
  RESPONSIVE: '响应性评审',
  BUSINESS: '商务评审',
  TECHNICAL: '技术评审',
  PRICE: '价格评审',
};

export const CATEGORY_COLOR: Record<string, string> = {
  QUALIFICATION: '#064ea2',
  RESPONSIVE: '#0b63ce',
  BUSINESS: '#f5a623',
  TECHNICAL: '#11a874',
  PRICE: '#e74c3c',
};

// ── 单条评分进度条 ──

interface ScoreBarProps {
  label: string;
  score: number;
  maxScore: number;
  comment?: string;
  color?: string;
}

function ScoreBar({ label, score, maxScore, comment, color = '#0b63ce' }: ScoreBarProps) {
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-[var(--color-text-secondary)] truncate mr-2">{label}</span>
        <span className="font-medium tabular-nums text-[var(--color-text)]">
          {score.toFixed(1)}/{maxScore}
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'oklch(0.94 0.004 264)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      {comment && (
        <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 ml-1 line-clamp-1">
          {comment}
        </p>
      )}
    </div>
  );
}

// ── 按类别分组的评分明细 ──

interface ScoreBreakdownBarsProps {
  scoreItems: AiScoreItem[];
}

export function ScoreBreakdownBars({ scoreItems }: ScoreBreakdownBarsProps) {
  if (!scoreItems || scoreItems.length === 0) return null;

  // 按 category 分组
  const grouped: Record<string, AiScoreItem[]> = {};
  for (const si of scoreItems) {
    if (!grouped[si.category]) grouped[si.category] = [];
    grouped[si.category].push(si);
  }

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([category, items]) => {
        const catTotal = items.reduce((a, b) => a + b.score, 0);
        const catMax = items.reduce((a, b) => a + b.maxScore, 0);
        const color = CATEGORY_COLOR[category] ?? '#0b63ce';
        return (
          <div key={category}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-1.5 h-5 rounded-full"
                  style={{ background: color }}
                />
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  {CATEGORY_LABEL[category] ?? category}
                </span>
              </div>
              <span className="text-sm font-medium tabular-nums text-[var(--color-text-secondary)]">
                {catTotal.toFixed(1)} / {catMax}
              </span>
            </div>
            <div className="space-y-2.5 pl-4">
              {items.map((item) => (
                <ScoreBar
                  key={item.scoreItemId}
                  label={item.name}
                  score={item.score}
                  maxScore={item.maxScore}
                  comment={item.reason}
                  color={color}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
