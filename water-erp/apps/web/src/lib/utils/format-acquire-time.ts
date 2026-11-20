/**
 * 时间文本展示与选择器互转工具。
 *
 * 「采购文件获取时间（documentAcquireTime）」字段已退役（2026-11-20 用户裁定）——
 * fmtAcquireTime / zhRangeToDatetimeLocal 随之下线；现存导出服务：
 *   - fmtAcquireRangeISO：时间轴区间节点的固定中文格式（现无在用区间节点，结构保留）
 *   - zhToDatetimeLocal / datetimeLocalToZh：开标时间等 datetime-local ↔ 中文存库互转
 */

/** ISO 起止（时间轴接口的 time/timeEnd）→ 固定中文格式；同日仍显完整两段，保持全局一致。
 *  双端均为零点（纯日期区间，无时分语义）时省略时分，避免「10月10日0:00-10月14日0:00」噪音。 */
export function fmtAcquireRangeISO(time: string, timeEnd: string): string {
  const parse = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return { date: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`, hasTime: d.getHours() !== 0 || d.getMinutes() !== 0, hm: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` };
  };
  const s = parse(time);
  const e = parse(timeEnd);
  if (!s) return e ? e.date : '';
  if (!e) return s.date;
  if (!s.hasTime && !e.hasTime) return `${s.date}-${e.date}`;
  return `${s.date}${s.hm}-${e.date}${e.hm}`;
}

/* ── 时间点选择器（datetime-local）与中文存库格式的互转 ──
 * 项目基本信息「开标时间」为选择器录入：
 * 存库仍用中文文本（与 AI 归一化同口径「2026年10月20日14:00」，月/日/时不补零、分补零），
 * 选择器态用 datetime-local 值（YYYY-MM-DDTHH:MM）。 */

/** 中文日期(可带时分)匹配：兼容纯日期与带时分单点 */
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

/** datetime-local → 中文「2026年10月20日14:00」（与 AI 归一化同口径） */
export function datetimeLocalToZh(dl: string | null | undefined): string | null {
  if (!dl) return null;
  const m = dl.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日${Number(m[4])}:${m[5]}`;
}
