import type { ComponentType, ReactNode } from "react";

/** 移动端区块卡——cgzxui 玻璃静态卡 + 标题行（图标 + 标题 + 右侧元信息） */
export function SectionCard({
  icon: Icon,
  title,
  right,
  children,
}: {
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="neu-card-static mb-3 rounded-[18px] p-3.5">
      <div className="mb-3 flex items-center gap-2">
        {Icon ? <Icon size={15} className="shrink-0 text-[var(--accent)]" /> : null}
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold tracking-[-0.02em] text-[var(--foreground)]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
