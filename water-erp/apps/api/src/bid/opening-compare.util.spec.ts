import { resolveExpectedInYuan, isPriceMismatch, isPeriodMismatch } from './opening-compare.util';

describe('opening-compare.util', () => {
  it('resolveExpectedInYuan：万元投递价归一为元（79.8 vs 798000）', () => {
    expect(resolveExpectedInYuan('79.8', '798000')).toBe(798000);
  });
  it('resolveExpectedInYuan：同单位不做放大（950000 vs 980000 → 950000）', () => {
    expect(resolveExpectedInYuan('950000', '980000')).toBe(950000);
  });
  it('resolveExpectedInYuan：不可解析 → null', () => {
    expect(resolveExpectedInYuan(null, '980000')).toBeNull();
    expect(resolveExpectedInYuan('abc', '980000')).toBeNull();
  });
  it('isPriceMismatch：真实差异 → true（950000 vs 980000）', () => {
    expect(isPriceMismatch(resolveExpectedInYuan('950000', '980000'), '980000')).toBe(true);
  });
  it('isPriceMismatch：万元/元同一报价 → false', () => {
    expect(isPriceMismatch(resolveExpectedInYuan('79.8', '798000'), '798000')).toBe(false);
  });
  it('isPeriodMismatch：空白差异视为一致（"120 日历天" vs "120日历天"）', () => {
    expect(isPeriodMismatch('120 日历天', '120日历天')).toBe(false);
  });
  it('isPeriodMismatch：实质差异 → true；任一侧缺失 → false', () => {
    expect(isPeriodMismatch('120 日历天', '90 日历天')).toBe(true);
    expect(isPeriodMismatch(null, '90 日历天')).toBe(false);
    expect(isPeriodMismatch('', '90 日历天')).toBe(false);
  });
});
