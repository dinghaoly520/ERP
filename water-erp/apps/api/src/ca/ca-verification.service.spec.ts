import * as fs from 'fs';
import * as path from 'path';
import { CaVerificationService } from './ca-verification.service';
import { SccaGatewayClient, GwVerifyResult } from './scca-gateway.client';

const fx = (name: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', 'scca', name), 'utf-8').trim();
const V1_P7 = fx('V1.p7.b64');
const V1_TXT = fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', 'scca', 'V1.txt')).toString('utf-8');
const V1D_P7 = fx('V1d.p7.b64');
const V7_P7 = fx('V7.p7.b64');
const V7_TXT = fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', 'scca', 'V7.txt')).toString('utf-8');

const SIGN_SERIAL = '4eb04e332bcf5e7e16cedf998cbd88eda62015e2';
const SIGN_SHA = '8dcdbaca9c0fcfe8c56a312cdc0dbbeb9e5a05d49f5340cabf3557c13e60426e';
const WRONG_SERIAL = 'ffffffffffffffffffffffffffffffffffffffff';
const WRONG_SHA = 'ff'.repeat(32);

// ─── mock gateway ───
const SIGN_CERT_B64 = 'MIIEJDCCA8igAwIBAgIUTrBOMyvPXn4Wzt+ZjL2I7aYgFeIwDAYIKoEcz1UBg3UFADCBgzELMAkGA1UEBhMCQ04xQDA+BgNVBAoMN1NpY2h1YW4gRGlnaXRhbCBDZXJ0aWZpY2F0ZSBBdXRob3JpdHkgTWFuYWdlbWVudCBDZW50ZXIxHzAdBgNVBAsMFlNNMiBDZXJ0aWZpY2F0ZSBTeXN0ZW0xETAPBgNVBAMMCFNDRUdCIENBMB4XDTI2MTAwOTAzMTk0NVoXDTI3MTAwOTAzMTk0NVowggEQMQswCQYDVQQGEwJDTjFAMD4GA1UECgw3U2ljaHVhbiBEaWdpdGFsIENlcnRpZmljYXRlIEF1dGhvcml0eSBNYW5hZ2VtZW50IENlbnRlcjEVMBMGA1UECwwMU0NFR0IgQ0EgU00yMRkwFwYDVQQLDBBQTjowMUBYTTIwMjUwOTE2MRswGQYDVQQLDBJJRDM6T3JnYW5pemF0aW9uYWwxDzANBgNVBAsMBk5PLjM6MTEgMB4GA1UECwwXTk8uMTo1MDA5OTkyMDI2MTAwOTExMTgxGzAZBgNVBAQMEjUwMDk5OTIwMjYxMDA5MTExODEgMB4GA1UEAwwX5L6b5bqU5ZWG5rWL6K+V5LyB5LiaMDEwWTATBgcqhkjOPQIBBggqgRzPVQGCLQNCAASWIy8TTzk/7ERAhZ0TdjOhNHJCTXb+J7j28TI2WsdrF//zgGZLPTZMes38mpnrMOk6N7P6ADzpWLZABknAbHAoo4IBhjCCAYIwDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCBsAwegYIKwYBBQUHAQEEbjBsMC8GCCsGAQUFBzABhiNodHRwczovL3RvcGNhLnNjY2EuY29tLmNuOjgwODUvb2NzcDA5BggrBgEFBQcwAoYtaHR0cDovL3RvcGNhLnNjY2EuY29tLmNuL2NhY2VydC9zY2VnYl9zbTIuY3J0MGUGA1UdHwReMFwwWqBYoFaGVGh0dHA6Ly90b3BjYS5zY2NhLmNvbS5jbi9wdWJsaWMvaXRydXNjcmw/Q0E9NzRFRDk0M0Y1QjY4QTlFNEREQUFFQzQ0RTI3MEFDN0MyNzYwNTZGQzAfBgNVHSMEGDAWgBRjCRy3YI0WOn3f5PrAVYjMI9x9uzAdBgNVHQ4EFgQUQvL30d2cbKi9VhodrFxCvzjRFTgwPwYDVR0gBDgwNjA0BggqgRyG8AYCAzAoMCYGCCsGAQUFBwIBFhpodHRwOi8vd3d3LnNjY2EuY29tLmNuL2NwczAMBggqgRzPVQGDdQUAA0gAMEUCIQC7zzc5mKpYxLy+HTARcRWjPPSRxjWd2sTKKiY2ob28UgIgQlkwCbh4kFc7SuAFSjGXwtM9+RJ4Mp9OihG3e6WnUb8='; // 完整 DER base64（从 S2-sign-cert.b64 PEM 体提取）

function makeMockGateway(override?: Partial<GwVerifyResult>): SccaGatewayClient {
  return {
    verifyPkcs7: async () => ({
      ok: true, resultCode: 0, resultMsg: 'OK',
      certSerialHex: SIGN_SERIAL, certBase64: SIGN_CERT_B64,
      ...override,
    }),
  } as unknown as SccaGatewayClient;
}

// ─── mock TrustStore（链校验单测不覆盖——Task 2 的 x509 测试已覆盖）───
const mockTrustStore = {
  verifyChain: () => ({ ok: true, reason: 'mock-pass' }),
};

const makeService = (gw?: SccaGatewayClient) => new CaVerificationService(gw ?? makeMockGateway(), mockTrustStore as any);

describe('CaVerificationService（World B 本地比对 + 三方指纹 + 算法闸）', () => {
  describe('正路：V1 + 正确原文 + 网关成功 → ok', () => {
    test('全链通过', async () => {
      const svc = makeService();
      const r = await svc.verifySignature({
        p7B64: V1_P7, expectedToSign: V1_TXT, purpose: 'ca-login',
        expectedSignCert: { serialHex: SIGN_SERIAL, sha256: SIGN_SHA },
      });
      expect(r.ok).toBe(true);
      expect(r.signerSerialHex).toBe(SIGN_SERIAL);
      expect(r.statusCoverage).toContain('chain');
      expect(r.statusCoverage).toContain('validity');
      expect(r.statusCoverage).toContain('usage');
      expect(r.statusCoverage).not.toContain('revocation'); // 永不含——阻断项如实记录
    });
  });

  describe('Review Focus ①：detached P7 冒充 → CA_CONTENT_MISMATCH', () => {
    test('V1d（真 detached 样本）+ 任意 toSign → 拒', async () => {
      const svc = makeService();
      const r = await svc.verifySignature({
        p7B64: V1D_P7, expectedToSign: V1_TXT, purpose: 'ca-login',
        expectedSignCert: { serialHex: SIGN_SERIAL, sha256: SIGN_SHA },
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('CA_CONTENT_MISMATCH');
    });
  });

  describe('Review Focus ②：旧 P7 重放到新挑战 → CA_CONTENT_MISMATCH', () => {
    test('V1 的 P7 + V7 的原文 → 拒（原文不匹配）', async () => {
      const svc = makeService();
      const r = await svc.verifySignature({
        p7B64: V1_P7, expectedToSign: V7_TXT, purpose: 'ca-login',
        expectedSignCert: { serialHex: SIGN_SERIAL, sha256: SIGN_SHA },
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('CA_CONTENT_MISMATCH');
    });
    test('V7 的 P7 + V1 的原文 → 拒（反向）', async () => {
      const svc = makeService();
      const r = await svc.verifySignature({
        p7B64: V7_P7, expectedToSign: V1_TXT, purpose: 'ca-login',
        expectedSignCert: { serialHex: SIGN_SERIAL, sha256: SIGN_SHA },
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('CA_CONTENT_MISMATCH');
    });
  });

  describe('Review Focus ④：三方指纹不一致', () => {
    test('B 盾期望 + A 盾 P7 → CA_FINGERPRINT_MISMATCH', async () => {
      const svc = makeService();
      const r = await svc.verifySignature({
        p7B64: V1_P7, expectedToSign: V1_TXT, purpose: 'ca-login',
        expectedSignCert: { serialHex: WRONG_SERIAL, sha256: SIGN_SHA },
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('CA_FINGERPRINT_MISMATCH');
    });
    test('网关返回 serial 不一致 → CA_FINGERPRINT_MISMATCH', async () => {
      const svc = makeService(makeMockGateway({ certSerialHex: WRONG_SERIAL }));
      const r = await svc.verifySignature({
        p7B64: V1_P7, expectedToSign: V1_TXT, purpose: 'ca-login',
        expectedSignCert: { serialHex: SIGN_SERIAL, sha256: SIGN_SHA },
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('CA_FINGERPRINT_MISMATCH');
    });
    test('证书 sha256 不在 embeddedCerts → CA_FINGERPRINT_MISMATCH', async () => {
      const svc = makeService();
      const r = await svc.verifySignature({
        p7B64: V1_P7, expectedToSign: V1_TXT, purpose: 'ca-login',
        expectedSignCert: { serialHex: SIGN_SERIAL, sha256: WRONG_SHA },
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('CA_FINGERPRINT_MISMATCH');
    });
  });

  describe('Review Focus ⑤：网关不可达 → CA_VERIFY_UNAVAILABLE', () => {
    test('mock 网关超时', async () => {
      const svc = makeService(makeMockGateway({ ok: false, errorKind: 'UNAVAILABLE', certSerialHex: null }));
      const r = await svc.verifySignature({
        p7B64: V1_P7, expectedToSign: V1_TXT, purpose: 'ca-login',
        expectedSignCert: { serialHex: SIGN_SERIAL, sha256: SIGN_SHA },
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('CA_VERIFY_UNAVAILABLE');
    });
  });

  describe('网关拒绝', () => {
    test('CERT_CHAIN → CA_CERT_CHAIN', async () => {
      const svc = makeService(makeMockGateway({ ok: false, errorKind: 'CERT_CHAIN', certSerialHex: null }));
      const r = await svc.verifySignature({ p7B64: V1_P7, expectedToSign: V1_TXT, purpose: 'ca-login' });
      expect(r.code).toBe('CA_CERT_CHAIN');
    });
    test('AUTH/PERMISSION/BUSINESS → CA_GATEWAY_REJECTED', async () => {
      for (const kind of ['AUTH', 'PERMISSION', 'BUSINESS'] as const) {
        const svc = makeService(makeMockGateway({ ok: false, errorKind: kind, certSerialHex: null }));
        const r = await svc.verifySignature({ p7B64: V1_P7, expectedToSign: V1_TXT, purpose: 'ca-login' });
        expect(r.code).toBe('CA_GATEWAY_REJECTED');
      }
    });
  });

  describe('算法白名单（Global Constraints）', () => {
    test('SM3+SM2 通过（真 P7 内嵌）', async () => {
      const svc = makeService();
      const r = await svc.verifySignature({ p7B64: V1_P7, expectedToSign: V1_TXT, purpose: 'ca-login' });
      expect(r.ok).toBe(true); // 真 P7 的算法就是 SM3+SM2
    });
  });

  describe('证书有效期与用途（网关回传 certBase64 时触发）', () => {
    test('certBase64=null 时跳过（仅网关+本地比对）', async () => {
      const svc = makeService(makeMockGateway({ certBase64: null }));
      const r = await svc.verifySignature({
        p7B64: V1_P7, expectedToSign: V1_TXT, purpose: 'ca-login',
        expectedSignCert: { serialHex: SIGN_SERIAL, sha256: SIGN_SHA },
      });
      expect(r.ok).toBe(true);
      // statusCoverage 无 'usage'（未触发证书解析）
      expect(r.statusCoverage).not.toContain('usage');
    });
  });
});
