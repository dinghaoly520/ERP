import { canonicalJson, computeDraftFingerprint } from './draft-fingerprint.util';

describe('draft-fingerprint util', () => {
  it('键顺序不影响指纹（canonical 序列化）', () => {
    const a = computeDraftFingerprint('OPEN', { x: '1', y: { b: 2, a: 3 } });
    const b = computeDraftFingerprint('OPEN', { y: { a: 3, b: 2 }, x: '1' });
    expect(a).toBe(b);
  });

  it('数组保序（顺序不同 → 指纹不同）', () => {
    const a = computeDraftFingerprint('OPEN', { list: ['1', '2'] });
    expect(computeDraftFingerprint('OPEN', { list: ['2', '1'] })).not.toBe(a);
  });

  it('任意值或类型变更 → 指纹变化', () => {
    const base = computeDraftFingerprint('OPEN', { x: '1' });
    expect(computeDraftFingerprint('OPEN', { x: '2' })).not.toBe(base);
    expect(computeDraftFingerprint('INQUIRY', { x: '1' })).not.toBe(base);
  });

  it('输出 64 位 hex', () => {
    expect(computeDraftFingerprint('OPEN', {})).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonicalJson 处理 null/数字/布尔', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(3)).toBe('3');
    expect(canonicalJson(true)).toBe('true');
  });
});
