import { buildExpertPortrait } from './expert-portrait.util';

describe('buildExpertPortrait', () => {
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
    expect(p.averageScore).toBeNull();
    expect(p.meanDeviation).toBeNull();
    expect(p.evalAvg).toBeNull();
    expect(p.isStandingExpert).toBe(false);
  });

  it('统计参与次数、完成率与平均分', () => {
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
    expect(p.averageScore).toBe(70); // (90+80+40)/3
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

  it('汇总最近评价均分与等级序列', () => {
    const now = new Date('2026-06-14');
    const p = buildExpertPortrait({
      userId: 'u1',
      displayName: '王某国',
      assignments: [],
      deviation: null,
      recentEvals: [
        { level: 'A', overallScore: 92, createdAt: now },
        { level: 'B', overallScore: 84, createdAt: now },
      ],
    });
    expect(p.evalAvg).toBe(88);
    expect(p.evalCount).toBe(2);
    expect(p.recentLevels).toEqual(['A', 'B']);
  });
});
