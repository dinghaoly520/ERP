/**
 * 公告类型共享常量 —— 三端（:3005 管理 / :3002 门户 / :3020 供应商）与 API 的单一来源。
 * GB/T 43711—2024 7.5.2：预成交公示期满无异议 → 发布成交公告（两段式）。
 * 注意：历史 WIN_NOTICE 数据语义按"成交公告"展示，不再称"中标公示"。
 */
export const ANNOUNCEMENT_TYPE_LABELS = {
  BID_NOTICE: '采购公告',
  ADDENDUM: '补遗公告',
  PREQUAL_NOTICE: '资格预审公告',
  PRE_WIN_NOTICE: '预成交公示',
  WIN_NOTICE: '成交公告',
  CONTRACT_NOTICE: '合同公告',
  PERFORMANCE_NOTICE: '履行结果公告',
  POLICY: '政策法规',
  PLATFORM: '平台通知',
  FAILED_BID_NOTICE: '流标公告',
  WIN_BID_NOTICE: '中标公告',
} as const;

export type AnnouncementTypeValue = keyof typeof ANNOUNCEMENT_TYPE_LABELS;

/** 公告类型的规范展示顺序（列表筛选页签 / 新建类型选择 / 类型下拉统一按此排序）：
 *  采购公告 → 流标公告 → 中标公告（采购公告的三种系统生成走向）→ 流程过程类 → 平台类 */
export const ANNOUNCEMENT_TYPE_ORDER: AnnouncementTypeValue[] = [
  'BID_NOTICE',
  'FAILED_BID_NOTICE',
  'WIN_BID_NOTICE',
  'ADDENDUM',
  'PREQUAL_NOTICE',
  'PRE_WIN_NOTICE',
  'WIN_NOTICE',
  'CONTRACT_NOTICE',
  'PERFORMANCE_NOTICE',
  'POLICY',
  'PLATFORM',
];

/** 类型分组（与 ORDER 对应，组间在 UI 上加隔断符区分）：
 *  ① 采购走向（系统生成） ② 采购流程过程公告 ③ 平台信息 */
export const ANNOUNCEMENT_TYPE_GROUPS: AnnouncementTypeValue[][] = [
  ['BID_NOTICE', 'FAILED_BID_NOTICE', 'WIN_BID_NOTICE'],
  ['ADDENDUM', 'PREQUAL_NOTICE', 'PRE_WIN_NOTICE', 'WIN_NOTICE', 'CONTRACT_NOTICE', 'PERFORMANCE_NOTICE'],
  ['POLICY', 'PLATFORM'],
];

export function announcementTypeGroupIndex(type: string): number {
  return ANNOUNCEMENT_TYPE_GROUPS.findIndex((g) => g.includes(type as AnnouncementTypeValue));
}

/**
 * 直接采购类方式集合（GB/T 43711 6.2.5 + 本系统 KNOWN_METHODS）。
 * 此类方式发布公告须公布"选择直接采购交易方式的理由及拟邀请供应商"（7.2.2.3）。
 */
export const DIRECT_PROCUREMENT_METHODS = [
  '直接采购',
  '单一来源',
  '单一来源采购',
  '直接委托续约采购',
  '直接签订合同',
] as const;

export function isDirectProcurementMethod(method?: string | null): boolean {
  if (!method) return false;
  return (DIRECT_PROCUREMENT_METHODS as readonly string[]).includes(method.trim());
}
