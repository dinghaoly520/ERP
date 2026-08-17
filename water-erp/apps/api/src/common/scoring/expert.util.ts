// 位置说明：原位于 expert/expert.util.ts。2026-08 审计加固时移至 common/scoring 共享内核——
// 纯函数，bid 与 expert 两模块都使用，中立位置避免文件级双向依赖。
/**
 * P2：健壮解析 expert.conflictedSupplierIds。
 * Prisma Json 字段可能返回数组，也可能是 JSON 字符串（seed 数据历史遗留）；
 * 直接 `as string[]` 会让 `.includes` 退化为子串匹配，导致回避时严时松。
 */
export function parseConflictedIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
