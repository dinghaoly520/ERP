// apps/api/src/ai-bid-analysis/utils/score-samples.ts
// 把「首轮 + 多次复跑」的评分样本聚合成单次结论（A2 self-consistency）。
// - score 取中位数（抗离群）
// - confidence = 1 − 变异系数（std/mean），多次采样越一致越高；完全一致 = 1
// - unstable = 最高最低差 > maxScore × unstableThreshold，提示专家重点复核
export interface ScoreSample {
  score: number;
  confidence?: number;
}

export interface AggregatedScore {
  score: number;
  confidence: number;
  unstable: boolean;
}

export interface AggregateOptions {
  /** 差值占满分的比例阈值，默认 0.2（差值 > maxScore×20% 判 unstable） */
  unstableThreshold?: number;
}

/** 默认 unstable 比例阈值（差值占 maxScore 的比） */
export const DEFAULT_UNSTABLE_RATIO = 0.2;

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function aggregateScoreSamples(
  samples: ScoreSample[],
  maxScore: number,
  options?: AggregateOptions,
): AggregatedScore {
  const scores = samples.map((s) => s.score);
  if (scores.length === 0) return { score: 0, confidence: 0, unstable: false };

  const med = median(scores);
  const max = Math.max(...scores);
  const min = Math.min(...scores);

  let confidence: number;
  if (max === min) {
    confidence = 1; // 完全一致
  } else {
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, x) => a + (x - mean) ** 2, 0) / scores.length;
    const std = Math.sqrt(variance);
    // mean>0：cv=std/mean；mean=0 且不全相同不可能（scores≥0）。保守用 std 兜底。
    const cv = mean > 0 ? std / mean : std;
    confidence = clamp01(1 - cv);
  }

  const unstableRatio = options?.unstableThreshold ?? DEFAULT_UNSTABLE_RATIO;
  const unstable = maxScore > 0 && max - min > maxScore * unstableRatio;

  return { score: round2(med), confidence: round2(confidence), unstable };
}
