"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
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
        className="relative z-10 flex w-full flex-col gap-5 rounded-[20px] p-6"
        style={{
          maxWidth: "420px",
          background:
            "linear-gradient(105deg, oklch(1 0 0 / 0.94) 0%, oklch(0.99 0.003 258 / 0.62) 35%, oklch(1 0 0 / 0.4) 70%)",
          boxShadow:
            "inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 5px oklch(0.55 0.03 258 / 0.1), -1px -1px 4px oklch(1 0 0 / 0.9)",
        }}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Danger icon well */}
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
              style={{
                background:
                  "color-mix(in oklch, var(--danger) 12%, oklch(0.99 0.004 258))",
                boxShadow:
                  "inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.7)",
              }}
            >
              <AlertCircle
                size={18}
                strokeWidth={1.8}
                style={{ color: "var(--danger)" }}
              />
            </div>
            <h2 className="text-base font-bold tracking-[-0.02em] text-[var(--foreground)]">
              登录失败
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
