'use client';

import { AlertTriangle, CircleHelp, MessageSquare, MessageSquarePlus } from 'lucide-react';
import type { LinkedDispute } from '@/lib/requirement-dispute-link';

export interface PointDecisionValue { checked: boolean; awardedScore: number; note?: string }
export interface PointDef { id: string; name: string; fullScore: number | string; objective: boolean; evidenceHint?: string | null; seq: number }

interface Props {
  points: PointDef[];
  value: Record<string, PointDecisionValue>; // pointId -> decision
  onChange: (pointId: string, v: PointDecisionValue) => void;
  readOnly?: boolean;
  compact?: boolean; // tablet 用更紧凑布局
  /** 隐藏逐小点批注框（调用方自带批注 UI 时用，如条款核对面板） */
  hideNotes?: boolean;
  /** 当前选中得分点 id（高亮） */
  selectedPointId?: string | null;
  /** 点击得分点行 → 选中用于手写备忘 */
  onPointClick?: (pointId: string, pointName: string) => void;
  /** 得分点批注计数（pointId → count），用于角标渲染 */
  pointMemoCounts?: Record<string, number>;
  /** 条款核对争议（Phase 2 精确关联）：pointId → 命中管理端映射的争议（dispute=异议/doubt=存疑） */
  pointDisputes?: Record<string, LinkedDispute[]>;
  /** 点击异议徽章 →「按异议扣分」预填（页面层实现：置否+理由前缀）；缺省仅展示 */
  onDisputeApply?: (pointId: string, dispute: LinkedDispute) => void;
  /** 点击存疑徽章 → 插入备注进理由框（页面层实现）；缺省仅展示 */
  onDoubtInsert?: (pointId: string, dispute: LinkedDispute) => void;
}

/**
 * 打分 checklist 共享组件（cgzxui 新拟态）：
 * - objective point → .neu-checkbox（勾选默认满分，可下调）
 * - subjective point → .exp-score-input 数值输入
 * - pointDisputes → 🔺异议（可按异议扣分）/🟡存疑（插入备注）徽章（Phase 2 映射精确关联）
 * 桌面端与 tablet 端复用（compact 切换紧凑布局）。
 */
export function PointChecklistScoring({ points, value, onChange, readOnly, compact, hideNotes, selectedPointId, onPointClick, pointMemoCounts, pointDisputes, onDisputeApply, onDoubtInsert }: Props) {
  const sorted = [...points].sort((a, b) => a.seq - b.seq);
  return (
    <div className="space-y-2">
      {sorted.map(p => {
        const v = value[p.id] ?? { checked: false, awardedScore: 0 };
        const max = Number(p.fullScore);
        const isSelected = selectedPointId === p.id;
        // Phase 2：本得分点命中的条款争议（映射精确关联；多争议收敛计数）
        const disputes = pointDisputes?.[p.id] ?? [];
        const disputeList = disputes.filter(d => d.verdict === 'dispute');
        const doubtList = disputes.filter(d => d.verdict === 'doubt');
        const disputeTitle = (list: LinkedDispute[]) => list
          .map(d => `【${d.verdict === 'dispute' ? '异议' : '存疑'}】${d.content?.trim() ? d.content.slice(0, 40) : '(原文缺失)'}${d.note ? `｜备注：${d.note.slice(0, 30)}` : ''}`)
          .join('\n');
        return (
          <div key={p.id}
            className={`rounded-[10px] transition ${
              isSelected
                ? 'bg-[oklch(0.96_0.03_251/0.3)] shadow-[inset_0_0_0_1.5px_color-mix(in_oklch,var(--accent-strong)_45%,transparent)]'
                : 'bg-[oklch(1_0_0/0.55)]'
            }`}>
            <div role="button" tabIndex={0}
              onClick={() => onPointClick?.(p.id, p.name)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPointClick?.(p.id, p.name); } }}
              className={`flex cursor-pointer items-center gap-3 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
              {p.objective ? (
                <input
                  type="checkbox"
                  className="neu-checkbox"
                  checked={v.checked}
                  disabled={readOnly}
                  aria-label={`${p.name} 客观得分点`}
                  onClick={e => e.stopPropagation()}
                  onChange={() => onChange(p.id, { ...v, checked: !v.checked, awardedScore: !v.checked ? max : 0 })}
                />
              ) : (
                <span className="exp-pill shrink-0" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>主观</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="truncate text-sm font-medium text-[var(--foreground)]">{p.name}</div>
                  {/* Phase 2：异议徽章（可按异议扣分）/ 存疑徽章（插入备注）——只读态仅展示 */}
                  {disputeList.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!readOnly && onDisputeApply) onDisputeApply(p.id, disputeList[0]);
                      }}
                      disabled={readOnly || !onDisputeApply}
                      title={readOnly ? `异议 ${disputeList.length} 条（只读）\n${disputeTitle(disputeList)}` : `异议 ${disputeList.length} 条——点击按异议扣分（置否+理由预填）\n${disputeTitle(disputeList)}`}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--danger)] disabled:cursor-default"
                    >
                      <AlertTriangle size={10} strokeWidth={2} />异议{disputeList.length}
                    </button>
                  )}
                  {doubtList.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!readOnly && onDoubtInsert) onDoubtInsert(p.id, doubtList[0]);
                      }}
                      disabled={readOnly || !onDoubtInsert}
                      title={readOnly ? `存疑 ${doubtList.length} 条（只读）\n${disputeTitle(doubtList)}` : `存疑 ${doubtList.length} 条——点击插入备注进理由框\n${disputeTitle(doubtList)}`}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-bold text-[oklch(0.52_0.13_70)] disabled:cursor-default"
                    >
                      <CircleHelp size={10} strokeWidth={2} />存疑{doubtList.length}
                    </button>
                  )}
                </div>
                {p.evidenceHint && <div className="truncate text-xs text-[var(--muted-foreground)]">{p.evidenceHint}</div>}
              </div>
              {/* fullScore=0（通过制得分点）隐藏数字输入与「/ 0」噪声——勾选即满分 0 */}
              {max > 0 && (
                <>
                  <input type="number" min={0} max={max} step={0.5} value={v.awardedScore} disabled={readOnly}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => onChange(p.id, { ...v, awardedScore: Math.max(0, Math.min(Number(e.target.value) || 0, max)) })}
                    className="exp-score-input shrink-0 !h-[34px] !w-[64px] !text-[13px] disabled:opacity-60"
                    aria-label={`${p.name} 得分`} />
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">/ {max}</span>
                </>
              )}
              {/* 批注角标（只读状态指示） */}
              {!hideNotes && (() => {
                const count = pointMemoCounts?.[p.id] ?? 0;
                if (readOnly && count === 0) return null;
                return (
                  <span
                    className={`relative flex shrink-0 items-center justify-center rounded-md h-8 w-8 ${
                      count > 0
                        ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent-strong)]'
                        : 'text-[var(--muted-foreground)]'
                    }`}>
                    {count > 0
                      ? <MessageSquare size={compact ? 12 : 14} strokeWidth={1.5} />
                      : <MessageSquarePlus size={compact ? 12 : 14} strokeWidth={1.5} />}
                    {count > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-strong)] px-1 text-[9px] font-bold tabular-nums text-white">
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </span>
                );
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
