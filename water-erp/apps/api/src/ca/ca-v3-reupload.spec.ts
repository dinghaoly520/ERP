/**
 * dual-v3 补传链单测（阶段2.5 T1/T2）
 * T1：reupload-context 锚点自版本快照下发
 */
import { BadRequestException } from '@nestjs/common';
import { SupplierPortalService } from '../supplier-portal/supplier-portal.service';

const ENVELOPE = {
  version: 'dual-v3', canonicalVersion: 'erp-json-v1', provider: 'scca',
  context: { projectId: 'proj-1', supplierId: 'sup-1', submissionId: 'sub-1', revision: 1, signingBindingId: 'b', signingCertFingerprint: 'f'.repeat(64) },
  files: {
    technical: { assetId: 'fa-old', plainSha256: 'p'.repeat(64), plainBytes: 11, innerSha256: 'i'.repeat(64), innerBytes: 32, outerSha256: 'o'.repeat(64), outerBytes: 48, kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'e'.repeat(64), value: 'P7'.repeat(60) }, kadmin: { format: 'sm2-c1c3c2-hex', adminCertId: 'ac-1', value: '04' + 'ab'.repeat(32) } },
    business: { assetId: 'fa-b', plainSha256: 'b'.repeat(64), plainBytes: 9, innerSha256: 'n'.repeat(64), innerBytes: 32, outerSha256: 'u'.repeat(64), outerBytes: 48, kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'e'.repeat(64), value: 'P7'.repeat(60) }, kadmin: { format: 'sm2-c1c3c2-hex', adminCertId: 'ac-1', value: '04' + 'ab'.repeat(32) } },
  },
  sealedFields: { cipherFormat: 'sm4-cbc-pkcs7-hex', cipher: 'aa', cipherSha256: 'c'.repeat(64), cipherBytes: 2, kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'e'.repeat(64), value: 'P7'.repeat(60) } },
  fieldsCommit: 'a'.repeat(64),
};

const SUB = () => ({
  id: 'sub-1', supplierId: 'sup-1', projectId: 'proj-1', status: 'submitted',
  envelopeVersion: 'dual-v3', revision: 1, envelope: ENVELOPE,
});

const mkPrisma = (over: Record<string, any> = {}) => {
  const pick = (k: string, d: any) => (k in over ? over[k] : d);
  return {
    bidSupplier: { findFirst: jest.fn().mockResolvedValue(pick('bidSupplier', { id: 'bs-1', supplierId: 'sup-1', projectId: 'proj-1' })) },
    bidProject: { findUnique: jest.fn().mockResolvedValue(pick('project', { id: 'proj-1', stage: 'OPENING' })) },
    supplierBidSubmission: { findUnique: jest.fn().mockResolvedValue(pick('sub', SUB())) },
    submissionVersion: { findUnique: jest.fn().mockResolvedValue(pick('version', { envelope: ENVELOPE, envelopeHash: 'h'.repeat(64) })) },
  };
};

const mkSvc = (prisma: any) => new SupplierPortalService(
  prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  undefined, undefined, undefined,
);

describe('reupload-context（T1）', () => {
  test('dual-v3+OPENING+已递交 → 锚点自版本快照下发', async () => {
    const prisma = mkPrisma();
    const r = await mkSvc(prisma).getReuploadContext('sup-1', 'proj-1');
    expect(r.baseRevision).toBe(1);
    expect(r.fieldsCommit).toBe('a'.repeat(64));
    expect(r.roles).toEqual([
      { role: 'technical', plainSha256: 'p'.repeat(64), plainBytes: 11 },
      { role: 'business', plainSha256: 'b'.repeat(64), plainBytes: 9 },
    ]);
    expect(r.sealedFields.kself.format).toBe('scca-pkcs7-base64');
    // 锚点来源=SubmissionVersion 快照（防 submission 行内篡改）
    expect(prisma.submissionVersion.findUnique).toHaveBeenCalledWith({
      where: { submissionId_revision: { submissionId: 'sub-1', revision: 1 } },
    });
  });

  test('非 dual-v3 → 400 NOT_DUAL_TRACK', async () => {
    const prisma = mkPrisma({ sub: { ...SUB(), envelopeVersion: 'dual-v2' } });
    await expect(mkSvc(prisma).getReuploadContext('sup-1', 'proj-1')).rejects.toThrow(BadRequestException);
  });

  test('版本快照缺失 → 400 VERSION_SNAPSHOT_MISSING', async () => {
    const prisma = mkPrisma({ version: null });
    await expect(mkSvc(prisma).getReuploadContext('sup-1', 'proj-1')).rejects.toThrow(BadRequestException);
  });

  test('非 OPENING → 400 PROJECT_NOT_OPENING', async () => {
    const prisma = mkPrisma({ project: { id: 'proj-1', stage: 'EVALUATING' } });
    await expect(mkSvc(prisma).getReuploadContext('sup-1', 'proj-1')).rejects.toThrow(BadRequestException);
  });

  test('非成员 → 403 NOT_PROJECT_MEMBER', async () => {
    const prisma = mkPrisma({ bidSupplier: null });
    await expect(mkSvc(prisma).getReuploadContext('sup-1', 'proj-1')).rejects.toThrow(require('@nestjs/common').ForbiddenException);
  });
});
