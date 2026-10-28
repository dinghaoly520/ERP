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
 *  解析不出日期 → ''（宁缺勿错）。已是完整格式则原样返回。 */
export function toDatetimeLocalValue(text: string): string {
  const s = (text ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
  const m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:时]\s*(\d{2})\s*分?/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}`;
  }
  const dateOnly = toDateInputValue(s);
  if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return `${dateOnly}T00:00`;
  return '';
}

/**
 * 开标时间来源链归一（只补空）：current 已有值原样返回（用户已填优先）；
 * 否则 采购文件草稿值 → 项目基本信息值，取先归一成功者，均为 datetime-local 格式或 ''。
 */
export function openingTimeFromSources(
  current: string | undefined,
  projectBidOpeningTime: string | null | undefined,
  tenderDraftOpeningValue: string | null | undefined,
): string {
  const cur = (current ?? '').trim();
  if (cur) return cur;
  return toDatetimeLocalValue(tenderDraftOpeningValue ?? '') || toDatetimeLocalValue(projectBidOpeningTime ?? '');
}
