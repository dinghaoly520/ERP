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
  prisma: {
    bidScoreRecord: { findMany: (args: any) => Promise<any[]> };
    bidInvalidBid?: { findFirst: (args: any) => Promise<unknown> };
  },
  projectId: string,
  supplierId: string,
  scoreItemId: string,
): Promise<InvalidBidVerdict> {
  // H2 对齐：该（供应商，评分项）的废标已被管理员复核撤销 → 票不计入，本项不判废
  //（与权威重算的 revokedKeys 跳过同语义；可选依赖兼容窄 mock 测试环境）。
  if (prisma.bidInvalidBid?.findFirst) {
    const revoked = await prisma.bidInvalidBid.findFirst({
      where: { projectId, supplierId, scoreItemId, status: 'revoked' },
      select: { id: true },
    });
    if (revoked) {
      const all = await prisma.bidScoreRecord.findMany({
        where: { scoreItemId, supplierId, scoreItem: { projectId }, expert: { expertRole: '正选' } },
        select: { passed: true },
      });
      let fail = 0, total = 0;
      for (const r of all) {
        if (r.passed === null || r.passed === undefined) continue;
        total += 1;
        if (r.passed === false) fail += 1;
      }
      return { disqualified: false, failCount: fail, totalCount: total };
    }
  }
  const records = await prisma.bidScoreRecord.findMany({
    // P3-14（2026-11-20 全链路审查）：对齐权威重算口径（bid-evaluation-results:284-287）——
    // 仅正选专家投票计入、撤销的废标（BidInvalidBid revoked）不计入失败票。原实时判定
    // 无此两滤（候补评分记录/已撤销废标会被计入），与结果生成的权威判定不对称，误判的
    // invalid 标记会误导主持端废标面板（权威重算时会被纠正，但过程态失真）。
    where: {
      scoreItemId,
      supplierId,
      scoreItem: { projectId },
      expert: { expertRole: '正选' },
    },
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
