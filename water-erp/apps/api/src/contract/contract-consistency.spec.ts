import { checkContractConsistency } from './contract-consistency';

describe('checkContractConsistency（GB/T 43711 7.5.4.3）', () => {
  it('成交人与金额一致 → consistent', () => {
    const r = checkContractConsistency(
      { supplierName: '甲公司', amount: '680000.00' },
      { from: 'evaluation', supplierName: '甲公司', price: 680000 },
    );
    expect(r.consistent).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.manualConfirm).toBe(false);
  });

  it('成交人不一致 → supplier issue', () => {
    const r = checkContractConsistency(
      { supplierName: '乙公司', amount: 680000 },
      { from: 'award_letter', supplierName: '甲公司', price: 680000 },
    );
    expect(r.consistent).toBe(false);
    expect(r.issues[0].field).toBe('supplier');
  });

  it('金额不一致（≥1 分）→ amount issue；序列化尾差容忍', () => {
    const r = checkContractConsistency(
      { supplierName: '甲公司', amount: 680000.005 },
      { from: 'evaluation', supplierName: '甲公司', price: '680000.00' },
    );
    expect(r.consistent).toBe(true);

    const r2 = checkContractConsistency(
      { supplierName: '甲公司', amount: 680001 },
      { from: 'evaluation', supplierName: '甲公司', price: 680000 },
    );
    expect(r2.consistent).toBe(false);
    expect(r2.issues[0].field).toBe('amount');
  });

  it('一侧金额缺失不判不一致（登记制后补）', () => {
    const r = checkContractConsistency(
      { supplierName: '甲公司', amount: null },
      { from: 'announcement', supplierName: '甲公司', price: 680000 },
    );
    expect(r.consistent).toBe(true);
  });

  it('无线上成交源（线下成交）→ manualConfirm', () => {
    const r = checkContractConsistency({ supplierName: '甲公司' }, { from: 'none' });
    expect(r.manualConfirm).toBe(true);
    expect(r.consistent).toBe(true);
  });
});
