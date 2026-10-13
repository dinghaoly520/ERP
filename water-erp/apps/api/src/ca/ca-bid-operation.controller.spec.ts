import { CaBidOperationController } from './ca-bid-operation.controller';
import { CaOperationService } from './ca-operation.service';
import { CaChallengeService } from './ca-challenge.service';

// ─── 全 mock 依赖 ───
const mockPrisma: any = {
  supplier: { findUnique: async (w: any) => ({ id: 'sup-1', userId: 'user-1' }) },
  caOperation: { findUnique: async (w: any) => ({ id: w?.where?.id || 'op-x', subjectId: 'user-1', purpose: 'submit', status: 'RUNNING', result: null }), update: async (w: any) => ({}), create: async (d: any) => ({ id: 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10) }) },
};

const mockChallenge = {
  hset: async () => 1, expire: async () => 1,
  eval: async () => 'CONSUMED', del: async () => 1,
  hget: async () => null,
};

function makeController() {
  const svc = new CaOperationService(mockPrisma as any);
  return new CaBidOperationController(
    mockPrisma as any,
    svc,
    new CaChallengeService(mockChallenge as any),
  );
}

describe('CaBidOperationController（prepare/signing-payload 接线）', () => {
  const ctrl = makeController();
  const mockReq = { user: { sub: 'user-1', sid: 'sid-1' }, headers: { origin: 'http://localhost:3004' } };
  const mockRes = { cookie: () => {}, clearCookie: () => {} };

  test('prepare 返回 operationId + context + canonical + expiresAt', async () => {
    const result = await ctrl.prepare('proj-1', { action: 'submit', baseRevision: 0 }, mockReq as any);
    expect(result.operationId).toBeTruthy();
    expect(result.context).toHaveProperty('projectId', 'proj-1');
    expect(result.context).toHaveProperty('supplierId', 'sup-1');
    expect(result.context).toHaveProperty('purpose', 'submit');
    expect(result.canonical).toContain('"operationId"');
    expect(result.expiresAt).toBeTruthy();
  });

  test('signing-payload 合法 v3 信封返回 canonical + sha256', async () => {
    // 先 prepare 拿到 operationId
    const prep = await ctrl.prepare('proj-1', { action: 'submit', baseRevision: 0 }, mockReq as any);
    const opId = prep.operationId;
    // 构造合法 v3 信封
    const envelope = {
      version: 'dual-v3', canonicalVersion: 'erp-json-v1', provider: 'scca',
      context: { projectId: 'proj-1', supplierId: 'sup-1', submissionId: 'sub-1', revision: 1, signingBindingId: 'b1', signingCertFingerprint: 'ee'.repeat(32) },
      files: { technical: { assetId: 'a1', plainSha256: 'aa'.repeat(32), plainBytes: 1024, innerSha256: 'bb'.repeat(32), innerBytes: 1040, outerSha256: 'cc'.repeat(32), outerBytes: 1056, kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'dd'.repeat(32), value: 'MII'.padEnd(200, 'X') }, kadmin: { format: 'sm2-c1c3c2-hex', adminCertId: 'ac1', value: '04' + 'ab'.repeat(64) } } },
      sealedFields: { cipherFormat: 'sm4-cbc-pkcs7-hex', cipher: 'ff'.repeat(32), cipherSha256: '11'.repeat(32), cipherBytes: 128, kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'dd'.repeat(32), value: 'MII'.padEnd(200, 'X') } },
      fieldsCommit: '22'.repeat(32),
    };
    // mock op lookup 返回有效操作
    mockPrisma.caOperation.findUnique = async () => ({ id: opId, subjectId: 'user-1', purpose: 'submit', status: 'VERIFYING' });
    const result = await ctrl.signingPayload('proj-1', opId, { envelope }, mockReq as any);
    expect(result.signatureFormat).toBe('scca-pkcs7-base64');
    expect(result.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.canonical).toContain('dual-v3');
  });

  test('signing-payload 非法信封→400 ENVELOPE_INVALID', async () => {
    mockPrisma.caOperation.findUnique = async () => ({ id: 'op-bad', subjectId: 'user-1', purpose: 'submit', status: 'VERIFYING' });
    try {
      await ctrl.signingPayload('proj-1', 'op-bad', { envelope: { version: 'not-v3' } }, mockReq as any);
      fail('should have thrown');
    } catch (e: any) {
      expect(e.getResponse?.()?.code).toBe('ENVELOPE_INVALID');
    }
  });

  test('signing-payload 操作不存在→404', async () => {
    mockPrisma.caOperation.findUnique = async () => null;
    try {
      await ctrl.signingPayload('proj-1', 'nonexistent', { envelope: {} }, mockReq as any);
      fail('should have thrown');
    } catch (e: any) {
      expect(e.getStatus()).toBe(404);
    }
  });
});
