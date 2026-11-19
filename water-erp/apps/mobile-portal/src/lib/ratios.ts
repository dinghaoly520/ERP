/* 涨跌比（驾驶舱/台账总览共用，2026-11-19）：同比=整窗前移一年、环比=紧邻等长前窗；
 * 涨=红 跌=绿（用户裁定方向色统一）；无数据显 - */

export type DeltaR = { pct: number; tone: "good" | "bad" | "neutral" };

/** cur/prev 缺位或基数为 0 → undefined（调用方显 -） */
export function deltaOf(cur: number | undefined, prev: number | undefined, goodWhenUp: boolean | null): DeltaR | undefined {
  if (cur == null || prev == null || prev === 0) return undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return { pct: 0, tone: "neutral" };
  const up = pct > 0;
  const tone = goodWhenUp == null ? "neutral" : up === goodWhenUp ? "good" : "bad";
  return { pct: Math.max(Math.min(pct, 999), -99), tone };
}

export function ratioTxt(d?: DeltaR): string {
  return d ? `${d.pct > 0 ? "↑" : d.pct < 0 ? "↓" : ""}${Math.abs(d.pct)}%` : "-";
}

/** 涨红跌绿（2026-11-19 用户裁定，替换好坏语义着色） */
export function ratioCls(d?: DeltaR): string {
  if (!d) return "text-[var(--muted-foreground)]";
  return d.pct > 0 ? "text-[var(--danger)]" : d.pct < 0 ? "text-[var(--success)]" : "text-[var(--muted-foreground)]";
}
