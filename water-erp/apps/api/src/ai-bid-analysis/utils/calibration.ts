// apps/api/src/ai-bid-analysis/utils/calibration.ts
// P1-E 全局 AI 评分校准：把 BidScoreDelta（专家 vs AI 差异）聚合成全局统计。
// 纯函数，不依赖 DB —— service 层查表后传入。
export interface DeltaInput {
  scoreItemId: string;
  expertScore: number;
  aiScore: number;
  delta: number; // expert − ai
  accepted: boolean;
}
export interface ScoreItemInput {
  id: string;
  category: string;
  name: string;
}
export interface CalibrationResult {
  overall: { total: number; accepted: number; adoptionRate: number }; // 0–1
  byCategory: Array<{ category: string; avgDelta: number; count: number }>;
  topDeviations: Array<{ scoreItemId: string; name: string; category: string; avgDelta: number; count: number }>; // |avgDelta| top 5
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildCalibration(
  deltas: DeltaInput[],
  items: ScoreItemInput[],
): CalibrationResult | null {
  if (deltas.length === 0) return null;

  const total = deltas.length;
  const accepted = deltas.filter((d) => d.accepted).length;
  const adoptionRate = round1(accepted / total);

  const itemMap = new Map(items.map((i) => [i.id, i]));

  // byCategory（只计有 item 的 delta）
  const catAcc = new Map<string, { sum: number; count: number }>();
  // topDeviations（按 scoreItemId 聚合，只计有 item）
  const itemAcc = new Map<string, { sum: number; count: number }>();
  for (const d of deltas) {
    const it = itemMap.get(d.scoreItemId);
    if (!it) continue;
    const ca = catAcc.get(it.category) ?? { sum: 0, count: 0 };
    ca.sum += d.delta;
    ca.count += 1;
    catAcc.set(it.category, ca);
    const ia = itemAcc.get(d.scoreItemId) ?? { sum: 0, count: 0 };
    ia.sum += d.delta;
    ia.count += 1;
    itemAcc.set(d.scoreItemId, ia);
  }

  const byCategory = Array.from(catAcc.entries()).map(([category, a]) => ({
    category,
    avgDelta: round1(a.sum / a.count),
    count: a.count,
  }));

  const topDeviations = Array.from(itemAcc.entries())
    .map(([id, a]) => {
      const it = itemMap.get(id)!;
      return {
        scoreItemId: id,
        name: it.name,
        category: it.category,
        avgDelta: round1(a.sum / a.count),
        count: a.count,
      };
    })
    .sort((x, y) => Math.abs(y.avgDelta) - Math.abs(x.avgDelta))
    .slice(0, 5);

  return { overall: { total, accepted, adoptionRate }, byCategory, topDeviations };
}
