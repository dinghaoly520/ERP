/**
 * 专家画像聚合（纯函数）。Track D §3.4。
 *
 * 由 ExpertAdminService.getExpertPortrait 收集原始数据后调用，
 * 在此做无副作用的数值聚合，便于单测。
 */
export interface ExpertAssignmentInput {
  progress: number;
  totalScore: number;
}

export interface ExpertDeviationInput {
  meanDeviation: number;
  sampleCount: number;
}

export interface ExpertEvalInput {
  level: string;
  overallScore: number;
  createdAt: Date;
}

export interface ExpertPortraitInput {
  userId: string;
  displayName: string;
  assignments: ExpertAssignmentInput[];
  deviation: ExpertDeviationInput | null;
  recentEvals: ExpertEvalInput[];
  /** 常委专家阈值（参与次数 ≥ 此值）；默认 5。 */
  standingThreshold?: number;
}

export interface ExpertPortrait {
  userId: string;
  displayName: string;
  participationCount: number;
  completedCount: number;
  completionRate: number; // 0~1
  averageScore: number | null;
  meanDeviation: number | null;
  deviationSamples: number;
  evalAvg: number | null;
  evalCount: number;
  recentLevels: string[];
  isStandingExpert: boolean;
}

export function buildExpertPortrait(input: ExpertPortraitInput): ExpertPortrait {
  const { assignments, deviation, recentEvals } = input;
  const threshold = input.standingThreshold ?? 5;

  const participationCount = assignments.length;
  const completedCount = assignments.filter(a => a.progress >= 100).length;
  const completionRate = participationCount > 0 ? completedCount / participationCount : 0;

  const scores = assignments.map(a => Number(a.totalScore));
  const averageScore = scores.length > 0
    ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10
    : null;

  const evalOverall = recentEvals.map(e => Number(e.overallScore));
  const evalAvg = evalOverall.length > 0
    ? Math.round((evalOverall.reduce((s, x) => s + x, 0) / evalOverall.length) * 10) / 10
    : null;

  return {
    userId: input.userId,
    displayName: input.displayName,
    participationCount,
    completedCount,
    completionRate: Math.round(completionRate * 1000) / 1000,
    averageScore,
    meanDeviation: deviation ? deviation.meanDeviation : null,
    deviationSamples: deviation ? deviation.sampleCount : 0,
    evalAvg,
    evalCount: recentEvals.length,
    recentLevels: recentEvals.map(e => e.level),
    isStandingExpert: participationCount >= threshold,
  };
}
