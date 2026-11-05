"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * 移动端底部弹层：m-sheet 入场/退场动画 + 280ms 兜底定时器（reduced-motion 无动画事件也能卸载）。
 * Portal 到 document.body：iOS WebKit 把 fixed 约束在滚动祖先层叠上下文内（Chromium 按规范脱离）——
 * 不 Portal 会被 in-flow Tab 栏盖住按钮；Portal 脱离页面祖先，两端行为一致。
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
  /* 幽灵点击防护（2026-10-26「一闪就消失」实录）：移动 WebKit 的 click 按派发时刻
   * 重新命中测试——pointerup 开层后手指处已被蒙层覆盖，同一次点按的 click 命中蒙层
   * 立即触发关闭。开层后 320ms 内的蒙层点击一律忽略（用户刚开层不会立刻想关）。 */
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (open) {
      setClosing(false);
      openedAtRef.current = Date.now();
    }
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
      <div
        className="absolute inset-0 bg-[color-mix(in_oklch,var(--background)_62%,transparent)] backdrop-blur-[2px]"
        onClick={() => {
          if (Date.now() - openedAtRef.current < 320) return; // 开层同拍的幽灵点击
          setClosing(true);
        }}
      />
      <div className="m-sheet-panel" data-closing={closing ? "true" : "false"} onAnimationEnd={handleAnimationEnd}>
        <div aria-hidden className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_28%,transparent)]" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 text-[18px] font-bold leading-snug tracking-[-0.02em] text-[var(--foreground)]">{title}</div>
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
