/** 供应商多归属替换集规划（2026-11-04 用户口径：归属公司可选多个）：
 *  「归属中」= APPROVED SupplierCompanyLink（:3004 隔离引擎同口径）；admin 多选保存 =
 *  授予差集（upsert 直批 APPROVED，覆盖 PENDING 待审/DISABLED 停用/REJECTED 驳回）+
 *  移除目标外 APPROVED 链接；非 APPROVED 在途/历史行不动（供应商自助申请流不自扰）。
 *  主归属 Supplier.companyId 快照随集合同步：仍在集合内保持、被移除改指首个、空集清空。 */
export type SupplierCompanyLinkLike = { id: string; companyId: string; status: string };

export function planSupplierCompanySync(
  links: SupplierCompanyLinkLike[],
  currentPrimaryId: string | null,
  targetCompanyIds: string[],
): { grantCompanyIds: string[]; removeLinkIds: string[]; nextPrimaryId: string | null } {
  // 去重保序
  const target = [...new Set(targetCompanyIds)];
  const approvedCompanyIds = new Set(links.filter((l) => l.status === 'APPROVED').map((l) => l.companyId));
  const targetSet = new Set(target);
  return {
    grantCompanyIds: target.filter((id) => !approvedCompanyIds.has(id)),
    removeLinkIds: links.filter((l) => l.status === 'APPROVED' && !targetSet.has(l.companyId)).map((l) => l.id),
    nextPrimaryId: currentPrimaryId && targetSet.has(currentPrimaryId) ? currentPrimaryId : (target[0] ?? null),
  };
}
