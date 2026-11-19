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
