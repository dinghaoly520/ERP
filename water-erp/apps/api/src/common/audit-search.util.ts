/**
 * AuditLog 明细搜索子句（2026-11-09 操作历史统一配筛选+搜索）。
 *
 * Prisma 的 Json string_contains 只对**字符串值**生效：path 指到对象/数组（如整篇
 * `['$']`）恒 false，裸 SQL `details::text LIKE` 才能全文命中——但走 raw 需重写
 * 分页与 where 组合，代价不成比例。折中口径：resourceType（含 `供应商名:id` 复合
 * 头段）∪ 常用文本快照键逐 path OR——键集按全库 details 键名盘点（projectName/
 * expertName/reason/target/…），新写入点若新增可读键须同步 SEARCH_KEY。
 */
export const AUDIT_SEARCH_KEYS = [
  'projectName',
  'expertName',
  'name',
  'reason',
  'target',
  'result',
  'fileName',
  'employer',
  'outcome',
  'type',
] as const;

/** 搜索 OR 子句数组（消费方并入自有 where.OR；条目为 AuditLogWhereInput 形状） */
export function auditDetailSearchClauses(q: string): unknown[] {
  return [
    { resourceType: { contains: q } },
    ...AUDIT_SEARCH_KEYS.map((k) => ({ details: { path: [k], string_contains: q } })),
  ];
}
