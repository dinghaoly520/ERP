import { evaluateBondCompliance } from '@water-erp/shared';

describe('evaluateBondCompliance（A-104）', () => {
  const ok = { hasLedger: true, amount: 500000, arrivedAt: '2026-08-01T08:00:00+08:00', payMethod: '转账', requiredAmount: 500000, deadline: '2026-08-01T17:00:00+08:00', bondStatus: '已缴纳' };
  it('全符合作空 issues', () => expect(evaluateBondCompliance(ok)).toEqual([]));
  it('无台账 → LEDGER_MISSING', () => expect(evaluateBondCompliance({ ...ok, hasLedger: false, amount: null, arrivedAt: null, payMethod: null })).toEqual([expect.objectContaining({ field: 'LEDGER_MISSING' })]));
  it('金额不足 → AMOUNT', () => expect(evaluateBondCompliance({ ...ok, amount: 400000 })).toEqual([expect.objectContaining({ field: 'AMOUNT' })]));
  it('到账晚于截标 → ARRIVAL', () => expect(evaluateBondCompliance({ ...ok, arrivedAt: '2026-08-02T09:00:00+08:00' })).toEqual([expect.objectContaining({ field: 'ARRIVAL' })]));
  it('保函形式但唱标录「已缴纳」 → PAY_METHOD', () => expect(evaluateBondCompliance({ ...ok, payMethod: '保函' })).toEqual([expect.objectContaining({ field: 'PAY_METHOD' })]));
  it('转账形式但唱标录「保函有效」 → PAY_METHOD（反向维）', () => expect(evaluateBondCompliance({ ...ok, payMethod: '转账', bondStatus: '保函有效' })).toEqual([expect.objectContaining({ field: 'PAY_METHOD' })]));
  it('requiredAmount 未设不比金额', () => expect(evaluateBondCompliance({ ...ok, requiredAmount: null, amount: 1 })).toEqual([]));
  it('缺凭证 → VOUCHER（有台账）', () => expect(evaluateBondCompliance({ ...ok, hasVoucher: false })).toEqual([expect.objectContaining({ field: 'VOUCHER' })]));
  it('无台账且缺凭证 → LEDGER_MISSING + VOUCHER', () => expect(evaluateBondCompliance({ ...ok, hasLedger: false, amount: null, arrivedAt: null, payMethod: null, hasVoucher: false }))
    .toEqual([expect.objectContaining({ field: 'LEDGER_MISSING' }), expect.objectContaining({ field: 'VOUCHER' })]));
  it('hasVoucher=null 跳过凭证维', () => expect(evaluateBondCompliance({ ...ok, hasVoucher: null })).toEqual([]));
});
