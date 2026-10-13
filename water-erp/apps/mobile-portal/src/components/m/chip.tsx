import type { ReactNode } from "react";

/** 筛选 chip（.m-chip 触摸友好样式，data-active 高亮） */
export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} data-active={active ? "true" : "false"} className="m-chip">
      {children}
    </button>
  );
}
