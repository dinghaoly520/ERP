// packages/shared/src/format-bid.ts
/**
 * 投标报价/金额展示统一格式化（2026-09-08 UI 审计 P0-1/P1-1）。
 * 数据现实：bidPrice/amount 字段为自由文本——「1150万元」「1260.5」「1,485,000」并存，
 * 各端自行 Number() 必产 NaN。这里统一：能解析→元为单位的千分位；不能→原文直出（宁原样不出错）。
 */
const WAN_RE = /^\s*([\d,]+(?:\.\d+)?)\s*万元?\s*$/;
const BARE_NUM_RE = /^[\d,]+(?:\.\d+)?$/;

/** parseAmountToYuan 选项。unitHint：数据源声明的金额单位（dual-v2 唱标/投递口径为「万元」）——
 *  裸数字按该单位换算为元；文本自带单位（如「1150万元」）时文本优先（同源不冲突）。 */
export interface ParseAmountOpts {
  unitHint?: string | null;
}

export function parseAmountToYuan(raw: string | number | null | undefined, opts?: ParseAmountOpts): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = raw.trim();
  if (!s) return null;
  const wan = s.match(WAN_RE);
  if (wan) {
    const n = Number(wan[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n * 10_000 : null;
  }
  if (BARE_NUM_RE.test(s)) {
    const n = Number(s.replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    // dual-v2 投递/唱标以万元入库（投标表单口径），裸数字按 unitHint 声明的单位换算——
    // 无提示时维持旧语义（裸数字=元），向后兼容。
    return opts?.unitHint === '万元' ? n * 10_000 : n;
  }
  return null;
}

export function formatBidPrice(
  raw: string | number | null | undefined,
  opts?: { prefix?: string },
): string {
  const prefix = opts?.prefix ?? '¥';
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return '—';
  const yuan = parseAmountToYuan(raw);
  if (yuan == null) return typeof raw === 'string' ? raw.trim() : String(raw);
  // 整数不带小数尾零；小数保留原精度（去尾零）
  const formatted = Number.isInteger(yuan)
    ? yuan.toLocaleString('zh-CN')
    : yuan.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  return `${prefix}${formatted}`;
}
