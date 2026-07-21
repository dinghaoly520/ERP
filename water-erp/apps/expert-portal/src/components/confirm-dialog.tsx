'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 破坏性操作：警示图标 + 确认键红色 */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 拟态确认弹窗（与 .impeccable.md 设计系统一致）。
 *
 * - createPortal 到 body，z-[60] 浮于全屏手写浮层（z-50）之上
 * - Esc 关闭、点遮罩关闭、卡片内点击不关
 * - 打开时锁定 body 滚动 + 自动聚焦取消键（破坏性操作下更防误触）
 * - 动效克制：不加入场动画，靠卡片拟态 + 遮罩模糊撑质感
 */
export function ConfirmDialog({
  open, title, message,
  confirmText = '确认', cancelText = '取消', danger = false,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  // 用 ref 保留最新 onCancel，避免每次父组件渲染都重订阅 keydown
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelRef.current(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // 自动聚焦取消键（rAF 等 portal 挂载后）
    const t = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[oklch(0.18_0.012_265_/_.45)] p-4 backdrop-blur-[2px]"
      onClick={() => onCancelRef.current()}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'confirm-dialog-title' : undefined}
      aria-describedby="confirm-dialog-desc"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[oklch(0.92_0.004_265)] bg-white p-5
                   shadow-[0_2px_0_oklch(0.92_0.004_265),0_12px_32px_-8px_oklch(0.55_0.03_258_/_.28),inset_0_1px_0_oklch(1_0_0)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {danger && (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e74c3c]/10 text-[#e74c3c]">
              <AlertTriangle size={16} strokeWidth={1.8} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {title && (
              <h2 id="confirm-dialog-title" className="text-sm font-bold text-[oklch(0.18_0.012_265)]">
                {title}
              </h2>
            )}
            <p
              id="confirm-dialog-desc"
              className={`text-[13px] leading-relaxed text-[oklch(0.45_0.01_264)] ${title ? 'mt-1' : ''}`}
            >
              {message}
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onCancelRef.current()}
            className="rounded-xl border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] px-4 py-2 text-xs font-semibold text-[oklch(0.45_0.01_265)]
                       shadow-[0_1px_0_oklch(1_0_0),inset_0_1px_0_oklch(1_0_0)]
                       hover:shadow-[0_2px_0_oklch(0.92_0.004_265),inset_0_1px_0_oklch(1_0_0)]
                       active:shadow-[inset_0_1px_3px_oklch(0.55_0.03_258_/_.12)] active:translate-y-px
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#064ea2]/40
                       transition-all duration-150"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-xs font-bold text-white transition-all duration-150
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white
                        ${danger
                          ? 'bg-[#e74c3c] shadow-[0_1px_0_oklch(0.5_0.2_25),inset_0_1px_0_oklch(1_0_0_/_.25)] hover:bg-[#d94234] focus-visible:ring-[#e74c3c]/40'
                          : 'bg-[#064ea2] shadow-[0_1px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.25)] hover:bg-[#054280] focus-visible:ring-[#064ea2]/40'}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
