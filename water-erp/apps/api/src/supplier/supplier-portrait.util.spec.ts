import { buildSupplierPortrait } from './supplier-portrait.util';

describe('buildSupplierPortrait', () => {
  it('无参与时返回零值', () => {
    const p = buildSupplierPortrait({ supplierId: 's1', name: '甲公司', participations: [], evaluations: [] });
    expect(p.participationCount).toBe(0);
    expect(p.winCount).toBe(0);
    expect(p.winRate).toBe(0);
    expect(p.avgEvalScore).toBeNull();
    expect(p.performanceTrend).toBe('stable');
    expect(p.priceDeviation).toBeNull();
  });

  it('统计参与次数、中标次数与中标率', () => {
    const p = buildSupplierPortrait({
      supplierId: 's1',
      name: '甲公司',
      participations: [
        { won: true },
        { won: false },
        { won: true },
        { won: false },
      ],
      evaluations: [],
    });
    expect(p.participationCount).toBe(4);
    expect(p.winCount).toBe(2);
    expect(p.winRate).toBeCloseTo(0.5, 2);
  });

  it('汇总绩效均分与等级分布', () => {
    const now = new Date('2026-06-14');
    const p = buildSupplierPortrait({
      supplierId: 's1',
      name: '甲公司',
      participations: [],
      evaluations: [
        { overallScore: 80, level: 'B', createdAt: now },
        { overallScore: 90, level: 'A', createdAt: now },
      ],
    });
    expect(p.avgEvalScore).toBe(85);
    expect(p.evalCount).toBe(2);
    expect(p.levelCounts).toEqual({ A: 1, B: 1, C: 0, D: 0 });
    expect(p.performanceTrend).toBe('improving');
  });

  it('在有报价与中标价时计算价格偏离度', () => {
    const p = buildSupplierPortrait({
      supplierId: 's1',
      name: '甲公司',
      participations: [
        { won: false, bidPrice: 110, awardPrice: 100 }, // +10%
        { won: false, bidPrice: 105, awardPrice: 100 }, // +5%
      ],
      evaluations: [],
    });
    // 平均相对偏离 (10% + 5%) / 2 = 7.5
    expect(p.priceDeviation).toBeCloseTo(7.5, 1);
  });

  it('缺少中标价时价格偏离度为 null', () => {
    const p = buildSupplierPortrait({
      supplierId: 's1',
      name: '甲公司',
      participations: [{ won: false, bidPrice: 110, awardPrice: null }],
      evaluations: [],
    });
    expect(p.priceDeviation).toBeNull();
  });
});
