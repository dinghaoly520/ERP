import { computeExpertMeanDeviations, shouldDeactivateExpert } from './expert-deviation';

describe('computeExpertMeanDeviations', () => {
  it('同目标多专家：各专家偏离 = |自分 - 组均值|', () => {
    // 目标(i1,s1)：A=80, B=70, C=90 → 组均值 80；偏离 A=0, B=10, C=10
    const r = computeExpertMeanDeviations([
      { expertId: 'A', scoreItemId: 'i1', supplierId: 's1', score: 80 },
      { expertId: 'B', scoreItemId: 'i1', supplierId: 's1', score: 70 },
      { expertId: 'C', scoreItemId: 'i1', supplierId: 's1', score: 90 },
    ]);
    const m = new Map(r.map(x => [x.expertId, x.meanDeviation]));
    expect(m.get('A')).toBe(0);
    expect(m.get('B')).toBe(10);
    expect(m.get('C')).toBe(10);
  });

  it('仅 1 位专家的目标不参与（无共识可比）', () => {
    const r = computeExpertMeanDeviations([
      { expertId: 'A', scoreItemId: 'i1', supplierId: 's1', score: 80 },
    ]);
    expect(r).toHaveLength(0);
  });

  it('专家跨多目标：取其各目标偏离的均值 + 计数', () => {
    // 目标1(i1,s1): A=80, B=80 → 均值80, A偏离0
    // 目标2(i2,s1): A=90, C=70 → 均值80, A偏离10
    // A 平均偏离 = (0+10)/2 = 5, sampleCount=2
    const r = computeExpertMeanDeviations([
      { expertId: 'A', scoreItemId: 'i1', supplierId: 's1', score: 80 },
      { expertId: 'B', scoreItemId: 'i1', supplierId: 's1', score: 80 },
      { expertId: 'A', scoreItemId: 'i2', supplierId: 's1', score: 90 },
      { expertId: 'C', scoreItemId: 'i2', supplierId: 's1', score: 70 },
    ]);
    const a = r.find(x => x.expertId === 'A')!;
    expect(a.meanDeviation).toBe(5);
    expect(a.sampleCount).toBe(2);
  });

  it('不同供应商同名评分项视为不同目标', () => {
    const r = computeExpertMeanDeviations([
      { expertId: 'A', scoreItemId: 'i1', supplierId: 's1', score: 80 },
      { expertId: 'B', scoreItemId: 'i1', supplierId: 's2', score: 60 }, // 不同 supplierId → 单独目标
    ]);
    expect(r).toHaveLength(0); // 两个目标各只有 1 人
  });

  it('空输入 → []', () => {
    expect(computeExpertMeanDeviations([])).toEqual([]);
  });
});

describe('shouldDeactivateExpert', () => {
  it('最近 2 次均为 D → true', () => {
    expect(shouldDeactivateExpert([{ level: 'D' }, { level: 'D' }])).toBe(true);
  });
  it('最近 2 次中有非 D → false', () => {
    expect(shouldDeactivateExpert([{ level: 'C' }, { level: 'D' }])).toBe(false);
  });
  it('不足 2 次 → false', () => {
    expect(shouldDeactivateExpert([{ level: 'D' }])).toBe(false);
  });
});
