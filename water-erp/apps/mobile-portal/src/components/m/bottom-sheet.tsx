"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/** 移动端底部弹层——桌面端 Modal 下钻的手机形态（把手 + 遮罩 + 安全区） */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[rgba(20,35,60,0.38)] backdrop-blur-[2px]" onClick={onClose} />
      <div className="m-sheet-panel">
        <div aria-hidden className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_28%,transparent)]" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 text-[15px] font-bold leading-snug tracking-[-0.02em] text-[var(--foreground)]">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-[var(--border)] bg-white/70 text-[var(--muted-foreground)] active:scale-95"
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
