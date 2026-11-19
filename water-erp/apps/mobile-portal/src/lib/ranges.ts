/* 数据口径区间档（2026-11-19 驾驶舱/台账共用）：默认全部；「全部」=不限时段；
 * 「自定义」=用户起止日期（调用方自持状态）。 */
export type PresetKey = "day" | "month" | "quarter" | "year" | "all";
export type RangeKey = PresetKey | "custom";

export const RANGES: Record<PresetKey, { label: string; start: () => string | undefined }> = {
  day: {
    label: "本日",
    start: () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
  },
  month: {
    label: "本月",
    start: () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    },
  },
  quarter: {
    label: "本季",
    start: () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(Math.floor(d.getMonth() / 3) * 3 + 1).padStart(2, "0")}-01`;
    },
  },
  year: { label: "本年", start: () => `${new Date().getFullYear()}-01-01` },
  all: { label: "全部", start: () => undefined },
};

/** ISO 日期整移一年（02-29 闰年回夹平年 02-28）——同比窗计算 */
export function shiftYearIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  let t = new Date(Date.UTC(y - 1, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t = new Date(Date.UTC(y - 1, m, 0)); // 溢出=平年二月，取月末
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** 今天 ISO（本地时区）——开区间的窗终点兜底 */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 环比邻窗：紧邻等长前移（与后端 priorWindow 同语义）——[起始-L 天, 起始前一日]，
 *  L=双边界天数或「起始..今天」；无起始（全部档）无邻窗返回 null */
export function priorWindowIso(
  startDate?: string,
  endDate?: string,
  now: Date = new Date(),
): { startDate: string; endDate: string } | null {
  if (!startDate) return null;
  const DAY = 24 * 3600 * 1000;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  let spanDays: number;
  if (endDate) {
    const end = new Date(`${endDate}T00:00:00.000Z`);
    spanDays = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  } else {
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    spanDays = Math.round((today.getTime() - start.getTime()) / DAY) + 1;
  }
  const prevEnd = new Date(start.getTime() - DAY);
  const prevStart = new Date(prevEnd.getTime() - (spanDays - 1) * DAY);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(prevStart), endDate: iso(prevEnd) };
}
