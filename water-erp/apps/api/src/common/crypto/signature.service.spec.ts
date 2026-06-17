import { Test, TestingModule } from '@nestjs/testing';
import { SignatureService } from './signature.service';

describe('SignatureService', () => {
  let service: SignatureService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SignatureService],
    }).compile();
    service = module.get(SignatureService);
  });

  describe('generateKeyPair', () => {
    it('generates a valid SM2 key pair', () => {
      const kp = service.generateKeyPair();
      expect(kp.publicKey).toMatch(/^04[0-9a-f]{128}$/);
      expect(kp.privateKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates different keys each time', () => {
      const kp1 = service.generateKeyPair();
      const kp2 = service.generateKeyPair();
      expect(kp1.publicKey).not.toBe(kp2.publicKey);
      expect(kp1.privateKey).not.toBe(kp2.privateKey);
    });
  });

  describe('sign / verify round-trip', () => {
    it('verifies a valid signature', () => {
      const kp = service.generateKeyPair();
      const message = 'bid-file-hash-' + Date.now();
      const sig = service.sign(message, kp.privateKey);
      expect(sig).toBeTruthy();
      expect(service.verify(message, sig, kp.publicKey)).toBe(true);
    });

    it('rejects a signature with wrong message', () => {
      const kp = service.generateKeyPair();
      const sig = service.sign('original-message', kp.privateKey);
      expect(service.verify('tampered-message', sig, kp.publicKey)).toBe(false);
    });

    it('rejects a signature with wrong public key', () => {
      const kp1 = service.generateKeyPair();
      const kp2 = service.generateKeyPair();
      const sig = service.sign('message', kp1.privateKey);
      expect(service.verify('message', sig, kp2.publicKey)).toBe(false);
    });
  });

  describe('isValidPublicKey', () => {
    it('returns true for valid 04-prefixed hex key', () => {
      const kp = service.generateKeyPair();
      expect(service.isValidPublicKey(kp.publicKey)).toBe(true);
    });

    it('returns false for null/undefined/empty', () => {
      expect(service.isValidPublicKey(null)).toBe(false);
      expect(service.isValidPublicKey(undefined)).toBe(false);
      expect(service.isValidPublicKey('')).toBe(false);
    });

    it('returns false for invalid format', () => {
      expect(service.isValidPublicKey('not-a-key')).toBe(false);
      expect(service.isValidPublicKey('03' + 'aa'.repeat(64))).toBe(false); // compressed
    });
  });

  describe('verify edge cases', () => {
    it('returns false when publicKey is missing', () => {
      expect(service.verify('hash', 'sig', '')).toBe(false);
    });

    it('returns false when signature is missing', () => {
      const kp = service.generateKeyPair();
      expect(service.verify('hash', '', kp.publicKey)).toBe(false);
    });
  });
});
