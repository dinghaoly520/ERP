import { lcsAlign } from './lcs';

const opsCode = (s: string, t: string) => lcsAlign(s, t).map((o) => o.op[0]).join('');

describe('lcsAlign', () => {
  it('returns all-keep when strings equal', () => {
    expect(opsCode('abc', 'abc')).toBe('kkk');
    expect(lcsAlign('abc', 'abc').map((o) => o.ch).join('')).toBe('abc');
  });

  it('aligns a pure insertion', () => {
    expect(opsCode('ac', 'abc')).toBe('kik');
    expect(lcsAlign('ac', 'abc').map((o) => o.ch).join('')).toBe('abc');
  });

  it('aligns a pure deletion', () => {
    const ops = lcsAlign('abc', 'ac');
    expect(ops.map((o) => o.ch).join('')).toBe('abc');
    expect(ops.filter((o) => o.op === 'del').map((o) => o.ch).join('')).toBe('b');
  });

  it('aligns a substitution (del+ins)', () => {
    const ops = lcsAlign('aXc', 'aYc');
    expect(ops.filter((o) => o.op === 'del').map((o) => o.ch).join('')).toBe('X');
    expect(ops.filter((o) => o.op === 'ins').map((o) => o.ch).join('')).toBe('Y');
  });

  it('handles CJK strings', () => {
    const ops = lcsAlign('招标范围', '招标内容');
    expect(ops.filter((o) => o.op === 'keep').map((o) => o.ch).join('')).toBe('招标');
  });
});
