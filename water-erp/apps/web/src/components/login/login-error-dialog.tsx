"use client";

import { AlertCircle, X } from "lucide-react";

type LoginErrorDialogProps = {
  isOpen: boolean;
  message: string;
  onClose: () => void;
};

export function LoginErrorDialog({
  isOpen,
  message,
  onClose,
}: LoginErrorDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="password-dialog-overlay fixed inset-0 z-[95] flex items-center justify-center px-4 py-6"
      role="presentation"
    >
      <div
        className="password-dialog panel-surface chromatic-glass glass-calm relative w-full max-w-[460px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-error-dialog-title"
      >
        <div aria-hidden className="password-dialog__glow" />
        <button
          type="button"
          onClick={onClose}
          className="password-dialog__close"
          aria-label="关闭登录失败弹窗"
        >
          <X size={18} />
        </button>

        <div className="password-dialog__header">
          <h2
            id="login-error-dialog-title"
            className="password-dialog__title font-[family-name:var(--font-display)]"
          >
            登录失败
          </h2>
          <div className="password-dialog__divider" />
        </div>

        <div className="password-dialog__form">
          <div className="password-dialog__status password-dialog__status--error rounded-[20px]">
            <AlertCircle
              size={18}
              strokeWidth={1.95}
              className="mt-[1px] shrink-0"
            />
            <div className="text-sm leading-7">{message}</div>
          </div>

          <div className="password-dialog__actions">
            <button
              type="button"
              onClick={onClose}
              className="password-dialog__button password-dialog__button--primary"
            >
              我知道了
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
