import { wrapKey, unwrapKey, isWrappedKey } from './envelope-crypto';

const KMS = 'test-kms-secret-for-unit-tests';
const WRONG_KMS = 'wrong-kms-secret';

describe('envelope-crypto', () => {
  describe('wrapKey / unwrapKey round-trip', () => {
    const testVectors = [
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:0123456789abcdef0123:0123456789abcdef0123456789abcdef',
      'aaaa:bbbb:cccc',
      `${'a'.repeat(64)}:${'b'.repeat(24)}:${'c'.repeat(32)}`,
    ];

    test.each(testVectors)('wraps and unwraps a DEK correctly', (dek) => {
      const wrapped = wrapKey(dek, KMS);
      expect(typeof wrapped).toBe('string');
      expect(wrapped.length).toBeGreaterThan(0);
      // 应为 base64 格式
      expect(/^[A-Za-z0-9+/=]+$/.test(wrapped)).toBe(true);

      const unwrapped = unwrapKey(wrapped, KMS);
      expect(unwrapped).toBe(dek);
    });

    test('produces different ciphertexts for same DEK (random IV)', () => {
      const dek = 'aaaa:bbbb:cccc';
      const w1 = wrapKey(dek, KMS);
      const w2 = wrapKey(dek, KMS);
      expect(w1).not.toBe(w2);
    });
  });

  describe('unwrapKey error handling', () => {
    test('fails with wrong KMS_SECRET', () => {
      const dek = 'aaaa:bbbb:cccc';
      const wrapped = wrapKey(dek, KMS);
      expect(() => unwrapKey(wrapped, WRONG_KMS)).toThrow();
    });

    test('fails with empty string', () => {
      expect(() => unwrapKey('', KMS)).toThrow('wrappedBlob is empty');
    });

    test('fails with tampered blob', () => {
      const dek = 'aaaa:bbbb:cccc';
      const wrapped = wrapKey(dek, KMS);
      const tampered = wrapped.substring(0, wrapped.length - 4) + 'XXXX';
      expect(() => unwrapKey(tampered, KMS)).toThrow();
    });

    test('fails when KMS_SECRET is empty', () => {
      expect(() => wrapKey('aaaa:bbbb:cccc', '')).toThrow('KMS_SECRET is not configured');
      expect(() => unwrapKey('dGVzdA==', '')).toThrow('KMS_SECRET is not configured');
    });
  });

  describe('isWrappedKey', () => {
    test('returns false for null/undefined/empty', () => {
      expect(isWrappedKey(null)).toBe(false);
      expect(isWrappedKey(undefined)).toBe(false);
      expect(isWrappedKey('')).toBe(false);
    });

    test('returns false for hex DEK format', () => {
      const dek = 'abcdef:123456:7890ab';
      expect(isWrappedKey(dek)).toBe(false);
    });

    test('returns true for base64 wrapped blob', () => {
      const dek = 'aaaa:bbbb:cccc';
      const wrapped = wrapKey(dek, KMS);
      expect(isWrappedKey(wrapped)).toBe(true);
    });
  });

  describe('performance', () => {
    test('1000 wrap+unwrap under 2s', () => {
      const dek = `${'a'.repeat(64)}:${'b'.repeat(24)}:${'c'.repeat(32)}`;
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        const w = wrapKey(dek, KMS);
        unwrapKey(w, KMS);
      }
      expect(Date.now() - start).toBeLessThan(2000);
    });
  });
});
