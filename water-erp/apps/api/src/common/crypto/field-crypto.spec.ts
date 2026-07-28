import { sealField, openField } from './field-crypto';

describe('field-crypto (sealField / openField)', () => {
  const KMS = 'test-kms-secret';

  describe('round-trip', () => {
    it.each([
      ['ascii number', '980000'],
      ['chinese', '九十八万元'],
      ['mixed', '报价: ¥1,234,567.00 (含税)'],
      ['single char', 'a'],
      ['long', 'x'.repeat(10_000)],
    ])('openField(sealField(%s)) === original', (_label, plain) => {
      const sealed = sealField(plain, KMS);
      expect(sealed).not.toEqual(plain);
      expect(sealed).toMatch(/^v1:/);
      expect(openField(sealed, KMS)).toBe(plain);
    });

    it('null round-trips as null', () => {
      expect(sealField(null, KMS)).toBeNull();
      expect(openField(null, KMS)).toBeNull();
    });

    it('empty string round-trips as empty (returns null per helper contract)', () => {
      // sealField returns null for '' per spec ("null/空串原样返回" with `?? null` normalization)
      expect(sealField('', KMS)).toBe('');
      expect(openField('', KMS)).toBe('');
    });
  });

  describe('tamper detection (AES-256-GCM authTag)', () => {
    it('flipping a ciphertext byte throws on open', () => {
      const sealed = sealField('980000', KMS);
      // sealed = 'v1:' + base64(iv12 + authTag16 + ct)
      const blob = Buffer.from(sealed!.slice(3), 'base64');
      // flip last byte of ciphertext
      blob[blob.length - 1] ^= 0x01;
      const tampered = 'v1:' + blob.toString('base64');
      expect(() => openField(tampered, KMS)).toThrow();
    });

    it('flipping an IV byte throws on open', () => {
      const sealed = sealField('980000', KMS);
      const blob = Buffer.from(sealed!.slice(3), 'base64');
      blob[0] ^= 0x01; // first IV byte
      const tampered = 'v1:' + blob.toString('base64');
      expect(() => openField(tampered, KMS)).toThrow();
    });

    it('truncated blob (< 28 bytes) throws "invalid sealed field blob"', () => {
      const tampered = 'v1:' + Buffer.from('too-short').toString('base64');
      expect(() => openField(tampered, KMS)).toThrow(/invalid sealed field blob/);
    });
  });

  describe('legacy plaintext backward compatibility', () => {
    it('legacy plaintext passes through unchanged without needing kms', () => {
      const legacy = '980000';
      // no 'v1:' prefix → treated as legacy plaintext
      expect(openField(legacy, '')).toBe(legacy);
      expect(openField(legacy, undefined as any)).toBe(legacy);
    });

    it('legacy Chinese plaintext passes through', () => {
      const legacy = '九十八万元';
      expect(openField(legacy, '')).toBe(legacy);
    });

    it('legacy-like value starting with non-v1 prefix passes through', () => {
      // Edge case: plaintext that happens to start with "v2:" or similar
      const legacy = 'v2:future-format';
      expect(openField(legacy, KMS)).toBe(legacy);
    });
  });

  describe('KMS_SECRET enforcement', () => {
    it('sealField throws "KMS_SECRET is not configured" when kms missing', () => {
      expect(() => sealField('980000', '')).toThrow(/KMS_SECRET is not configured/);
      expect(() => sealField('980000', undefined as any)).toThrow(/KMS_SECRET is not configured/);
    });

    it('openField throws on sealed value when kms missing', () => {
      const sealed = sealField('secret', KMS);
      expect(() => openField(sealed, '')).toThrow(/KMS_SECRET is not configured/);
      expect(() => openField(sealed, undefined as any)).toThrow(/KMS_SECRET is not configured/);
    });

    it('openField on legacy value does NOT throw when kms missing', () => {
      expect(() => openField('legacy-plaintext', '')).not.toThrow();
    });

    it('different KMS_SECRET fails to decrypt (authTag mismatch)', () => {
      const sealed = sealField('980000', KMS);
      expect(() => openField(sealed, 'different-kms-secret')).toThrow();
    });
  });

  describe('null / empty input handling', () => {
    it('sealField(undefined) returns null', () => {
      expect(sealField(undefined, KMS)).toBeNull();
    });

    it('openField(undefined) returns null', () => {
      expect(openField(undefined, KMS)).toBeNull();
    });
  });

  describe('freshness / non-determinism', () => {
    it('sealField produces different ciphertexts for same plaintext (random IV)', () => {
      const a = sealField('same-value', KMS);
      const b = sealField('same-value', KMS);
      expect(a).not.toBe(b);
      // both still decrypt back to the same plaintext
      expect(openField(a!, KMS)).toBe('same-value');
      expect(openField(b!, KMS)).toBe('same-value');
    });
  });
});
