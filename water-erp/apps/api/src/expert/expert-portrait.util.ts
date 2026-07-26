import { ExpertLevel } from '@prisma/client';

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
  overallGrade: ExpertLevel;
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
  gradeCounts: Record<string, number> | null;
  meanDeviation: number | null;
  deviationSamples: number;
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

  const gradeCounts: Record<string, number> = {};
  for (const e of recentEvals) {
    gradeCounts[e.overallGrade] = (gradeCounts[e.overallGrade] || 0) + 1;
  }

  return {
    userId: input.userId,
    displayName: input.displayName,
    participationCount,
    completedCount,
    completionRate: Math.round(completionRate * 1000) / 1000,
    gradeCounts: Object.keys(gradeCounts).length > 0 ? gradeCounts : null,
    meanDeviation: deviation ? deviation.meanDeviation : null,
    deviationSamples: deviation ? deviation.sampleCount : 0,
    evalCount: recentEvals.length,
    recentLevels: recentEvals.map(e => e.level),
    isStandingExpert: participationCount >= threshold,
  };
}
