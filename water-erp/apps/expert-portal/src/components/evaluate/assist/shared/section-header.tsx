'use client';

// ── 实心编号圆（cgzxui accent-strong）──

export function SectionNumber({ n }: { n: number }) {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" className="shrink-0">
      <circle cx={9} cy={9} r={9} fill="var(--accent-strong)" />
      <text
        x={9}
        y={12}
        textAnchor="middle"
        fill="#fff"
        fontSize={10}
        fontWeight={700}
        fontFamily="system-ui, sans-serif"
      >
        {n}
      </text>
    </svg>
  );
}

export function SectionHeader({ number, title, subtitle }: { number: number; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5 pb-1 pt-2">
      <SectionNumber n={number} />
      <h3 className="text-sm font-bold text-[var(--foreground)]">{title}</h3>
      {subtitle && <span className="text-[11px] text-[var(--muted-foreground)]">{subtitle}</span>}
      <span className="wb-section-rule ml-2 flex-1" />
    </div>
  );
}
