import { BOND_STATUS, BOND_STATUS_OPTIONS, isBondQualified } from './bid-bond-status';

describe('bid-bond-status', () => {
  it('已缴纳 视为合格', () => {
    expect(isBondQualified(BOND_STATUS.PAID)).toBe(true);
  });

  it('保函有效 视为合格', () => {
    expect(isBondQualified(BOND_STATUS.GUARANTEE)).toBe(true);
  });

  it('未缴纳 视为不合格', () => {
    expect(isBondQualified(BOND_STATUS.UNPAID)).toBe(false);
  });

  it('异常 视为不合格', () => {
    expect(isBondQualified(BOND_STATUS.ABNORMAL)).toBe(false);
  });

  it('空值视为不合格（未核对）', () => {
    expect(isBondQualified(null)).toBe(false);
    expect(isBondQualified(undefined)).toBe(false);
    expect(isBondQualified('')).toBe(false);
  });

  it('未知字符串视为不合格', () => {
    expect(isBondQualified('随便填的')).toBe(false);
  });

  it('BOND_STATUS_OPTIONS 含 5 个固定值（含不适用档）', () => {
    expect(BOND_STATUS_OPTIONS).toEqual(['已缴纳', '保函有效', '未缴纳', '异常', '不适用']);
  });
});
