/**
 * 公告型（公开报名）采购方式的供应商参与口径（2026-11-26 用户裁定）：
 * 适用方式 = 公开招标 / 询比采购 / 竞价采购——供应商组织走公告公示，门户自行响应
 * （拟参与 → 投递）；与 supplier-portal 的邀请域方式（邀请招标/直接采购，见
 * INVITATION_SCOPED_METHODS）互补，谈判采购走「供应商邀请+回执」模型亦不在其列。
 *
 * 口径：项目管理「供应商参与」与开标确认「供应商投标状态」只计入点击了「拟参与」的
 * 供应商（仅下载采购文件/登记在册未响应的不显示不计数）；确认开标或到达开标时间后
 * 进一步收窄为「已投递标书」。两处视图恒一致。
 * 实现为读侧计算（不改写名册/意向原始记录，可溯源），开标时点判 stage 优先、时间兜底。
 */

export const PUBLIC_ENROLL_METHODS = new Set(['公开招标', '询比采购', '竞价采购']);

export function isPublicEnrollMethod(method?: string | null): boolean {
  return !!method && PUBLIC_ENROLL_METHODS.has(method);
}

/** 是否已过开标时点：已确认开标（stage∈OPENING/EVALUATING/ARCHIVED）或 now ≥ 开标时间 */
export function isOpeningPassed(opts: { stage?: string | null; openTime?: string | null; now?: number }): boolean {
  const { stage, openTime, now = Date.now() } = opts;
  if (stage === 'OPENING' || stage === 'EVALUATING' || stage === 'ARCHIVED') return true;
  if (!openTime) return false;
  const t = new Date(openTime).getTime();
  return Number.isFinite(t) && now >= t;
}

/**
 * 公告型行筛选：开标前 = 已确认拟参与（含已投递）；开标后 = 已投递标书
 * （撤回/未投递不算）。行结构对 workspace 供应商行与公告参与行双兼容
 * （两处字段同名：intentConfirmedAt / submitted）。
 */
export function filterPublicEnrollRows<T extends { intentConfirmedAt?: string | null; submitted: boolean }>(
  rows: T[],
  opened: boolean,
): T[] {
  return rows.filter((r) => (opened ? r.submitted : !!r.intentConfirmedAt));
}
