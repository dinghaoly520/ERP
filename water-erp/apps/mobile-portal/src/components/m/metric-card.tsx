const TONE_COLOR: Record<string, string> = {
  default: "var(--foreground)",
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

/** 移动端指标卡——标签 + 大数字（等宽数字）+ 可选副注 */
export function MetricCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: keyof typeof TONE_COLOR;
}) {
  return (
    <div className="m-tile rounded-[14px] px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</div>
      <div className="mt-1 text-[19px] font-black leading-none tabular-nums tracking-[-0.02em]" style={{ color: TONE_COLOR[tone] }}>
        {value}
      </div>
      {sub ? <div className="mt-1 truncate text-[11px] text-[var(--muted-foreground)]">{sub}</div> : null}
    </div>
  );
}
