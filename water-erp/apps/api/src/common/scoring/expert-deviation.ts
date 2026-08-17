// 位置说明：原位于 expert/ 模块内。2026-08 审计加固时移至 common/scoring 共享内核——
// 这些是纯函数（无 Nest 依赖），bid 与 expert 两模块都使用；放在中立位置避免
// bid.service ↔ expert 模块的文件级双向依赖（模块图诚实化）。
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
  return recent.slice(-window).every(e => e.level === 'E');
}

/** 数组均分（保留 1 位小数），空数组返回 null。 */
export function meanOrNull(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10;
}

/** 评分偏差告警阈值 */
export const DEVIATION_THRESHOLD = {
  WARNING: 0.20,  // 20% 偏离均值 → 黄色告警
  DANGER: 0.30,   // 30% 偏离均值 → 红色告警
} as const;

export interface ScoreAnomalyAlert {
  anomaly: true;
  severity: 'warning' | 'danger';
  expertId: string;
  detail: string;
}

/**
 * 检测新提交的评分是否异常偏离同组（相同 scoreItem + supplier）其他专家的评分。
 * 仅在同组 ≥2 位专家时生效（含新评分），否则返回 null。
 */
export function checkScoreAnomaly(
  newRecord: ScoreRecordInput,
  existingGroupScores: ScoreRecordInput[],
): ScoreAnomalyAlert | null {
  const group = [...existingGroupScores, newRecord];
  if (group.length < 2) return null;

  const mean = group.reduce((s, r) => s + r.score, 0) / group.length;
  if (mean === 0) return null; // 避免除以零（所有评分均为 0 的极端情况）

  const deviation = Math.abs(newRecord.score - mean);
  const deviationRatio = deviation / mean;

  if (deviationRatio >= DEVIATION_THRESHOLD.DANGER) {
    return {
      anomaly: true,
      severity: 'danger',
      expertId: newRecord.expertId,
      detail: `专家评分异常偏离：评分 ${newRecord.score.toFixed(1)}，组均值 ${mean.toFixed(1)}，偏离 ${(deviationRatio * 100).toFixed(0)}%（超过危险阈值 ${DEVIATION_THRESHOLD.DANGER * 100}%）`,
    };
  }
  if (deviationRatio >= DEVIATION_THRESHOLD.WARNING) {
    return {
      anomaly: true,
      severity: 'warning',
      expertId: newRecord.expertId,
      detail: `专家评分偏高：评分 ${newRecord.score.toFixed(1)}，组均值 ${mean.toFixed(1)}，偏离 ${(deviationRatio * 100).toFixed(0)}%（超过警告阈值 ${DEVIATION_THRESHOLD.WARNING * 100}%）`,
    };
  }
  return null;
}
