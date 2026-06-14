export interface ScoreRecordInput {
  expertId: string; // 评分者标识（接入时用 expertUserId，使偏离可跨项目归属到人）
  scoreItemId: string;
  supplierId: string;
  score: number;
}
export interface ExpertDeviationResult {
  expertId: string;
  meanDeviation: number; // 跨其所有"≥2人目标"的平均绝对偏离
  sampleCount: number; // 参与的有效目标数
}

/**
 * 计算每位专家相对于群体共识的平均评分偏离。
 * 按 (scoreItemId, supplierId) 分组；仅组内 ≥2 位专家时纳入（否则无共识）。
 */
export function computeExpertMeanDeviations(records: ScoreRecordInput[]): ExpertDeviationResult[] {
  const groups = new Map<string, ScoreRecordInput[]>();
  for (const r of records) {
    const key = `${r.scoreItemId}:${r.supplierId}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const acc = new Map<string, { sum: number; count: number }>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const mean = g.reduce((s, r) => s + r.score, 0) / g.length;
    for (const r of g) {
      const dev = Math.abs(r.score - mean);
      const a = acc.get(r.expertId) ?? { sum: 0, count: 0 };
      a.sum += dev;
      a.count += 1;
      acc.set(r.expertId, a);
    }
  }

  return Array.from(acc.entries()).map(([expertId, a]) => ({
    expertId,
    meanDeviation: Math.round((a.sum / a.count) * 10) / 10,
    sampleCount: a.count,
  }));
}

/** 最近 N 次履职评价是否触发自动停用（默认看最近 2 次）。 */
export function shouldDeactivateExpert(recent: Array<{ level: string }>, window = 2): boolean {
  if (recent.length < window) return false;
  return recent.slice(-window).every(e => e.level === 'D');
}

/** 数组均分（保留 1 位小数），空数组返回 null。 */
export function meanOrNull(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10;
}
