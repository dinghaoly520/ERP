/**
 * 通过性审查单项废标判定（pure helper）。
 *
 * 统计 (supplier, scoreItem) 维度下专家组 BidScoreRecord.passed 投票：
 *  - passed 为 null/undefined 的记录忽略（专家未投）
 *  - 不通过票严格过半（fail > total - fail）→ disqualified
 *
 * 抽自 bid.service.ts generateEvaluationResults 内联逻辑（line ~1144-1181），
 * 供 generateEvaluationResults（批量聚合）与 submitScores（实时单点判定）复用。
 */
export interface InvalidBidVerdict {
  disqualified: boolean;
  failCount: number;
  totalCount: number;
}

export async function evaluateInvalidBid(
  prisma: { bidScoreRecord: { findMany: (args: any) => Promise<any[]> } },
  projectId: string,
  supplierId: string,
  scoreItemId: string,
): Promise<InvalidBidVerdict> {
  const records = await prisma.bidScoreRecord.findMany({
    where: { scoreItemId, supplierId, scoreItem: { projectId } },
    select: { passed: true },
  });

  let fail = 0;
  let total = 0;
  for (const r of records) {
    if (r.passed === null || r.passed === undefined) continue;
    total += 1;
    if (r.passed === false) fail += 1;
  }

  return {
    disqualified: total > 0 && fail > total - fail,
    failCount: fail,
    totalCount: total,
  };
}
