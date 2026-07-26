import { aggregatePerformance, shouldAutoDisable } from './supplier-performance';

describe('aggregatePerformance', () => {
  const evals = [
    { finalGrade: 'B', createdAt: new Date('2026-01-01') },
    { finalGrade: 'B', createdAt: new Date('2026-03-01') },
    { finalGrade: 'C', createdAt: new Date('2026-05-01') },
  ] as const;
  it('计算均分与趋势（下降）', () => {
    const a = aggregatePerformance(evals as any);
    expect(a.avgGradeScore).toBeCloseTo(3.7, 0);
    expect(a.trend).toBe('declining');
    expect(a.levelCounts.C).toBe(1);
    expect(a.levelCounts.E).toBe(0);
  });
  it('单次评价 → stable', () => {
    expect(aggregatePerformance([evals[0]] as any).trend).toBe('stable');
  });
  it('上升趋势', () => {
    const up = aggregatePerformance([
      { finalGrade: 'C', createdAt: new Date('2026-01-01') },
      { finalGrade: 'B', createdAt: new Date('2026-03-01') },
    ] as any);
    expect(up.trend).toBe('improving');
  });
  it('空数组 → 0 分 / stable', () => {
    const a = aggregatePerformance([]);
    expect(a.avgGradeScore).toBe(0);
    expect(a.trend).toBe('stable');
    expect(a.total).toBe(0);
  });
  it('excellentRatio 计算 A+B 占比', () => {
    const a = aggregatePerformance([
      { finalGrade: 'A', createdAt: new Date('2026-01-01') },
      { finalGrade: 'B', createdAt: new Date('2026-02-01') },
      { finalGrade: 'C', createdAt: new Date('2026-03-01') },
      { finalGrade: 'D', createdAt: new Date('2026-04-01') },
    ] as any);
    expect(a.excellentRatio).toBeCloseTo(50, 0);
  });
});

describe('shouldAutoDisable', () => {
  it('最近3次均为E → true', () => {
    expect(shouldAutoDisable([
      { finalGrade: 'E' }, { finalGrade: 'E' }, { finalGrade: 'E' },
    ] as any)).toBe(true);
  });
  it('最近3次有非E → false', () => {
    expect(shouldAutoDisable([
      { finalGrade: 'A' }, { finalGrade: 'E' }, { finalGrade: 'E' },
    ] as any)).toBe(false);
  });
  it('不足3次 → false', () => {
    expect(shouldAutoDisable([{ finalGrade: 'E' }, { finalGrade: 'E' }] as any)).toBe(false);
  });
});
