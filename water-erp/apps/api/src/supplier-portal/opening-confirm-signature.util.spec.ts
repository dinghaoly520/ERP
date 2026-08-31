import { buildOpeningConfirmCanonical } from './opening-confirm-signature.util';

describe('buildOpeningConfirmCanonical（A-114）', () => {
  const base = {
    projectId: 'p1', supplierId: 's1', bidSupplierId: 'bs1', recordId: 'r1',
    supplierName: '四川水发建设有限公司',
    amount: '980.00 万元', period: '120 日历天', qualityTarget: '合格',
    bondStatus: '已缴纳', decryptResult: 'SUCCESS',
  };
  it('键排序稳定且含 purpose 与唱标快照', () => {
    const a = buildOpeningConfirmCanonical({ ...base, purpose: 'confirm' });
    const b = buildOpeningConfirmCanonical({ ...base, purpose: 'confirm' });
    expect(a).toBe(b);
    expect(a).toContain('"purpose":"confirm"');
    expect(a).toContain('"openingRecord":{');
    expect(a.indexOf('amount') < a.indexOf('bondStatus')).toBe(true); // 递归排序
  });
  it('confirm 与 resign 的 canonical 不同（防交叉使用）', () => {
    expect(buildOpeningConfirmCanonical({ ...base, purpose: 'confirm' }))
      .not.toBe(buildOpeningConfirmCanonical({ ...base, purpose: 'resign' }));
  });
});
