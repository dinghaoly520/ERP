import { parseConflictedIds } from './expert.util';

describe('parseConflictedIds (P2 健壮解析)', () => {
  it('数组原样返回', () => {
    expect(parseConflictedIds(['s1', 's2'])).toEqual(['s1', 's2']);
  });

  it('JSON 字符串解析为数组', () => {
    expect(parseConflictedIds('["s1","s2"]')).toEqual(['s1', 's2']);
  });

  it('null/undefined/空串/坏字符串/非数组 JSON → 空数组', () => {
    expect(parseConflictedIds(null)).toEqual([]);
    expect(parseConflictedIds(undefined)).toEqual([]);
    expect(parseConflictedIds('')).toEqual([]);
    expect(parseConflictedIds('not-json')).toEqual([]);
    expect(parseConflictedIds('{"a":1}')).toEqual([]);
  });
});
