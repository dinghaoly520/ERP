import { buildExpertPortrait } from './expert-portrait.util';

describe('buildExpertPortrait（A-E 等级制）', () => {
  it('无分配时返回零值且非常委', () => {
    const p = buildExpertPortrait({
      userId: 'u1',
      displayName: '王某国',
      assignments: [],
      deviation: null,
      recentEvals: [],
    });
    expect(p.participationCount).toBe(0);
    expect(p.completedCount).toBe(0);
    expect(p.completionRate).toBe(0);
    expect(p.gradeCounts).toBeNull(); // 无评价 → 无等级分布
    expect(p.evalCount).toBe(0);
    expect(p.recentLevels).toEqual([]);
    expect(p.meanDeviation).toBeNull();
    expect(p.isStandingExpert).toBe(false);
  });

  it('统计参与次数、完成率与偏离度', () => {
    const p = buildExpertPortrait({
      userId: 'u1',
      displayName: '王某国',
      assignments: [
        { progress: 100, totalScore: 90 },
        { progress: 100, totalScore: 80 },
        { progress: 50, totalScore: 40 },
      ],
      deviation: { meanDeviation: 5.5, sampleCount: 8 },
      recentEvals: [],
    });
    expect(p.participationCount).toBe(3);
    expect(p.completedCount).toBe(2);
    expect(p.completionRate).toBeCloseTo(0.667, 2);
    expect(p.gradeCounts).toBeNull();
    expect(p.meanDeviation).toBe(5.5);
    expect(p.deviationSamples).toBe(8);
  });

  it('参与次数达到阈值标记为常委专家', () => {
    const assignments = Array.from({ length: 6 }, () => ({ progress: 100, totalScore: 85 }));
    const p = buildExpertPortrait({
      userId: 'u1',
      displayName: '王某国',
      assignments,
      deviation: null,
      recentEvals: [],
      standingThreshold: 5,
    });
    expect(p.isStandingExpert).toBe(true);
  });

  it('汇总最近评价等级分布与等级序列', () => {
    const now = new Date('2026-06-14');
    const p = buildExpertPortrait({
      userId: 'u1',
      displayName: '王某国',
      assignments: [],
      deviation: null,
      recentEvals: [
        { level: 'A', overallGrade: 'A', createdAt: now },
        { level: 'B', overallGrade: 'B', createdAt: now },
        { level: 'A', overallGrade: 'A', createdAt: now },
      ],
    });
    expect(p.gradeCounts).toEqual({ A: 2, B: 1 });
    expect(p.evalCount).toBe(3);
    expect(p.recentLevels).toEqual(['A', 'B', 'A']);
  });
});
