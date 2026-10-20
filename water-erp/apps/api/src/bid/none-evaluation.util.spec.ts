import { isNoneEvaluation } from './none-evaluation.util';

/** none（直接采购族）免评分标准谓词——:3005 03 闸与 :3007 G9 共用口径（spec 2026-10-19 §4.1）。
 *  evaluationMethod 显式值优先；缺省时按采购方式经 PROCUREMENT_EVALUATION_MAP 派生
 *  （防未来创建路径漏写默认值重演死锁；谈判/邀请 null 派生≠none，既有闸行为零变化）。 */
describe('isNoneEvaluation', () => {
  it('none → true；manual/comprehensive/lowest_price/null/undefined → false', () => {
    expect(isNoneEvaluation('none')).toBe(true);
    expect(isNoneEvaluation('manual')).toBe(false);
    expect(isNoneEvaluation('comprehensive')).toBe(false);
    expect(isNoneEvaluation('lowest_price')).toBe(false);
    expect(isNoneEvaluation(null)).toBe(false);
    expect(isNoneEvaluation(undefined)).toBe(false);
  });

  it('evaluationMethod 缺省按采购方式派生：直接采购→true、谈判采购→false', () => {
    expect(isNoneEvaluation(null, '直接采购')).toBe(true);
    expect(isNoneEvaluation(null, '谈判采购')).toBe(false);
  });
});
