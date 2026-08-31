import { sortSupplierRowsBySubmission } from './supplier-row-order.util';

const row = (name: string, submitted: boolean, withdrawn: boolean, at: string | null) =>
  ({ name, submitted, withdrawn, submission: at ? { submittedAt: at } : null });

describe('sortSupplierRowsBySubmission（A-100 按接收时间排序）', () => {
  it('已递交按 submittedAt 升序在前；未递交保持名册序；已撤回殿后', () => {
    const rows = [
      row('甲', false, false, null),                    // 名册1 未投
      row('乙', true, false, '2026-08-28T10:02:00Z'),   // 第二个递交
      row('丙', true, false, '2026-08-28T10:01:00Z'),   // 第一个递交
      row('丁', false, false, null),                    // 名册2 未投
      row('戊', true, true, '2026-08-28T09:00:00Z'),    // 已撤回
    ];
    expect(sortSupplierRowsBySubmission(rows).map(r => r.name)).toEqual(['丙', '乙', '甲', '丁', '戊']);
  });
  it('空数组/全未投原样返回', () => {
    expect(sortSupplierRowsBySubmission([])).toEqual([]);
    const rows = [row('甲', false, false, null), row('乙', false, false, null)];
    expect(sortSupplierRowsBySubmission(rows).map(r => r.name)).toEqual(['甲', '乙']);
  });
});
