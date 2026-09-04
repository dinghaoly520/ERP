import { pendingBondReturnWhere } from './bond-pending.util';

describe('pendingBondReturnWhere（A-105 共享谓词，终审 Critical#2）', () => {
  it('三键齐备：已提交 + 未退还 + 无不予退还终局理由', () => {
    expect(pendingBondReturnWhere()).toEqual({
      submitStatus: '已提交',
      bondReturnedAt: null,
      bondReturnReason: null,
    });
  });

  it('extra 并入（调度器传 projectId、定标 hook 传 winner 排除），不丢基础三键', () => {
    expect(pendingBondReturnWhere({ projectId: 'p1', supplierName: { not: '中标公司' } })).toEqual({
      submitStatus: '已提交',
      bondReturnedAt: null,
      bondReturnReason: null,
      projectId: 'p1',
      supplierName: { not: '中标公司' },
    });
  });
});
