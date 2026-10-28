/**
 * 本地日历日期/时间取值（2026-10-28 统一收口）。
 *
 * 勿用 `toISOString().slice(0, 10)` 取「今天」/日历日——那是 UTC 日期，东八区
 * 00:00–08:00 之间会早一天；更隐蔽的是与 `getHours()`（本地）混用：专家邀请通知
 * 「开标时间」曾 UTC 日期 + 本地时间各取一半，UTC≥16:00 的开标（本地已是次日）
 * 在通知里整体早一天（extract/page.tsx，2026-10-28 修）。凡 date input 值、
 * 按日分组键、「今天」比较、通知/文案内嵌日期，一律走本文件。
 */

/** 本地日历日期 YYYY-MM-DD（date input 值 / 分组键 / 今天比较） */
export function localDateInputValue(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 本地时间 HH:MM（time input 值；与 localDateInputValue 同源，勿混 UTC） */
export function localTimeInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
