"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, X } from "lucide-react";

type LoginErrorDialogProps = {
  isOpen: boolean;
  message: string;
  onClose: () => void;
  /** 弹窗标题：登录页默认「登录失败」；复用于其他场景（如项目详情操作报错）时应传场景化标题 */
  title?: string;
};

export function LoginErrorDialog({
  isOpen,
  message,
  onClose,
  title = '登录失败',
}: LoginErrorDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // trap focus & Esc to close
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onKeyDown]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    // ── Backdrop ──
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ── Dialog surface — cgzxui neumorphic ── */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="neu-dialog relative z-10 flex w-full max-w-[420px] flex-col gap-5"
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Danger icon well */}
            <div
              className="neu-icon-well flex h-9 w-9 shrink-0 items-center justify-center bg-[color-mix(in_oklch,var(--danger)_12%,oklch(0.99_0.004_258))]"
            >
              <AlertCircle
                size={18}
                strokeWidth={1.8}
                className="text-[var(--danger)]"
              />
            </div>
            <h2 className="text-base font-bold tracking-[-0.02em] text-[color:var(--foreground)]">
              {title}
            </h2>
          </div>
          <button onClick={onClose} className="neu-btn-xs" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* ── Message — plain text, no recessed card ── */}
        <p className="text-sm leading-6 text-[var(--foreground)]">
          {message}
        </p>

        {/* ── Divider + Footer ── */}
        <hr className="wb-section-rule" />
        <div className="flex justify-end">
          <button onClick={onClose} className="neu-btn-soft">
            我知道了
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
