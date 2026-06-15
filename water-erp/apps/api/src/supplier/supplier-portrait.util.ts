/**
 * 供应商画像聚合（纯函数）。Track E §3.3。
 *
 * 由 SupplierService.getSupplierPortrait 收集原始数据后调用。
 * 价格偏离度仅在同时具备该供应商报价与对应项目中标价时计算。
 */
export interface SupplierParticipationInput {
  won: boolean;
  /** 该供应商在某项目的报价（可为空） */
  bidPrice?: number | null;
  /** 该项目的中标价（可为空；缺失则不计入偏离度） */
  awardPrice?: number | null;
}

export interface SupplierEvalInput {
  overallScore: number;
  level: string;
  createdAt: Date;
}

export interface SupplierPortraitInput {
  supplierId: string;
  name: string;
  participations: SupplierParticipationInput[];
  evaluations: SupplierEvalInput[];
}

export interface SupplierPortrait {
  supplierId: string;
  name: string;
  participationCount: number;
  winCount: number;
  winRate: number; // 0~1
  avgEvalScore: number | null;
  evalCount: number;
  performanceTrend: 'improving' | 'stable' | 'declining';
  levelCounts: { A: number; B: number; C: number; D: number };
  /** 平均相对价格偏离（%），缺数据时 null */
  priceDeviation: number | null;
}

export function buildSupplierPortrait(input: SupplierPortraitInput): SupplierPortrait {
  const { participations, evaluations } = input;

  const participationCount = participations.length;
  const winCount = participations.filter(p => p.won).length;
  const winRate = participationCount > 0 ? winCount / participationCount : 0;

  const evalScores = evaluations.map(e => Number(e.overallScore));
  const avgEvalScore = evalScores.length > 0
    ? Math.round((evalScores.reduce((s, x) => s + x, 0) / evalScores.length) * 10) / 10
    : null;

  // 趋势：按时间排序，比较首末
  const sorted = [...evaluations].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let trend: 'improving' | 'stable' | 'declining' = 'stable';
  if (sorted.length >= 2) {
    const first = Number(sorted[0].overallScore);
    const last = Number(sorted[sorted.length - 1].overallScore);
    if (last > first + 5) trend = 'improving';
    else if (last < first - 5) trend = 'declining';
  }

  const levelCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const e of sorted) {
    if (e.level in levelCounts) levelCounts[e.level as keyof typeof levelCounts]++;
  }

  // 价格偏离度：仅统计同时具备 bidPrice 与 awardPrice 的项目
  const devs: number[] = [];
  for (const p of participations) {
    const bid = Number(p.bidPrice);
    const award = Number(p.awardPrice);
    if (Number.isFinite(bid) && Number.isFinite(award) && award > 0) {
      devs.push(((bid - award) / award) * 100);
    }
  }
  const priceDeviation = devs.length > 0
    ? Math.round((devs.reduce((s, x) => s + x, 0) / devs.length) * 10) / 10
    : null;

  return {
    supplierId: input.supplierId,
    name: input.name,
    participationCount,
    winCount,
    winRate: Math.round(winRate * 1000) / 1000,
    avgEvalScore,
    evalCount: evaluations.length,
    performanceTrend: trend,
    levelCounts,
    priceDeviation,
  };
}
