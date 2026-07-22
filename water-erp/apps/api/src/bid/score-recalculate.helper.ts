export async function recomputeExpertProgress(
  tx: {
    bidScoreItem: { findMany: (args: any) => Promise<any[]> };
    bidSupplier: { count: (args: any) => Promise<number> };
    bidScoreRecord: { count: (args: any) => Promise<number>; findMany: (args: any) => Promise<any[]> };
  },
  expertId: string,
  projectId: string,
): Promise<{ progress: number; totalScore: number }> {
  const allScoreItems = await tx.bidScoreItem.findMany({ where: { projectId } });
  const activeSupplierCount = await tx.bidSupplier.count({
    where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
  });
  const totalItems = allScoreItems.length * activeSupplierCount;
  const scoredItems = await tx.bidScoreRecord.count({
    where: { expertId, scoreItem: { projectId } },
  });
  const progress = totalItems > 0 ? Math.round((scoredItems / totalItems) * 100) : 0;
  const allRecords = await tx.bidScoreRecord.findMany({
    where: { expertId, scoreItem: { projectId } },
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
