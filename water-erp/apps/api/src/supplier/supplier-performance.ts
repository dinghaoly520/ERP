import { ExpertLevel } from '@prisma/client';

/** 供应商绩效聚合（等级制）。 */
const GRADE_SCORE: Record<ExpertLevel, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };

export function aggregatePerformance(evals: Array<{ finalGrade: ExpertLevel; createdAt: Date }>) {
  const sorted = [...evals].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const avgGradeScore = sorted.length
    ? Math.round((sorted.reduce((s, e) => s + GRADE_SCORE[e.finalGrade], 0) / sorted.length) * 10) / 10
    : 0;
  const trend = sorted.length < 2
    ? 'stable'
    : GRADE_SCORE[sorted[sorted.length - 1].finalGrade] > GRADE_SCORE[sorted[0].finalGrade]
      ? 'improving'
      : GRADE_SCORE[sorted[sorted.length - 1].finalGrade] < GRADE_SCORE[sorted[0].finalGrade]
        ? 'declining'
        : 'stable';
  const levelCounts: Record<ExpertLevel, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const e of sorted) {
    if (e.finalGrade in levelCounts) levelCounts[e.finalGrade]++;
  }
  const excellentRatio = sorted.length
    ? Math.round(((levelCounts['A'] + levelCounts['B']) / sorted.length) * 1000) / 10
    : 0;
  return { avgGradeScore, excellentRatio, trend, levelCounts, total: sorted.length };
}

/** 连续 3 次 E 级（不合格）触发淘汰预警 */
export function shouldAutoDisable(recent: Array<{ finalGrade: ExpertLevel }>): boolean {
  if (recent.length < 3) return false;
  return recent.slice(0, 3).every(e => e.finalGrade === 'E');
}
