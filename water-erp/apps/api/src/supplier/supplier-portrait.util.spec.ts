import { buildSupplierPortrait } from './supplier-portrait.util';
import { ExpertLevel } from '@prisma/client';

describe('buildSupplierPortrait', () => {
  it('无参与时返回零值', () => {
    const p = buildSupplierPortrait({ supplierId: 's1', name: '甲公司', participations: [], evaluations: [] });
    expect(p.participationCount).toBe(0);
    expect(p.winCount).toBe(0);
    expect(p.winRate).toBe(0);
    expect(p.avgGradeScore).toBeNull();
    expect(p.performanceTrend).toBe('stable');
    expect(p.priceDeviation).toBeNull();
    expect(p.levelCounts.E).toBe(0);
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

  it('汇总绩效等级分布与趋势', () => {
    const now = new Date('2026-06-14');
    const p = buildSupplierPortrait({
      supplierId: 's1',
      name: '甲公司',
      participations: [],
      evaluations: [
        { finalGrade: 'B' as ExpertLevel, createdAt: now },
        { finalGrade: 'A' as ExpertLevel, createdAt: now },
      ],
    });
    expect(p.avgGradeScore).toBe(4.5);
    expect(p.evalCount).toBe(2);
    expect(p.levelCounts).toEqual({ A: 1, B: 1, C: 0, D: 0, E: 0 });
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
