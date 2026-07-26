/**
 * 供应商画像聚合（纯函数）。Track E §3.3。
 *
 * 由 SupplierService.getSupplierPortrait 收集原始数据后调用。
 * 价格偏离度仅在同时具备该供应商报价与对应项目中标价时计算。
 */
import { ExpertLevel } from '@prisma/client';

export interface SupplierParticipationInput {
  won: boolean;
  /** 该供应商在某项目的报价（可为空） */
  bidPrice?: number | null;
  /** 该项目的中标价（可为空；缺失则不计入偏离度） */
  awardPrice?: number | null;
}

export interface SupplierEvalInput {
  finalGrade: ExpertLevel;
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
  avgGradeScore: number | null;
  evalCount: number;
  performanceTrend: 'improving' | 'stable' | 'declining';
  levelCounts: { A: number; B: number; C: number; D: number; E: number };
  /** 平均相对价格偏离（%），缺数据时 null */
  priceDeviation: number | null;
}

const GRADE_SCORE: Record<ExpertLevel, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };

export function buildSupplierPortrait(input: SupplierPortraitInput): SupplierPortrait {
  const { participations, evaluations } = input;

  const participationCount = participations.length;
  const winCount = participations.filter(p => p.won).length;
  const winRate = participationCount > 0 ? winCount / participationCount : 0;

  const gradeScores = evaluations.map(e => GRADE_SCORE[e.finalGrade]);
  const avgGradeScore = gradeScores.length > 0
    ? Math.round((gradeScores.reduce((s, x) => s + x, 0) / gradeScores.length) * 10) / 10
    : null;

  // 趋势：按时间排序，比较首末等级数值
  const sorted = [...evaluations].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let trend: 'improving' | 'stable' | 'declining' = 'stable';
  if (sorted.length >= 2) {
    const first = GRADE_SCORE[sorted[0].finalGrade];
    const last = GRADE_SCORE[sorted[sorted.length - 1].finalGrade];
    if (last > first) trend = 'improving';
    else if (last < first) trend = 'declining';
  }

  const levelCounts: { A: number; B: number; C: number; D: number; E: number } = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const e of sorted) {
    if (e.finalGrade in levelCounts) levelCounts[e.finalGrade]++;
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
    avgGradeScore,
    evalCount: evaluations.length,
    performanceTrend: trend,
    levelCounts,
    priceDeviation,
  };
}
