import { CaAuthController } from './ca-auth.controller';
import { CaChallengeService } from './ca-challenge.service';
import { CaVerificationService } from './ca-verification.service';
import { CaEvidenceService } from './ca-evidence.service';
import { CaOperationService } from './ca-operation.service';

// ─── 全 mock 依赖（控制器是纯接线——逻辑归 Task 5 单测）───
const mockPrisma = {
  caCertificate: { findUnique: async () => null },
  supplierCert: { findFirst: async () => null },
  auditLog: { create: async () => ({}) },
  user: { findUnique: async () => null },
};
const mockAuthService = {
  rotatePortalSession: async () => ({ access_token: 'tok', role: 'supplier', username: 'test' }),
};
const mockRedis = {
  hset: async () => 1,
  expire: async () => 1,
  eval: async () => null,
  del: async () => 1,
};

describe('CaAuthController（接线验证——逻辑归 Task5 单测）', () => {
  const controller = new CaAuthController(
    mockPrisma as any,
    { verifyAsync: async () => null } as any, // JwtService（I8 新增注入）
    mockAuthService as any,
    new CaChallengeService(mockRedis as any),
    {} as CaVerificationService,  // challenge/login 不在此测——e2e 用 overrideProvider
    {} as CaEvidenceService,
    {} as CaOperationService,
  );

  test('GET /auth/ca/config 返回 enabled + portalSupport', async () => {
    const r = await controller.getConfig();
    expect(r).toHaveProperty('enabled');
    expect(r).toHaveProperty('portalSupport');
    expect(r).toHaveProperty('clientNote');
  });

  test('POST /auth/ca/login 未绑定证书 → 401 CA_CERT_NOT_BOUND', async () => {
    // mock challenge 已消费
    const redis2 = {
      ...mockRedis,
      eval: async () => 'LOGONDATA:{"signFingerprint":"abc"}', // 返回 toSign
    };
    const ctrl2 = new CaAuthController(
      mockPrisma as any,
      { verifyAsync: async () => null } as any,
      mockAuthService as any,
      new CaChallengeService(redis2 as any),
      { verifySignature: async () => ({ ok: true, statusCoverage: ['chain'], signerSerialHex: 'x' }) } as any,
      {} as CaEvidenceService,
      {} as CaOperationService,
    );
    // mockPrisma.caCertificate.findUnique 返回 null → CA_CERT_NOT_BOUND
    const mockRes = { cookie: () => {}, clearCookie: () => {} };
    const mockReq = { cookies: { ca_browser_supplier: 'test' }, headers: { origin: 'http://localhost:3004' } };
    try {
      await ctrl2.login({ challengeId: 'ch1', signP7: 'P7DATA' }, mockReq as any, mockRes as any);
      fail('should have thrown');
    } catch (e: any) {
      expect(e.getResponse?.()?.code).toBe('CA_CERT_NOT_BOUND');
    }
  });
});
