export function aggregatePerformance(evals: Array<{ overallScore: number; level: string; createdAt: Date }>) {
  const sorted = [...evals].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const avgScore = sorted.length ? sorted.reduce((s, e) => s + Number(e.overallScore), 0) / sorted.length : 0;
  const trend = sorted.length < 2
    ? 'stable'
    : sorted[sorted.length - 1].overallScore > sorted[0].overallScore + 5
      ? 'improving'
      : sorted[sorted.length - 1].overallScore < sorted[0].overallScore - 5
        ? 'declining'
        : 'stable';
  const levelCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const e of sorted) {
    if (e.level in levelCounts) levelCounts[e.level as keyof typeof levelCounts]++;
  }
  return { avgScore: Math.round(avgScore * 10) / 10, trend, levelCounts, total: sorted.length };
}

export function shouldAutoDisable(recent: Array<{ overallScore: number }>, threshold: number): boolean {
  if (recent.length < 3) return false;
  return recent.slice(-3).every(e => Number(e.overallScore) <= threshold);
}
