/**
 * 供应商审计动作 → 中文标签（2026-11-25 英文泄漏收口：总览「近期动态」裸出
 * SUPPLIER_REVIEW_PASSED_LEADER/STAFF 枚举实录）。
 *
 * 词表与后端写入面穷举对齐（resourceType='supplier' 的 AuditLog 全集——近期动态/
 * 操作历史两个消费面同源）：
 * - supplier.service audit()：注册审批三态 + 分级通过（REVIEW_PASSED_${stage} 模板，
 *   STAFF=初审/LEADER=复审；ADMIN 终审走 SUPPLIER_APPROVED）、状态处置（停用/拉黑/
 *   解除拉黑/恢复/重新激活）、变更审批、转正、履约评价、业务标签；
 * - assistant supplier.tool：水叮当明文查看联系人（动作本身即中文）。
 * supplier-link 的 SUPPLIER_LINK_* 走 resourceType='supplier_company_link'，不入本表。
 * 新增审计动作须同步本表——未收录动作由 supplierActionLabel 兜底为「供应商动态」，
 * 任何情况下不裸出英文枚举。
 */
export const SUPPLIER_ACTION_LABELS: Record<string, string> = {
  SUPPLIER_APPROVED: '审核通过',
  SUPPLIER_REVIEW_PASSED_STAFF: '初审通过',
  SUPPLIER_REVIEW_PASSED_LEADER: '复审通过',
  SUPPLIER_REJECTED: '审核不通过',
  SUPPLIER_RETURNED: '退回补正',
  SUPPLIER_DISABLED: '停用',
  SUPPLIER_BLACKLIST: '拉黑',
  SUPPLIER_UNBLACKLIST: '解除拉黑',
  SUPPLIER_RESTORED: '恢复正常',
  SUPPLIER_RESUBMITTED: '重新提交',
  SUPPLIER_REACTIVATED: '重新激活',
  SUPPLIER_CHANGE_APPROVED: '变更审批通过',
  SUPPLIER_CHANGE_REJECTED: '变更驳回',
  SUPPLIER_CONVERTED_REGULAR: '转正式供应商',
  SUPPLIER_EVALUATION_CREATED: '履约评价',
  SUPPLIER_EVALUATION_UPDATED: '履约评价更新',
  SUPPLIER_TAGS_UPDATED: '业务标签更新',
  SUPPLIER_TAGS_BACKFILL: '业务标签回填',
  水叮当明文查看供应商联系人: '查看联系方式',
};

/** 取动作中文标签；未收录动作兜底「供应商动态」——新动作漏配词表也不裸出英文枚举 */
export function supplierActionLabel(action: string): string {
  return SUPPLIER_ACTION_LABELS[action] ?? '供应商动态';
}

/** 审批级枚举 → 中文（审计详情 stage/nextStage 值域，与后端 REVIEW_STAGE_LABELS 同口径） */
export const REVIEW_STAGE_LABELS: Record<string, string> = {
  STAFF: '初审',
  LEADER: '复审',
  ADMIN: '终审',
};
