// apps/api/src/ai-bid-analysis/utils/score-samples.spec.ts
import { aggregateScoreSamples } from './score-samples';

describe('aggregateScoreSamples', () => {
  it('单样本 → 该分数 / confidence 1 / stable', () => {
    const r = aggregateScoreSamples([{ score: 8 }], 20);
    expect(r.score).toBe(8);
    expect(r.confidence).toBe(1);
    expect(r.unstable).toBe(false);
  });

  it('三次完全一致 → 中位数=该值 / confidence 1 / stable', () => {
    const r = aggregateScoreSamples([{ score: 8 }, { score: 8 }, { score: 8 }], 20);
    expect(r.score).toBe(8);
    expect(r.confidence).toBe(1);
    expect(r.unstable).toBe(false);
  });

  it('三次小差 → 中位数 / 高 confidence / stable（差值 ≤ maxScore×20%）', () => {
    const r = aggregateScoreSamples([{ score: 8 }, { score: 8 }, { score: 9 }], 20);
    expect(r.score).toBe(8);
    expect(r.confidence).toBeGreaterThan(0.9);
    expect(r.unstable).toBe(false);
  });

  it('三次大差 → 中位数 / 低 confidence / unstable（差值 > maxScore×20%）', () => {
    const r = aggregateScoreSamples([{ score: 10 }, { score: 5 }, { score: 8 }], 10);
    expect(r.score).toBe(8);
    expect(r.confidence).toBeLessThan(0.8);
    expect(r.unstable).toBe(true);
  });

  it('偶数个样本 → 中位数取中间两数均值', () => {
    const r = aggregateScoreSamples([{ score: 10 }, { score: 8 }], 20);
    expect(r.score).toBe(9);
  });

  it('全 0 → confidence 1 / stable', () => {
    const r = aggregateScoreSamples([{ score: 0 }, { score: 0 }, { score: 0 }], 10);
    expect(r.confidence).toBe(1);
    expect(r.unstable).toBe(false);
  });

  it('自定义 unstableThreshold：默认 stable、调低后 unstable', () => {
    // [10,8] 差 2，maxScore=10：默认 0.2 → 阈值 2，2>2 false；0.1 → 阈值 1，2>1 true
    const samples = [{ score: 10 }, { score: 8 }];
    expect(aggregateScoreSamples(samples, 10).unstable).toBe(false);
    expect(aggregateScoreSamples(samples, 10, { unstableThreshold: 0.1 }).unstable).toBe(true);
  });

  it('空样本 → score 0 / confidence 0 / stable', () => {
    const r = aggregateScoreSamples([], 10);
    expect(r.score).toBe(0);
    expect(r.confidence).toBe(0);
    expect(r.unstable).toBe(false);
  });
});
