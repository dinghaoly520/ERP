export async function recomputeExpertProgress(
  tx: {
    bidScoreItem: { findMany: (args: any) => Promise<any[]> };
    bidSupplier: { findMany: (args: any) => Promise<any[]> };
    bidScoreRecord: { count: (args: any) => Promise<number>; findMany: (args: any) => Promise<any[]> };
  },
  expertId: string,
  projectId: string,
): Promise<{ progress: number; totalScore: number }> {
  const allScoreItems = await tx.bidScoreItem.findMany({ where: { projectId } });
  // P1-9：活跃供应商（解密成功且未撤回）——分子分母同口径，避免撤回后 progress 漂移/超 100
  const activeSuppliers = await tx.bidSupplier.findMany({
    where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
    select: { id: true },
  });
  const activeIds = activeSuppliers.map((s: { id: string }) => s.id);
  const totalItems = allScoreItems.length * activeIds.length;
  const scoredItems = await tx.bidScoreRecord.count({
    where: { expertId, scoreItem: { projectId }, supplierId: { in: activeIds } },
  });
  const progress = totalItems > 0 ? Math.min(100, Math.floor((scoredItems / totalItems) * 100)) : 0; // P1-6 下取整 + P1-9 封顶
  const allRecords = await tx.bidScoreRecord.findMany({
    where: { expertId, scoreItem: { projectId }, supplierId: { in: activeIds } },
  });
  const totalScore = allRecords.reduce((sum, r) => sum + Number(r.score), 0);
  return { progress, totalScore };
}

export function recomputeItemFromDecisions(args: {
  category: string;
  points: { id: string; objective: boolean; fullScore: number }[];
  decisions: Map<string, { checked: boolean; awardedScore: number }>;
  /** P0-A：评分项满分。提供时对 Σawarded 封顶，防止数据异常导致单项分 > maxScore、总分 >100。 */
  maxScore?: number;
}): { score: number; passed: boolean | null } {
  const raw = args.points.reduce((sum, p) => {
    const d = args.decisions.get(p.id);
    return sum + (d ? Number(d.awardedScore) : 0);
  }, 0);
  const score = args.maxScore !== undefined ? Math.min(raw, args.maxScore) : raw;
  const isPassFail = args.category === 'QUALIFICATION' || args.category === 'RESPONSIVE';
  const passed = isPassFail
    ? args.points.filter((p) => p.objective).every((p) => args.decisions.get(p.id)?.checked === true)
    : null;
  return { score, passed };
}
