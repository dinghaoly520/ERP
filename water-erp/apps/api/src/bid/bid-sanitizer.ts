/**
 * L6 字段去敏：bid_host 在 :3007 不应看到采购管理内部字段。
 *
 * 移除的字段属于 :3005 采购管理视角（成本、内部审批、预算等），
 * :3007 现场执行端不需要这些信息。
 */

// bid_host 不应看到的字段 key（匹配 Prisma BidProject 返回的 key）
const BID_HOST_REDACTED_FIELDS: ReadonlySet<string> = new Set([
  // 预算/成本（采购管理内部）
  'budgetAmount',
  'budgetSource',
  'costTracking',
  // 内部审批备注
  'internalNotes',
  'adminComment',
  'reviewNotes',
  // 采购管理元数据
  'createdById',
  'projectManagementItemId', // 保留 id 但不返回关联管理项详情
]);

/**
 * 对单个对象做字段去敏（适用于 bid_host / :3007 视角）
 */
export function sanitizeForBidHost<T extends Record<string, unknown>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!BID_HOST_REDACTED_FIELDS.has(key)) {
      result[key] = obj[key];
    }
  }
  return result as T;
}

/**
 * 对数组做字段去敏
 */
export function sanitizeListForBidHost<T extends Record<string, unknown>>(list: T[]): T[] {
  return list.map(sanitizeForBidHost);
}
