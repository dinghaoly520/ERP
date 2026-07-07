'use client';

// ── 字段卡片（关键信息用）──

export function FieldCard({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number | null | undefined;
  suffix?: string;
}) {
  return (
    <div className="glass-card glass-card-lighter rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[var(--color-text-tertiary)]">{icon}</span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{label}</span>
      </div>
      <div className="font-semibold text-sm text-[var(--color-text)]">
        {value != null ? String(value) + (suffix ?? '') : '—'}
      </div>
    </div>
  );
}
