import { computeRiskFactors, riskLevel, clamp01 } from './risk-score.compute';

describe('clamp01', () => {
  it('限定到 0-100', () => {
    expect(clamp01(150)).toBe(100);
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(73)).toBe(73);
  });
});

describe('computeRiskFactors', () => {
  const ctx = {
    decryptStatus: 'SUCCESS',
    fileCount: 3, fileTotal: 3,
    validQualifications: 4, expiredQualifications: 1,
    bidPrice: 950000, budget: 1000000,
    perfCount: 5,
  } as any;

  it('文件齐全 + 解密成功 → 文件/解密因子高分', () => {
    const f = computeRiskFactors(ctx);
    expect(f.find(x => x.name === '文件完整性')!.score).toBeGreaterThanOrEqual(90);
    expect(f.find(x => x.name === '解密状态')!.score).toBe(100);
  });
  it('报价低于预算 5% → 报价风险因子高', () => {
    const f = computeRiskFactors(ctx);
    const price = f.find(x => x.name === '报价风险')!;
    expect(price.score).toBeGreaterThanOrEqual(80);
    expect(price.detail).toContain('偏离');
  });
  it('报价远超预算 → 报价风险因子低', () => {
    const f = computeRiskFactors({ ...ctx, bidPrice: 1800000 });
    expect(f.find(x => x.name === '报价风险')!.score).toBeLessThan(60);
  });
  it('历史履约有数据 → 基础分 60 并标注次数；无数据 → 低分并标注', () => {
    const withPerf = computeRiskFactors(ctx).find(x => x.name === '历史履约')!;
    expect(withPerf.score).toBe(60);
    expect(withPerf.detail).toContain('已评价 5 次');
    const hist = computeRiskFactors({ ...ctx, perfCount: 0 }).find(x => x.name === '历史履约')!;
    expect(hist.score).toBeLessThan(60);
    expect(hist.detail).toContain('无履约数据');
  });
  it('所有因子分数在 0-100', () => {
    const c = computeRiskFactors(ctx);
    expect(c.every(f => f.score >= 0 && f.score <= 100)).toBe(true);
  });
});

describe('riskLevel', () => {
  it('≥85 低风险，≥65 中风险，否则高风险', () => {
    expect(riskLevel(90)).toBe('低风险');
    expect(riskLevel(70)).toBe('中风险');
    expect(riskLevel(40)).toBe('高风险');
  });
});
