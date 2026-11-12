'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Gavel, AlertTriangle, Check, X } from 'lucide-react';

/** B7（2026-11-12）：废标复议召集弹窗（组长定向）。
 *  视图模型同时承接两源：WS LeadReviewSuggestedPayload 与 getProject pendingInvalidReviews。 */
export interface LeadReviewView {
  invalidBidId: string;
  supplierName: string;
  scoreItemName: string;
  category: 'QUALIFICATION' | 'RESPONSIVE';
  failCount: number;
  totalCount: number;
  votes: { expertName: string; passed: boolean; reason: string | null }[];
  /** B6 兜底源附带：表决进行中（改横幅态展示） */
  hasOpenMotion?: boolean;
  canRemotion?: boolean;
}

interface LeadReviewModalProps {
  open: boolean;
  review: LeadReviewView | null;
  busy: boolean;
  onSubmit: (invalidBidId: string) => void;
  onDismiss: (invalidBidId: string) => void;
}

/**
 * cgzxui 新拟态弹窗（.wb-modal-shell 壳 + 38px 齐平按钮，与 ConfirmDialog 同体系）。
 * 内容：供应商/评分项/票数 + 记名票面（逐票理由）；动作：发起复议表决（组长）/ 暂不处理。
 * 文案要点：裁定后该项评分投票冻结；也可现场讨论后由专家改票（票数变化自动恢复）。
 */
export function LeadReviewModal({ open, review, busy, onSubmit, onDismiss }: LeadReviewModalProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && review) onDismissRef.current(review.invalidBidId); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => dismissRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open, review]);

  if (!open || !review) return null;

  const categoryLabel = review.category === 'QUALIFICATION' ? '资格性审查' : '符合性审查';

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-review-title"
    >
      <div
        className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm"
        onClick={() => onDismissRef.current(review.invalidBidId)}
      />
      <div
        className="wb-modal-shell relative overflow-hidden w-full max-w-md p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)]">
            <Gavel size={16} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="lead-review-title" className="text-sm font-bold text-[var(--foreground)]">
              废标复议召集：{review.supplierName}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
              {categoryLabel}「{review.scoreItemName}」不通过票 <span className="font-bold text-[var(--danger)]">{review.failCount}/{review.totalCount}</span>（严格过半，已自动废标）——请召集委员会复议并最终裁定。
            </p>
          </div>
        </div>

        {/* 记名票面 */}
        <div className="mt-4 max-h-44 overflow-y-auto rounded-[12px] border border-[oklch(0.6_0.04_258/0.14)] bg-[oklch(1_0_0/0.45)] p-3">
          <ul className="space-y-2">
            {review.votes.length === 0 && (
              <li className="text-xs text-[var(--muted-foreground)]">（无票面记录）</li>
            )}
            {review.votes.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                {v.passed
                  ? <Check size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--success)]" />
                  : <X size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--danger)]" />}
                <div className="min-w-0">
                  <span className="font-semibold text-[var(--foreground)]">{v.expertName}</span>
                  <span className={v.passed ? 'ml-1 text-[var(--success)]' : 'ml-1 text-[var(--danger)]'}>
                    {v.passed ? '通过' : '不通过'}
                  </span>
                  {!v.passed && v.reason && (
                    <span className="block text-[var(--muted-foreground)]">理由：{v.reason}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          <AlertTriangle size={12} strokeWidth={1.5} className="mt-0.5 shrink-0" />
          发起表决后该项评分投票暂停，裁定落地后终局冻结（不可再改票）；也可现场讨论后由专家自行改票——票数变化将自动恢复该供应商参评。
        </p>

        <div className="mx-5 mt-4 h-px shrink-0 bg-[oklch(0.6_0.04_258/0.16)]" />

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={dismissRef}
            type="button"
            onClick={() => onDismiss(review.invalidBidId)}
            className="neu-btn-soft !h-[38px]"
          >
            暂不处理
          </button>
          <button
            type="button"
            disabled={busy || review.hasOpenMotion || review.canRemotion === false}
            onClick={() => onSubmit(review.invalidBidId)}
            className="neu-btn-primary !h-[38px]"
          >
            {review.hasOpenMotion ? '表决进行中' : '发起复议表决'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
