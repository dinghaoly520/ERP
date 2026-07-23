'use client';

import { useState } from 'react';
import { Check, ShieldCheck, StickyNote } from 'lucide-react';
import { verifyScoreReview } from '@/lib/api';
import { toast } from 'sonner';
import {
  isPassFailCategory,
  CATEGORY_LABEL,
  CATEGORY_COLOR,
  type BidScoreItem,
} from '@water-erp/shared';

interface Props {
  projectId: string;
  supplierId: string;
  supplierName: string;
  /** project.scoreItems（含 maxScore / category） */
  scoreItems: BidScoreItem[];
  /** 该专家全部评分，键为 `${supplierId}:${scoreItemId}` */
  scores: Record<string, { score: number; reason: string; passed?: boolean }>;
  /** 该 supplier 的核对状态（来自 myExpertRecord.scoreReviews） */
  reviewStatus?: 'draft' | 'verified';
  /** 核对成功后 reload */
  onVerified: () => void;
  /** P5 Task 7: 打开桌面端备忘抽屉 */
  onOpenMemo?: () => void;
}

const key = (sid: string, iid: string) => `${sid}:${iid}`;

export function VerifyScoreStep({
  projectId,
  supplierId,
  supplierName,
  scoreItems,
  scores,
  reviewStatus,
  onVerified,
  onOpenMemo,
}: Props) {
  const [busy, setBusy] = useState(false);
  const verified = reviewStatus === 'verified';

  // 按类别分组（镜像 scoring step 的分组逻辑，只读展示）
  const grouped: Record<string, BidScoreItem[]> = {};
  scoreItems.forEach((si) => {
    if (!grouped[si.category]) grouped[si.category] = [];
    grouped[si.category].push(si);
  });

  async function handleVerify() {
    setBusy(true);
    try {
      await verifyScoreReview(projectId, supplierId);
      toast.success(`${supplierName} 评分核对已确认`);
      onVerified();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '核对失败';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* 标题 */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
          <h2 className="text-lg font-bold text-[var(--foreground)]">
            核对评分 — {supplierName}
          </h2>
          {verified && (
            <span className="exp-pill" style={{ '--c': 'var(--success)' } as React.CSSProperties}>
              已核对
            </span>
          )}
        </div>
        {/* P5 Task 7: 核对步骤备忘入口（与 scoring 步骤对称） */}
        {onOpenMemo && (
          <button
            type="button"
            onClick={onOpenMemo}
            className="neu-btn-xs shrink-0"
            aria-label="打开备忘面板"
          >
            <StickyNote size={14} strokeWidth={1.7} /> 备忘
          </button>
        )}
      </div>
      <p className="mb-6 text-sm text-[var(--muted-foreground)]">
        请审阅以下评分，确认无误后点击「确认核对」。核对后评分将进入下一环节。
      </p>

      {/* 只读评分汇总（按类别） */}
      <div className="space-y-6">
        {Object.entries(grouped).map(([category, items]) => {
          const catTotal = items.reduce((s, i) => s + Number(i.maxScore), 0);
          const catScored = items.reduce(
            (s, i) => s + (scores[key(supplierId, i.id)]?.score ?? 0),
            0,
          );
          const passFail = isPassFailCategory(category);
          const color = CATEGORY_COLOR[category] || 'var(--accent-strong)';
          return (
            <div key={category} className="exp-category-group">
              {/* 类别头 */}
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="exp-category-chip" style={{ '--cat': color } as React.CSSProperties} />
                  <span className="text-sm font-bold text-[var(--foreground)]">
                    {CATEGORY_LABEL[category] || category}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">{items.length} 项</span>
                </div>
                <div className="flex items-center gap-2">
                  {passFail ? (
                    <span className="text-sm font-bold text-[var(--muted-foreground)]">通过性审查</span>
                  ) : (
                    <>
                      <span className="text-xs text-[var(--muted-foreground)]">得分</span>
                      <span className="text-lg font-bold text-[var(--accent-strong)]">{catScored}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">/ {catTotal}</span>
                    </>
                  )}
                </div>
              </div>
              {/* 条目列表（只读） */}
              <div className="space-y-3">
                {items.map((item) => {
                  const entry = scores[key(supplierId, item.id)];
                  const itemPassFail = isPassFailCategory(item.category);
                  return (
                    <div key={item.id} className="neu-card-static !rounded-[14px] p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[var(--foreground)]">
                            {item.name}
                          </div>
                          {item.scoringCriteria && (
                            <div className="mt-1 line-clamp-2 text-xs text-[var(--muted-foreground)]">
                              {item.scoringCriteria}
                            </div>
                          )}
                          {entry?.reason && (
                            <div className="mt-2 rounded-[8px] bg-[oklch(0.985_0.005_258)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] shadow-[inset_1px_1px_2px_oklch(0.55_0.03_258/0.08),inset_-1px_-1px_2px_oklch(1_0_0/0.6)]">
                              理由：{entry.reason}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {itemPassFail ? (
                            <span
                              className={`text-sm font-bold ${entry?.passed === false ? 'text-[var(--danger)]' : entry?.passed === true ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}`}
                            >
                              {entry?.passed === false
                                ? '不通过'
                                : entry?.passed === true
                                  ? '通过'
                                  : '未评'}
                            </span>
                          ) : (
                            <span className="text-sm text-[var(--muted-foreground)]">
                              <span className="font-bold text-[var(--foreground)]">
                                {entry?.score ?? 0}
                              </span>{' '}
                              / {Number(item.maxScore)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 确认核对按钮 */}
      <button
        type="button"
        onClick={handleVerify}
        disabled={busy || verified}
        className="neu-btn-primary is-success mt-6 w-full"
      >
        <Check size={16} strokeWidth={2.5} />
        {verified ? '已核对' : busy ? '核对中…' : '确认核对'}
      </button>
    </div>
  );
}
