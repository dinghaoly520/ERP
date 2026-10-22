const TONE_COLOR: Record<string, string> = {
  default: "var(--foreground)",
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

/** 移动端指标卡——标签 + 大数字（等宽数字）+ 可选环比箭头 + 可选副注 */
export function MetricCard({
  label,
  value,
  sub,
  tone = "default",
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: keyof typeof TONE_COLOR;
  delta?: { pct: number; tone: "good" | "bad" | "neutral" };
}) {
  return (
    <div className="m-tile rounded-[14px] px-3 py-2.5">
      <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-1.5">
        <div className="text-[21px] font-black leading-none tabular-nums tracking-[-0.02em]" style={{ color: TONE_COLOR[tone] }}>
          {value}
        </div>
        {delta ? (
          <span
            className={`shrink-0 text-[12px] font-bold tabular-nums ${
              delta.tone === "good" ? "text-[var(--success)]" : delta.tone === "bad" ? "text-[var(--danger)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            {delta.pct > 0 ? "↑" : delta.pct < 0 ? "↓" : "—"}
            {Math.abs(delta.pct)}%
          </span>
        ) : null}
      </div>
      {sub ? <div className="mt-1 truncate text-[13px] text-[var(--muted-foreground)]">{sub}</div> : null}
    </div>
  );
}
