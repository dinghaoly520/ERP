'use client';

import type { AiScoreItem } from '@water-erp/shared';

// ── 分类标签与颜色 ──

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
  evidence?: string;
  color?: string;
  /** 折叠态截断行数：1=1行（默认），2=2行 */
  reasonLines?: number;
  /** 展开：reason 不截断 + 显示证据 */
  expanded?: boolean;
}

function ScoreBar({ label, score, maxScore, comment, evidence, color = '#0b63ce', reasonLines = 1, expanded = false }: ScoreBarProps) {
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  const clampClass = expanded ? '' : reasonLines === 2 ? 'line-clamp-2' : 'line-clamp-1';
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-[var(--color-text-secondary)] truncate mr-2">{label}</span>
        <span className="font-medium tabular-nums text-[var(--color-text)]">
          {score.toFixed(1)}/{maxScore}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'oklch(0.94 0.004 264)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      {comment && (
        <p className={`text-[10px] text-[var(--color-text-tertiary)] mt-0.5 ml-1 ${clampClass}`}>{comment}</p>
      )}
      {expanded && evidence && (
        <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 ml-1">证据：{evidence}</p>
      )}
    </div>
  );
}

// ── 按类别分组的评分明细 ──

interface ScoreBreakdownBarsProps {
  scoreItems: AiScoreItem[];
  reasonLines?: number;
  /** 展开：reason 不截断 + 显示证据 */
  expanded?: boolean;
  /** 扁平模式：不显示分类标题/分组（用于已在外层按 category 分组的场景，避免标题重复） */
  flat?: boolean;
}

export function ScoreBreakdownBars({ scoreItems, reasonLines = 1, expanded = false, flat = false }: ScoreBreakdownBarsProps) {
  if (!scoreItems || scoreItems.length === 0) return null;

  // 扁平模式：直接渲染每项（无分类标题），用各项自身 category 的颜色
  if (flat) {
    return (
      <div className="space-y-2.5">
        {scoreItems.map((item) => (
          <ScoreBar
            key={item.scoreItemId}
            label={item.name}
            score={item.score}
            maxScore={item.maxScore}
            comment={item.reason}
            evidence={item.evidence}
            color={CATEGORY_COLOR[item.category] ?? '#0b63ce'}
            reasonLines={reasonLines}
            expanded={expanded}
          />
        ))}
      </div>
    );
  }

  // 分组模式：按 category 分组 + 分类标题
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
                <span className="w-1.5 h-5 rounded-full" style={{ background: color }} />
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
                  evidence={item.evidence}
                  color={color}
                  reasonLines={reasonLines}
                  expanded={expanded}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
