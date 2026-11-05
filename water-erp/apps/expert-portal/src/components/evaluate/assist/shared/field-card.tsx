'use client';

// ── 字段卡片（关键信息用，cgzxui kpi 瓷片）──

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
    <div className="kpi-card !rounded-[12px] p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[var(--muted-foreground)]">{icon}</span>
        <span className="text-[11px] text-[var(--muted-foreground)]">{label}</span>
      </div>
      <div className="text-sm font-semibold text-[var(--foreground)]">
        {/* 空串与 null/undefined 同兜底（PII 无源恢复的行为 ''，空白格会被误读为缺渲染） */}
        {value != null && value !== '' ? String(value) + (suffix ?? '') : '—'}
      </div>
    </div>
  );
}
