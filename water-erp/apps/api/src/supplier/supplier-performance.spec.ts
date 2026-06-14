import { aggregatePerformance, shouldAutoDisable } from './supplier-performance';

describe('aggregatePerformance', () => {
  const evals = [
    { overallScore: 80, level: 'B', createdAt: new Date('2026-01-01') },
    { overallScore: 70, level: 'B', createdAt: new Date('2026-03-01') },
    { overallScore: 55, level: 'C', createdAt: new Date('2026-05-01') },
  ];
  it('计算均分与趋势（下降）', () => {
    const a = aggregatePerformance(evals as any);
    expect(a.avgScore).toBeCloseTo(68.3, 0);
    expect(a.trend).toBe('declining');
    expect(a.levelCounts.C).toBe(1);
  });
  it('单次评价 → stable', () => {
    expect(aggregatePerformance([evals[0]] as any).trend).toBe('stable');
  });
  it('上升趋势', () => {
    const up = aggregatePerformance([
      { overallScore: 50, level: 'C', createdAt: new Date('2026-01-01') },
      { overallScore: 80, level: 'B', createdAt: new Date('2026-03-01') },
    ] as any);
    expect(up.trend).toBe('improving');
  });
  it('空数组 → 0 分 / stable', () => {
    const a = aggregatePerformance([]);
    expect(a.avgScore).toBe(0);
    expect(a.trend).toBe('stable');
    expect(a.total).toBe(0);
  });
});

describe('shouldAutoDisable', () => {
  it('最近3次均≤60 → true', () => {
    expect(shouldAutoDisable([
      { overallScore: 55 }, { overallScore: 50 }, { overallScore: 60 },
    ] as any, 60)).toBe(true);
  });
  it('最近3次有>60 → false', () => {
    expect(shouldAutoDisable([
      { overallScore: 80 }, { overallScore: 50 }, { overallScore: 60 },
    ] as any, 60)).toBe(false);
  });
  it('不足3次 → false', () => {
    expect(shouldAutoDisable([{ overallScore: 50 }, { overallScore: 50 }] as any, 60)).toBe(false);
  });
});
