"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * 移动端底部弹层——入场 m-sheet-up / 退场 m-sheet-down（240ms 后卸载；
 * 280ms 兜底定时器保证 reduced-motion 无动画事件时也能卸载）。
 *
 * Portal 到 document.body：弹层原渲染在滚动容器（main, overflow-y-auto）内部，
 * iOS WebKit 会把 fixed 元素约束在祖先层叠上下文内（inset:0 不再锚定整屏，
 * 被 in-flow Tab 栏盖住确定按钮）；Chromium 按规范脱离祖先所以表现正常。
 * Portal 脱离一切页面祖先，两端行为一致。
 */
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
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) setClosing(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClosing(true);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* 退场兜底：动画事件不可靠（reduced-motion 下不触发）时定时卸载 */
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, 280);
    return () => window.clearTimeout(t);
  }, [closing, onClose]);

  function handleAnimationEnd(e: React.AnimationEvent) {
    if (!closing) return;
    if (e.animationName === "m-sheet-down") {
      setClosing(false);
      onClose();
    }
  }

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[color-mix(in_oklch,var(--background)_62%,transparent)] backdrop-blur-[2px]" onClick={() => setClosing(true)} />
      <div className="m-sheet-panel" data-closing={closing ? "true" : "false"} onAnimationEnd={handleAnimationEnd}>
        <div aria-hidden className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_28%,transparent)]" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 text-[17px] font-bold leading-snug tracking-[-0.02em] text-[var(--foreground)]">{title}</div>
          <button
            type="button"
            onClick={() => setClosing(true)}
            aria-label="关闭"
            className="neu-btn-soft h-9 w-9 shrink-0 rounded-[11px] p-0 active:scale-95"
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
