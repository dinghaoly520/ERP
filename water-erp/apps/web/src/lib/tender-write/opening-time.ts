/**
 * 开标时间稳健获取（2026-10-28）：向导「开标时间」字段的统一预填核心。
 * 零依赖纯函数（localStorage/tender-type 相关的薄壳在调用侧）。
 *
 * 背景：此前公告草稿的 bidOpeningTime 没有任何预填链路——
 * ANNOUNCEMENT_AUTO_FILL 无此键、buildPrefillFromProject 四类均不输出、
 * 增强预填只覆盖直接采购 procurementTime/中标公告分支，且字段是
 * datetime-local（2026-10-21 口径仅时间选择），中文原文不归一即被浏览器静默丢弃。
 */

/** 中文日期 "2026年8月1日" → YYYY-MM-DD；已是数字格式则原样返回 */
export function toDateInputValue(text: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  return '';
}

/** 中文日期时间 "2026年3月26日15:00" / "2026年10月20日14时00分00秒" → YYYY-MM-DDTHH:MM（datetime-local）；
 *  仅日期 → 补 T00:00（datetime-local 只吃完整格式，半截值会被浏览器丢弃）；
 *  解析不出日期 → ''（宁缺勿错）。已是完整格式则原样返回（带秒/毫秒截断到分钟）。 */
export function toDatetimeLocalValue(text: string): string {
  const s = (text ?? '').trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (iso) return iso[1];
  const m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:时]\s*(\d{2})\s*分?/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}`;
  }
  const dateOnly = toDateInputValue(s);
  if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return `${dateOnly}T00:00`;
  return '';
}

/**
 * 开标时间来源链归一（只补空，2026-10-29 加固）：current 仅当本身归一为合法
 * datetime-local 才视为「用户已填」原样保留——此前非空即返回，历史 bug 期间被
 * docx 中文原文覆盖的值存进向导缓存后永远无法自愈（datetime-local 静默丢弃，
 * 「每次进入公告编写页面都引不进开标时间」实录）。非法 current 视作空，
 * 从 采购文件草稿 → 项目基本信息 链重取，缓存随之自愈。
 */
export function openingTimeFromSources(
  current: string | undefined,
  projectBidOpeningTime: string | null | undefined,
  tenderDraftOpeningValue: string | null | undefined,
): string {
  const cur = toDatetimeLocalValue(current ?? '');
  if (cur) return cur;
  return toDatetimeLocalValue(tenderDraftOpeningValue ?? '') || toDatetimeLocalValue(projectBidOpeningTime ?? '');
}
