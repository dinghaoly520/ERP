'use client';

import { useState } from 'react';
import type { AiScoreItem } from '@water-erp/shared';
import { CATEGORY_LABEL, CATEGORY_COLOR } from '@water-erp/shared';

// 向后兼容：重新导出，使仍从该文件导入的消费者继续工作
export { CATEGORY_LABEL, CATEGORY_COLOR };

// ── 单条评分进度条 ──

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

function ScoreBar({ label, score, maxScore, comment, evidence, color = '#0b63ce', reasonLines = 2, expanded = false, confidence, unstable, strengths, weaknesses }: ScoreBarProps) {
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
      {evidence && (
        <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 ml-1">证据：{evidence}</p>
      )}
      {(confidence != null || unstable) && (
        <div className="flex items-center gap-1.5 mt-1 ml-1">
          {confidence != null && confidence < 0.6 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> 置信度 {Math.round(confidence * 100)}%
            </span>
          )}
          {unstable && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">
              ⚙ 不稳定
            </span>
          )}
        </div>
      )}
      {/* per-item 正向依据 / 需关注事项（仅展开态显示，避免折叠态膨胀） */}
      {expanded && (strengths?.length || weaknesses?.length) ? (
        <div className="mt-1.5 ml-1 space-y-0.5">
          {strengths?.map((s, i) => (
            <div key={`s${i}`} className="text-[10px] text-emerald-700 flex items-start gap-1 leading-snug">
              <span className="text-emerald-500 shrink-0 font-bold">+</span>
              <span>{s}</span>
            </div>
          ))}
          {weaknesses?.map((w, i) => (
            <div key={`w${i}`} className="text-[10px] text-amber-700 flex items-start gap-1 leading-snug">
              <span className="text-amber-500 shrink-0 font-bold">−</span>
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
    <button onClick={() => setExpandedAll(v => !v)} className="mt-2 text-[11px] text-[var(--color-primary)] hover:underline">
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
              color={CATEGORY_COLOR[item.category] ?? '#0b63ce'}
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
