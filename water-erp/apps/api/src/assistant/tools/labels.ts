/* ============================================================================
   枚举值 → 中文标签映射
   用于工具生成的表格/数据，确保输出纯中文，不出现英文代码。
   ============================================================================ */

export const PROCUREMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_REVIEW: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  BIDDING: '招标中',
  CONTRACTED: '已签约',
  CLOSED: '已关闭',
};

export const STAGE_LABEL: Record<string, string> = {
  DOWNLOAD: '文件下载',
  SUBMIT: '加密投递',
  OPENING: '在线开标',
  EVALUATING: '专家评标',
  ARCHIVED: '资料归档',
};

export const SUPPLIER_STATUS_LABEL: Record<string, string> = {
  PENDING: '待审核',
  RETURNED: '已退回补正',
  APPROVED: '已入库',
  REJECTED: '审核不通过',
  DISABLED: '已停用',
  BLACKLIST: '黑名单',
};

export const ANNOUNCEMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档',
};

export const ANNOUNCEMENT_TYPE_LABEL: Record<string, string> = {
  BID_NOTICE: '采购公告',
  WIN_NOTICE: '中标公示',
  POLICY: '政策法规',
  PLATFORM: '平台通知',
};

/** 通用翻译函数：未命中时回退为原值（避免吞数据）。 */
export function t(
  map: Record<string, string>,
  value: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '-';
  return map[value] ?? value;
}

/** 分布表行类型（含百分比） */
export interface DistRow {
  [key: string]: unknown;
}

/** 构建分布表行：翻译标签 + 降序排列 + 百分比列。
 *  返回新行数组（不修改原始数据），每行在原字段基础上新增 `_pct`。 */
export function buildDistRows(
  raw: Array<Record<string, unknown>>,
  opts: {
    categoryKey: string;
    valueKey: string;
    labelMap: Record<string, string>;
  },
): DistRow[] {
  const rows: DistRow[] = raw.map((r) => {
    const value = Number(r[opts.valueKey]) || 0;
    const rawLabel = String(r[opts.categoryKey] ?? '-');
    return {
      ...r,
      [opts.categoryKey]: t(opts.labelMap, rawLabel),
      _value: value,
      _pct: '',
    };
  });

  // 降序排列
  rows.sort((a, b) => (b._value as number) - (a._value as number));

  // 百分比
  const sum = rows.reduce((s, r) => s + (r._value as number), 0);
  if (sum > 0) {
    for (const r of rows) {
      r._pct = ((r._value as number) / sum * 100).toFixed(1) + '%';
    }
  }

  return rows;
}

