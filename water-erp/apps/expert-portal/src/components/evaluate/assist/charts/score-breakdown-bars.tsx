'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AiScoreItem } from '@water-erp/shared';
import { CATEGORY_LABEL, CATEGORY_COLOR } from '@water-erp/shared';

// 向后兼容：重新导出，使仍从该文件导入的消费者继续工作
export { CATEGORY_LABEL, CATEGORY_COLOR };

// ── 单条评分进度条（cgzxui .exp-bar）──

interface ScoreBarProps {
  label: string;
  score: number;
  maxScore: number;
  comment?: string;
  evidence?: string;
  color?: string;
  /** 折叠态截断行数：1=1行，2=2行（默认） */
  reasonLines?: number;
  /** 展开：reason 不截断 + 显示证据 */
  expanded?: boolean;
  /** AI 置信度 0-1；<0.6 显示低置信标记 */
  confidence?: number;
  /** 多次采样差异大（self-consistency），AI 把握度低 */
  unstable?: boolean;
  /** per-item 正向事实（引用标书原文） */
  strengths?: string[];
  /** per-item 需关注事项 */
  weaknesses?: string[];
}

function ScoreBar({ label, score, maxScore, comment, evidence, color = 'var(--accent-strong)', reasonLines = 2, expanded = false, confidence, unstable, strengths, weaknesses }: ScoreBarProps) {
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  const clampClass = expanded ? '' : reasonLines === 2 ? 'line-clamp-2' : 'line-clamp-1';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="mr-2 truncate text-[var(--muted-foreground)]">{label}</span>
        <span className="font-medium tabular-nums text-[var(--foreground)]">
          {score.toFixed(1)}/{maxScore}
        </span>
      </div>
      <div className="exp-bar">
        <i style={{ width: `${pct}%`, '--bar': color } as React.CSSProperties} />
      </div>
      {comment && (
        <p className={`ml-1 mt-1 text-[10px] text-[var(--muted-foreground)] ${clampClass}`}>{comment}</p>
      )}
      {evidence && (
        <p className="ml-1 mt-1 text-[10px] text-[var(--muted-foreground)]">证据：{evidence}</p>
      )}
      {(confidence != null || unstable) && (
        <div className="ml-1 mt-1 flex items-center gap-1.5">
          {confidence != null && confidence < 0.6 && (
            <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>
              <span className="exp-pill-dot" /> 置信度 {Math.round(confidence * 100)}%
            </span>
          )}
          {unstable && (
            <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>
              <RefreshCw size={9} strokeWidth={2} /> 不稳定
            </span>
          )}
        </div>
      )}
      {/* per-item 正向依据 / 需关注事项（仅展开态显示，避免折叠态膨胀） */}
      {expanded && (strengths?.length || weaknesses?.length) ? (
        <div className="ml-1 mt-1.5 space-y-0.5">
          {strengths?.map((s, i) => (
            <div key={`s${i}`} className="flex items-start gap-1 text-[10px] leading-snug text-[var(--success)]">
              <span className="shrink-0 font-bold">+</span>
              <span>{s}</span>
            </div>
          ))}
          {weaknesses?.map((w, i) => (
            <div key={`w${i}`} className="flex items-start gap-1 text-[10px] leading-snug text-[var(--warning)]">
              <span className="shrink-0 font-bold">−</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── 按类别分组的评分明细 ──

interface ScoreBreakdownBarsProps {
  scoreItems: AiScoreItem[];
  /** 折叠态截断行数：1=1行，2=2行（默认） */
  reasonLines?: number;
  /** 展开：reason 不截断 + 显示证据 */
  expanded?: boolean;
  /** 扁平模式：不显示分类标题/分组（用于已在外层按 category 分组的场景，避免标题重复） */
  flat?: boolean;
  /** 可展开：渲染「展开全部理由」按钮并自管展开态（覆盖 expanded prop） */
  expandable?: boolean;
}

export function ScoreBreakdownBars({ scoreItems, reasonLines = 2, expanded = false, expandable = false, flat = false }: ScoreBreakdownBarsProps) {
  const [expandedAll, setExpandedAll] = useState(false);
  if (!scoreItems || scoreItems.length === 0) return null;

  const effExpanded = expandable ? expandedAll : expanded;
  const toggleBtn = expandable && scoreItems.some((i) => i.reason) ? (
    <button onClick={() => setExpandedAll(v => !v)} className="mt-2 text-[11px] text-[var(--accent-strong)] hover:underline">
      {effExpanded ? '收起理由' : '展开全部理由'}
    </button>
  ) : null;

  // 扁平模式：直接渲染每项（无分类标题），用各项自身 category 的颜色
  if (flat) {
    return (
      <div>
        <div className="space-y-2.5">
          {scoreItems.map((item) => (
            <ScoreBar
              key={item.scoreItemId}
              label={item.name}
              score={item.score}
              maxScore={item.maxScore}
              comment={item.reason}
              evidence={item.evidence}
              color={CATEGORY_COLOR[item.category] ?? 'var(--accent-strong)'}
              reasonLines={reasonLines}
              expanded={effExpanded}
              confidence={item.confidence}
              unstable={item.unstable}
              strengths={item.strengths}
              weaknesses={item.weaknesses}
            />
          ))}
        </div>
        {toggleBtn}
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
        const color = CATEGORY_COLOR[category] ?? 'var(--accent-strong)';
        return (
          <div key={category}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="h-5 w-1.5 rounded-full bg-[var(--cat)]"
                  style={{ '--cat': color } as React.CSSProperties}
                />
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  {CATEGORY_LABEL[category] ?? category}
                </span>
              </div>
              <span className="text-sm font-medium tabular-nums text-[var(--muted-foreground)]">
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
                  expanded={effExpanded}
                  confidence={item.confidence}
                  unstable={item.unstable}
                  strengths={item.strengths}
                  weaknesses={item.weaknesses}
                />
              ))}
            </div>
          </div>
        );
      })}
      {toggleBtn}
    </div>
  );
}
