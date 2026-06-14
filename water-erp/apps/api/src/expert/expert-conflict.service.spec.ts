import { normalizeName, detectConflicts } from './expert-conflict.service';

describe('normalizeName', () => {
  it('去除有限公司/有限责任公司/公司/集团等后缀', () => {
    expect(normalizeName('蜀水建设有限公司')).toBe('蜀水建设');
    expect(normalizeName('蜀水建设有限责任公司')).toBe('蜀水建设');
    expect(normalizeName('蜀水建设集团')).toBe('蜀水建设');
  });
  it('小写化', () => { expect(normalizeName('ABC科技')).toBe('abc科技'); });
});

describe('detectConflicts', () => {
  const suppliers = [
    { supplierName: '蜀水建设有限公司', legalPerson: '张三' },
    { supplierName: '北方水利', legalPerson: '李四' },
  ];
  it('专家单位与某供应商名称归一化后相同 → 冲突', () => {
    const c = detectConflicts('蜀水建设有限责任公司', suppliers as any);
    expect(c).toHaveLength(1);
    expect(c[0].supplierName).toBe('蜀水建设有限公司');
    expect(c[0].reason).toContain('工作单位');
  });
  it('无匹配 → 空', () => {
    expect(detectConflicts('无关单位', suppliers as any)).toHaveLength(0);
  });
});
