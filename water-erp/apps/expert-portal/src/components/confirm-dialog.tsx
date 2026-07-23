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
 * cgzxui 新拟态确认弹窗（.exp-dialog 浮动薄板 + 38px 齐平按钮）。
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
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'confirm-dialog-title' : undefined}
      aria-describedby="confirm-dialog-desc"
    >
      {/* 蒙层 */}
      <div
        className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm"
        onClick={() => onCancelRef.current()}
      />
      <div
        className="exp-dialog relative w-full max-w-sm p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {danger && (
            <span
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)]"
            >
              <AlertTriangle size={16} strokeWidth={1.8} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {title && (
              <h2 id="confirm-dialog-title" className="text-sm font-bold text-[var(--foreground)]">
                {title}
              </h2>
            )}
            <p
              id="confirm-dialog-desc"
              className={`text-[13px] leading-relaxed text-[var(--muted-foreground)] ${title ? 'mt-1' : ''}`}
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
            className="neu-btn-soft !h-[38px]"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`neu-btn-primary !h-[38px] ${danger ? 'is-danger' : ''}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
