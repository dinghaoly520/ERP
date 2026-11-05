"use client";

import { createPortal } from "react-dom";

/** 与 use-pull-to-refresh 共用的触发阈值（拖距 ≥64px 判定刷新） */
const TRIGGER_PX = 64;

/**
 * 下拉刷新指示器——固定在顶栏下缘居中，随拖距渐显；顶栏高度随纤薄化调整（h-11 = 2.75rem）。
 * Portal 到 document.body：iOS WebKit 把页内 fixed 约束在滚动祖先上下文（同 BottomSheet 的坑），
 * Portal 后两端均恒锚定视口。
 */
export function PullIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  if (!pull && !refreshing) return null;
  const progress = Math.min(pull / TRIGGER_PX, 1);
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed left-1/2 z-40 -translate-x-1/2"
      style={{
        top: `calc(2.75rem + ${(refreshing ? 8 : Math.max(Math.min(pull, TRIGGER_PX) - 4, 0)).toFixed(0)}px)`,
        opacity: refreshing ? 1 : progress,
      }}
    >
      <div
        className={`h-7 w-7 rounded-full border-2 border-[color-mix(in_oklch,var(--accent)_25%,transparent)] border-t-[var(--accent)] ${refreshing ? "animate-spin" : ""}`}
        style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
      />
    </div>,
    document.body,
  );
}
