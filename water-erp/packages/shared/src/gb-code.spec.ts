import { buildGbProjectCode, buildGbProcureCode, buildGbSectionCode, buildSubjectCode } from './gb-code';

describe('GB/T 43711 B.4 组合码', () => {
  it('项目编码 18 位结构正确', () => {
    const code = buildGbProjectCode({
      industryCode: '511', regionCode: '51', platformSeq: '0001',
      date: new Date('2026-08-26'), projectSeq: 7,
    });
    expect(code).toBe('511510001260826007');
    expect(code).toHaveLength(18);
  });

  it('采购项目编码 21 位 = 项目编码 + 序列', () => {
    expect(buildGbProcureCode('511510001260826007', 1)).toBe('511510001260826007001');
  });

  it('标段编码 24 位，单标段默认 001', () => {
    expect(buildGbSectionCode('511510001260826007001')).toBe('511510001260826007001001');
    expect(buildGbSectionCode('511510001260826007001', 12)).toHaveLength(24);
  });

  it('非法输入抛错', () => {
    expect(() => buildGbProjectCode({ industryCode: '51', regionCode: '51', platformSeq: '0001', projectSeq: 1 })).toThrow();
    expect(() => buildGbProcureCode('123', 1)).toThrow();
    expect(() => buildGbSectionCode('511510001260826007001', 0)).toThrow();
  });

  it('主体编码 B+信用代码；非法/缺失返回 null', () => {
    expect(buildSubjectCode('91510000MA6CMJ0004')).toBe('B91510000MA6CMJ0004');
    expect(buildSubjectCode(null)).toBeNull();
    expect(buildSubjectCode('123')).toBeNull();
  });
});
