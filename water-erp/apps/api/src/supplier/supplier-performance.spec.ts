import { shouldAutoDisable } from './supplier-performance';

describe('shouldAutoDisable', () => {
  it('最近3次均为E → true', () => {
    expect(shouldAutoDisable([
      { finalGrade: 'E' }, { finalGrade: 'E' }, { finalGrade: 'E' },
    ] as any)).toBe(true);
  });
  it('最近3次有非E → false', () => {
    expect(shouldAutoDisable([
      { finalGrade: 'A' }, { finalGrade: 'E' }, { finalGrade: 'E' },
    ] as any)).toBe(false);
  });
  it('不足3次 → false', () => {
    expect(shouldAutoDisable([{ finalGrade: 'E' }, { finalGrade: 'E' }] as any)).toBe(false);
  });
});
