/* ============================================================================
   枚举值 → 中文标签映射
   用于工具生成的表格/数据，确保输出纯中文，不出现英文代码。
   ============================================================================ */

export const PROCUREMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_REVIEW: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  BIDDING: '采购执行中', // 2026-11-03 采购口径：ProcurementProject 状态不称「招标中」
  CONTRACTED: '已签约',
  CLOSED: '已关闭',
};

/** PMI 项目状态（ProjectManagementStatus）——2026-11-04 口径裁定：
 *  「采购项目」以 PMI 为准（非邀请招标、不含回收站） */
export const PMI_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '在办',
  ARCHIVED: '已归档',
  RECYCLED: '回收站',
  TERMINATED: '已终止',
};

export const STAGE_LABEL: Record<string, string> = {
  DOWNLOAD: '文件下载',
  SUBMIT: '加密投递',
  OPENING: '在线开标',
  EVALUATING: '专家评标',
  ARCHIVED: '资料归档',
  ABORTED: '已流标', // 2026-11-03：此前无映射——bid 阶段卡漏出英文原键（用户实录）
};

/** 台账轮次结果状态（ResultStatus）——与 procurements.service getResultStatusLabel 同口径
 *  （2026-11-04 台账工具翻新：枚举标签唯一裸出面是卡片 rows，统一进 labels.ts） */
export const RESULT_STATUS_LABEL: Record<string, string> = {
  AWARDED: '已成交',
  FAILED_REVIEW: '资格审查未通过',
  FILE_REVISION_REQUIRED: '采购文件需修改',
  INVALID_RESPONSE: '未按要求响应',
  PENDING: '待处理',
  CANCELLED: '已取消',
};

/** 通知类型（Notification.type，DB 现值全集）——data 序列化进 LLM 前翻译，
 *  未收录键回退原值（t() 兜底不吞数据） */
/** 合同状态（Contract.status 现值集）——2026-11-04 合同履约工具新增 */
export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  drafting: '起草中',
  internal_review: '内部审查',
  approved_for_signing: '待签约',
  signed: '已签约',
  performing: '履行中',
  accepted: '已验收',
  terminated: '已终止',
};

export const NOTIFICATION_TYPE_LABEL: Record<string, string> = {
  BID_PUBLISHED: '采购公告发布',
  BID_OPENING: '开标提醒',
  BID_OPENING_HANDED_OVER: '开标资料移交',
  BID_CLARIFICATION_CREATED: '澄清答疑通知',
  BID_EVALUATION_RESULT: '评标结果',
  SUPPLIER_APPROVED: '供应商审核通过',
  SUPPLIER_LINK_REJECTED: '公司归属被拒',
  QUALIFICATION_EXPIRING: '资质临期预警',
  EXPERT_ASSIGNED: '专家指派通知',
  EXPERT_SWAP_PROMOTED: '候补专家递补',
  EXPERT_DECLINE_STREAK: '专家连续婉拒预警',
  PROFILE_CHANGE_PENDING: '资料变更待审批',
};

export const SUPPLIER_STATUS_LABEL: Record<string, string> = {
  PENDING: '待审核',
  RETURNED: '已退回补正',
  APPROVED: '已入库',
  REJECTED: '审核不通过',
  DISABLED: '已停用',
  BLACKLIST: '黑名单',
};

export const ANNOUNCEMENT_TYPE_LABEL: Record<string, string> = {
  BID_NOTICE: '采购公告',
  FAILED_BID_NOTICE: '流标公告',
  PRE_WIN_NOTICE: '预成交公示', // 2026-11-03：schema 语义=预成交公示（GB/T 43711 两段式第一段），此前误标「中标公告」与 WIN_BID_NOTICE 撞名
  WIN_BID_NOTICE: '中标公告',
  WIN_NOTICE: '成交公告',
  ADDENDUM: '补遗公告',
  PREQUAL_NOTICE: '资格预审公告',
  CLARIFY_NOTICE: '澄清修改公告', // 2026-11-03：schema 第 12 值漏映射——澄清公告运行时真实在用，t() 回退会漏英文原键
  CONTRACT_NOTICE: '合同公告',
  PERFORMANCE_NOTICE: '履行结果公告',
  POLICY: '政策法规',
  PLATFORM: '平台通知',
};

/** 反查：中文标签/简写 → 枚举键（LLM 常传「待处理」「在办」等中文进 enum where，
 *  裸传即 Prisma 校验异常整工具失败——2026-11-04 公告类型实录）。未知返回 undefined */
export function keyOfLabel(map: Record<string, string>, input: string): string | undefined {
  if (input in map) return input;
  const exact = Object.entries(map).find(([, label]) => label === input);
  if (exact) return exact[0];
  const partial = Object.entries(map).find(([, label]) => label.includes(input) || input.includes(label));
  return partial?.[0];
}

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
