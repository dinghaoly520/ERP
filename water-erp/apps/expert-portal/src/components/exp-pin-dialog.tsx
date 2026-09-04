'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Key, Loader2 } from 'lucide-react';

interface ExpPinDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  /** 解锁/签名进行中：按钮转圈 + 输入与关闭全锁（防流程中途打断出半开态） */
  busy?: boolean;
  confirmText?: string;
  onClose: () => void;
  /** 口令仅内存持有：由父组件在回调内即取即用，本组件卸载即弃 */
  onSubmit: (pin: string) => void;
}

/**
 * 证书口令弹窗（A-152 专家软证书/U盾解锁）——结构克隆 ConfirmDialog
 * （createPortal + .exp-dialog + Esc/遮罩关闭 + body 滚动锁），差异点：
 * - `neu-input` type=password + Enter 提交、打开自动聚焦输入框
 * - busy 期间 Esc/遮罩/取消均不关（口令已提交，流程进行中）
 */
export function ExpPinDialog({
  open, title, subtitle, busy = false, confirmText = '解锁', onClose, onSubmit,
}: ExpPinDialogProps) {
  const [pin, setPin] = useState('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // 打开即清空上次口令（不残留内存值），自动聚焦输入框
    setPin('');
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open, busy]);

  if (!open) return null;

  const submit = () => {
    if (!pin.trim() || busy) return;
    onSubmit(pin);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exp-pin-dialog-title"
    >
      {/* 蒙层（busy 中不关——防流程中途打断） */}
      <div
        className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm"
        onClick={() => { if (!busy) onCloseRef.current(); }}
      />
      <div
        className="exp-dialog relative w-full max-w-sm p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] text-[var(--accent-strong)] bg-[color-mix(in_oklch,var(--accent-strong)_10%,transparent)]">
            <Key size={16} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="exp-pin-dialog-title" className="text-sm font-bold text-[var(--foreground)]">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted-foreground)]">{subtitle}</p>
            )}
          </div>
        </div>

        <input
          ref={inputRef}
          type="password"
          className="neu-input mt-4"
          value={pin}
          disabled={busy}
          autoComplete="new-password"
          placeholder="证书口令"
          aria-label="证书口令"
          onChange={e => setPin(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onCloseRef.current()}
            className="neu-btn-soft !h-[38px]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !pin.trim()}
            className="neu-btn-primary !h-[38px]"
          >
            {busy
              ? <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" />处理中…</span>
              : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
