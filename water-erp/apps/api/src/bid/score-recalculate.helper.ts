export async function recomputeExpertProgress(
  tx: {
    bidScoreItem: { findMany: (args: any) => Promise<any[]> };
    bidSupplier: { findMany: (args: any) => Promise<any[]> };
    bidScoreRecord: { count: (args: any) => Promise<number>; findMany: (args: any) => Promise<any[]> };
  },
  expertId: string,
  projectId: string,
  /** P1-5（中断审查）：该专家申报回避的供应商——分母排除。可评集合单一来源：
   *  活跃 − 本专家回避 − 废标（P1-6），三处消费（progress 分母/核对闸/报告确认）共用本口径 */
  conflictedSupplierIds: string[] = [],
): Promise<{ progress: number; totalScore: number }> {
  const allScoreItems = await tx.bidScoreItem.findMany({ where: { projectId } });
  // P1-12fix：PRICE 类评分项由公式引擎自动出分（专家不写 BidScoreRecord），
  // 计入分母会使竞价采购（仅通过性+价格公式）专家进度封顶 66% → 报告确认死锁。
  const expertScorableItems = allScoreItems.filter(i => i.category !== 'PRICE');
  // P1-9：活跃供应商（解密成功且未撤回）——分子分母同口径，避免撤回后 progress 漂移/超 100
  const activeSuppliers = await tx.bidSupplier.findMany({
    where: { projectId, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } },
    select: { id: true, bidValidity: true },
  });
  // P1-5/P1-6（中断审查）：旧口径分母含回避/废标家，而 submitScores 拒收回避家、
  // 前端锁死废标家 → 评不出即永远到不了 100 → confirmReport 死锁（两型同根）。
  const conflictedSet = new Set(conflictedSupplierIds);
  const activeIds = activeSuppliers
    .filter((s: { id: string; bidValidity?: string | null }) => !conflictedSet.has(s.id) && s.bidValidity !== 'invalid')
    .map((s: { id: string }) => s.id);
  const totalItems = expertScorableItems.length * activeIds.length;
  const scoredItems = await tx.bidScoreRecord.count({
    // N8b：分子与分母同口径排 PRICE——手填价格分记录不得虚增进度（P1-12fix 分母已排）
    where: { expertId, scoreItem: { projectId, category: { not: 'PRICE' } }, supplierId: { in: activeIds } },
  });
  const progress = totalItems > 0 ? Math.min(100, Math.floor((scoredItems / totalItems) * 100)) : 0; // P1-6 下取整 + P1-9 封顶
  const allRecords = await tx.bidScoreRecord.findMany({
    where: { expertId, scoreItem: { projectId }, supplierId: { in: activeIds } },
  });
  // 语义修正：totalScore = 跨可评供应商的均分（非总分），避免专家看到 N×76 的总分混淆
  const totalSum = allRecords.reduce((sum, r) => sum + Number(r.score), 0);
  const activeCount = activeIds.length;
  const totalScore = activeCount > 0
    ? Math.round((totalSum / activeCount) * 10) / 10
    : 0;
  return { progress, totalScore };
}

export function recomputeItemFromDecisions(args: {
  category: string;
  points: { id: string; objective: boolean; fullScore: number }[];
  decisions: Map<string, { checked: boolean; awardedScore: number }>;
  /** P0-A：评分项满分。提供时对 Σawarded 封顶，防止数据异常导致单项分 > maxScore、总分 >100。 */
  maxScore?: number;
}): { score: number; passed: boolean | null } {
  const isPassFail = args.category === 'QUALIFICATION' || args.category === 'RESPONSIVE';
  const raw = args.points.reduce((sum, p) => {
    const d = args.decisions.get(p.id);
    if (!d) return sum;
    // P2：客观点未勾选不计分（checked 与 awardedScore 耦合，防 checked=false 仍计满分）
    const awarded = p.objective && !d.checked ? 0 : Number(d.awardedScore);
    return sum + awarded;
  }, 0);
  // P2：通过性项不进总分（与旧路径口径统一）；其余按 maxScore 封顶
  const score = isPassFail ? 0 : (args.maxScore !== undefined ? Math.min(raw, args.maxScore) : raw);
  // P2：空客观点集合不再自动通过（.every 空集为 true 的陷阱）
  const objectivePoints = args.points.filter((p) => p.objective);
  const passed = isPassFail
    ? (objectivePoints.length > 0 ? objectivePoints.every((p) => args.decisions.get(p.id)?.checked === true) : false)
    : null;
  return { score, passed };
}
