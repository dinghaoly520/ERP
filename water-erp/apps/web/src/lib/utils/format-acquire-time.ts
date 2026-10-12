/**
 * 采购文件获取时间（documentAcquireTime）展示格式归一化。
 *
 * 数据来源多样（AI 提取 / 手工录入 / 模板），存量存在两种写法：
 *   2026年03月20日09:00至2026年03月25日15:00（补零 + 「至」）
 *   2026年9月7日9:00-2026年9月8日15:00（不补零 + 「-」）
 * 用户拍板的固定展示格式为后者：月/日/时不补零、起止用「-」分隔。
 */

/** 中文时间点匹配：2026年03月20日09:00 / 2026年9月7日9:00 等（兼容空格） */
const ZH_TIME_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/g;

/** 归一化中文文本：解析出完整起止区间则重排为「2026年9月7日9:00-2026年9月8日15:00」；否则原样返回 */
export function fmtAcquireTime(v: string | null | undefined): string | null {
  if (!v) return null;
  const parts = [...v.matchAll(ZH_TIME_RE)];
  if (parts.length < 2) return v;
  const fmt = (m: RegExpMatchArray) =>
    `${m[1]}年${Number(m[2])}月${Number(m[3])}日${Number(m[4])}:${m[5]}`;
  return `${fmt(parts[0])}-${fmt(parts[1])}`;
}

/** ISO 起止（时间轴接口的 time/timeEnd）→ 固定中文格式；同日仍显完整两段，保持全局一致 */
export function fmtAcquireRangeISO(time: string, timeEnd: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const s = fmt(time);
  const e = fmt(timeEnd);
  if (!s || !e) return `${s || e}`;
  return `${s}-${e}`;
}

/* ── 时间点选择器（datetime-local）与中文存库格式的互转 ──
 * 项目基本信息「开标时间/采购文件获取时间」改为选择器录入：
 * 存库仍用中文文本（与 AI 归一化同口径「2026年10月20日14:00」，月/日/时不补零、分补零），
 * 选择器态用 datetime-local 值（YYYY-MM-DDTHH:MM）。 */

/** 中文日期(可带时分)匹配：兼容纯日期区间（2026年10月10日-2026年10月14日）与带时分单点/区间 */
const ZH_DATETIME_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/g;

const pad2 = (n: number | string) => String(n).padStart(2, '0');

const zhMatchToDatetimeLocal = (m: RegExpMatchArray): string =>
  `${m[1]}-${pad2(m[2])}-${pad2(m[3])}T${pad2(m[4] ?? 0)}:${m[5] ?? '00'}`;

/** 中文时间文本 → datetime-local 值；取首个匹配（无时分按 00:00），无可解析段返回 null */
export function zhToDatetimeLocal(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = [...v.matchAll(ZH_DATETIME_RE)][0];
  return m ? zhMatchToDatetimeLocal(m) : null;
}

/** 区间文本 → 起止 datetime-local：首段=起、末段=止；仅一段（单点）时止为 null */
export function zhRangeToDatetimeLocal(v: string | null | undefined): { start: string | null; end: string | null } {
  if (!v) return { start: null, end: null };
  const parts = [...v.matchAll(ZH_DATETIME_RE)].map(zhMatchToDatetimeLocal);
  if (parts.length === 0) return { start: null, end: null };
  return { start: parts[0], end: parts.length > 1 ? parts[parts.length - 1] : null };
}

/** datetime-local → 中文「2026年10月20日14:00」（与 AI 归一化同口径） */
export function datetimeLocalToZh(dl: string | null | undefined): string | null {
  if (!dl) return null;
  const m = dl.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日${Number(m[4])}:${m[5]}`;
}
