'use client';

// ── 实心编号圆 ──

export function SectionNumber({ n }: { n: number }) {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" className="shrink-0">
      <circle cx={9} cy={9} r={9} fill="var(--color-primary)" />
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
    <div className="flex items-center gap-2.5 pt-2 pb-1">
      <SectionNumber n={number} />
      <h3 className="font-bold text-sm text-[var(--color-text)]">{title}</h3>
      {subtitle && <span className="text-[11px] text-[var(--color-text-tertiary)]">{subtitle}</span>}
      <span className="flex-1 h-px bg-[oklch(0.91_0.006_264)] ml-2" />
    </div>
  );
}
