import type { ReactNode } from "react";

/** 筛选 chip（.m-chip 触摸友好样式，data-active 高亮；disabled 灰化不可点——分页钮等用） */
export function Chip({
  active,
  onClick,
  disabled,
  className,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-active={active ? "true" : "false"}
      className={className ? `m-chip ${className}` : "m-chip"}
    >
      {children}
    </button>
  );
}
