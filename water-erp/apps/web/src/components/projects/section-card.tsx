'use client';

import type { ReactNode } from 'react';

/** 开标确认面板同款区块卡（2026-09-24 从 bid-confirm-panel.tsx 抽出共用——评分标准卡迁移） */
export function SectionCard({
  icon, title, accent, accentSoft, action, children,
}: {
  icon: ReactNode;
  title: string;
  accent: string;
  accentSoft: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="wb-icon-well wb-icon-well--xs"
            style={{ '--well-bg': accentSoft, '--well-fg': accent } as React.CSSProperties}
          >
            {icon}
          </div>
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
