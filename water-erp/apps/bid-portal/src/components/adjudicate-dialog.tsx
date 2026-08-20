'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Gavel, Loader, X } from 'lucide-react';
import type { DecryptAdjudgeAttribution } from '@/lib/api';

/* ═══ 解密失败归因裁决弹窗（§5.5，T17）═══
   mode 决定可选项：
   - unknown：UNKNOWN 家三选（BIDDER / PLATFORM / RESET_PENDING），落终局或重置；
   - rejudge：已归因 BIDDER 的 DANGER 家改判 PLATFORM（撤销判定更正为撤回——T15 纠错通道）；
   - reset：已归因 PLATFORM 的 DANGER 家重置解密机会（窗口须开，后端窗口关时 409）。 */

export type AdjudgeMode = 'unknown' | 'rejudge' | 'reset';

interface OptionMeta {
  value: DecryptAdjudgeAttribution;
  label: string;
  desc: string;
  danger?: boolean;
}

const OPTIONS: OptionMeta[] = [
  {
    value: 'BIDDER',
    label: '投标人责任（视为撤销）',
    desc: '因投标人原因未完成解密——视为撤销投标文件，保证金依招标文件规定处理',
    danger: true,
  },
  {
    value: 'PLATFORM',
    label: '平台责任（视为撤回）',
    desc: '因平台原因未完成解密——视为撤回投标文件，投标人有权要求责任方赔偿直接损失',
  },
  {
    value: 'RESET_PENDING',
    label: '重置解密机会',
    desc: '重置为待解密状态，供应商可在解密窗口内重新解密上传（窗口关闭时不可用）',
  },
];

interface Props {
  open: boolean;
  supplierName: string;
  mode: AdjudgeMode;
  submitting?: boolean;
  /** 解密窗口是否开启——关闭时禁用 RESET_PENDING（后端窗口关时 409，需先延长窗口） */
  windowOpen?: boolean;
  onConfirm: (attribution: DecryptAdjudgeAttribution, reason: string) => void;
  onClose: () => void;
}

export default function AdjudicateDialog({ open, supplierName, mode, submitting, windowOpen = true, onConfirm, onClose }: Props) {
  const [choice, setChoice] = useState<DecryptAdjudgeAttribution | null>(null);
  const [reason, setReason] = useState('');

  // 每次打开重置（含模式切换），避免上一次的选择串场
  useEffect(() => {
    if (open) { setChoice(null); setReason(''); }
  }, [open, mode]);

  if (!open) return null;

  const options = OPTIONS.filter(o => {
    if (mode === 'rejudge') return o.value === 'PLATFORM';
    if (mode === 'reset') return o.value === 'RESET_PENDING';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bid-dialog relative mx-4 w-full max-w-[min(520px,92vw)]" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
          <h3 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight text-[color:var(--foreground)]">
            <Gavel size={16} className="text-[var(--warning)]" />
            {mode === 'rejudge' ? '归因改判' : mode === 'reset' ? '重置解密机会' : '解密失败归因裁决'}
          </h3>
          <button type="button" onClick={onClose} className="neu-btn-xs" aria-label="关闭"><X size={15} /></button>
        </div>

        <hr className="wb-section-rule mx-6" />

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-2.5 rounded-xl bg-[oklch(0.78_0.12_83_/_0.16)] p-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[oklch(0.46_0.11_65)]" />
            <div className="space-y-1 text-[12px] leading-relaxed tracking-tight text-[oklch(0.46_0.11_65)]">
              <p className="font-bold">裁决对象：{supplierName}</p>
              {mode === 'rejudge' && (
                <p>原判定「投标人责任（视为撤销）」将更正为「平台责任（视为撤回）」，更正声明随通知送达供应商。</p>
              )}
              {mode === 'reset' && (
                <p>重置后供应商可重新解密上传；解密窗口须开启，否则请先延长窗口。</p>
              )}
              {mode === 'unknown' && (
                <p>裁决结果将写入监督日志与开标文件包，并按归因向供应商发送权利告知通知，请审慎判定。</p>
              )}
            </div>
          </div>

          {/* Attribution options */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              归因判定
            </label>
            <div className="space-y-2">
              {options.map(o => {
                const disabled = o.value === 'RESET_PENDING' && !windowOpen;
                return (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${
                    disabled ? 'cursor-not-allowed opacity-50' : choice === o.value
                      ? 'border-[oklch(0.62_0.16_251_/_0.5)] bg-[oklch(0.62_0.16_251_/_0.08)]'
                      : 'border-[oklch(0.6_0.04_258_/_0.16)] hover:border-[oklch(0.62_0.16_251_/_0.3)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="adjudge-attribution"
                    checked={choice === o.value}
                    disabled={disabled}
                    onChange={() => setChoice(o.value)}
                    className="neu-checkbox mt-0.5"
                  />
                  <span className="text-[12px] leading-relaxed tracking-tight">
                    <span className={`block font-bold ${o.danger ? 'text-[var(--danger)]' : 'text-[color:var(--foreground)]'}`}>
                      {o.label}
                    </span>
                    <span className="block text-[color:var(--muted-foreground)]">
                      {disabled ? '解密窗口已关闭——请先延长窗口再重置' : o.desc}
                    </span>
                  </span>
                </label>
                );
              })}
            </div>
          </div>

          {/* Reason（必填：写监督日志与审计） */}
          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              裁决原因（必填）
            </span>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="填写裁决依据（如：供应商未在窗口内完成解密 / 平台解密包就绪通知延迟…）"
              className="h-20 w-full resize-y rounded-xl bg-[oklch(0.99_0.004_258)] px-3 py-2 text-xs text-[color:var(--foreground)] shadow-[inset_2px_2px_4px_oklch(0.55_0.03_258_/_0.08),inset_-2px_-2px_4px_oklch(1_0_0_/_0.6)] focus:outline-none"
            />
          </label>
        </div>

        <hr className="wb-section-rule mx-6" />

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <span className="text-[11px] font-semibold tracking-tight text-[var(--danger)]">裁决结果不可自动撤回</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="neu-btn-soft h-[38px]">取消</button>
            <button
              type="button"
              onClick={() => choice && onConfirm(choice, reason.trim())}
              disabled={!choice || !reason.trim() || submitting}
              className={`neu-btn-primary !h-[38px] disabled:opacity-50 ${choice === 'BIDDER' ? 'is-danger' : ''}`}
            >
              {submitting && <Loader size={12} className="animate-spin" />}
              {submitting
                ? '提交中…'
                : choice === 'BIDDER' ? '确认裁决：投标人责任'
                : choice === 'PLATFORM' ? '确认裁决：平台责任'
                : '确认重置解密机会'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
