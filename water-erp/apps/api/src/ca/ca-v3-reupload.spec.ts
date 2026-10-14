/**
 * dual-v3 补传链单测（阶段2.5 T1/T2）
 * T1：reupload-context 锚点自版本快照下发
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SupplierPortalService } from '../supplier-portal/supplier-portal.service';

const mockVerify = jest.fn().mockResolvedValue({ ok: true, signerSerialHex: 'aa', statusCoverage: ['chain'] });

jest.mock('../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn(), putObject: jest.fn(), removeObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));
import { Readable } from 'stream';
import { minioClient } from '../upload/minio.client';
beforeEach(() => { (minioClient.getObject as jest.Mock).mockReturnValue(Readable.from([Buffer.from('outer-cipher')])); });
const mockBidBackup = {
  stageBackup: jest.fn().mockImplementation(async (i: any) => ({ backupKey: `bk-${i.fileRole}`, ...i })),
  persistBackup: jest.fn().mockResolvedValue({}),
};

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

/* ══════════ T2：reuploadBidV3（六闸+CAS 版本推进+状态重置）══════════ */

// 新信封：与快照同 plainSha256/fieldsCommit/roles，新 assetId/密钥分量，revision=2
const mkNewEnvelope = (over: Record<string, any> = {}) => {
  const base = JSON.parse(JSON.stringify(ENVELOPE)) as any;
  base.context = { ...base.context, revision: 2 };
  for (const role of Object.keys(base.files)) {
    base.files[role].assetId = `fa-new-${role}`;
    base.files[role].outerSha256 = `n${role[0]}`.padEnd(64, '0');
  }
  const merged = { ...base, ...(({ context, files, ...r }: any = over) => (Object.keys(r).length ? { ...base, ...r } : base))(), context: { ...base.context, ...(over.context ?? {}) }, files: over.files ?? base.files };
  return merged;
};

const mkT2 = (over: Record<string, any> = {}) => {
  const newEnvelope = over.newEnvelope ?? mkNewEnvelope();
  const t = {
    supplierBidSubmission: {
      findUnique: jest.fn().mockResolvedValue(over.sub ?? SUB()),
      update: jest.fn().mockResolvedValue({}),
    },
    submissionVersion: {
      findUnique: jest.fn().mockResolvedValue(over.snapshot ?? { envelope: ENVELOPE, envelopeHash: 'h'.repeat(64) }),
      create: jest.fn().mockResolvedValue({}),
    },
    bidSupplier: {
      findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierId: 'sup-1', projectId: 'proj-1', supplierName: '测试供应商' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    caOperation: {
      findUnique: jest.fn().mockResolvedValue(over.op ?? {
        id: 'op-r', subjectId: 'sup-1', purpose: 'reupload', status: 'PAYLOAD_READY',
        result: { canonical: JSON.stringify(newEnvelope), canonicalSha256: 'n'.repeat(64) },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    bidProject: { findUnique: jest.fn().mockResolvedValue(over.project ?? { id: 'proj-1', stage: 'OPENING' }) },
    supplierBidSubmission: t.supplierBidSubmission,
    submissionVersion: t.submissionVersion,
    bidSupplier: t.bidSupplier,
    bidSupervisionLog: t.bidSupervisionLog,
    caOperation: t.caOperation,
    supplierCert: { findFirst: jest.fn().mockResolvedValue({ certSn: 'SN1', publicKey: '04ab', credentialScheme: 'scca-pkcs7', signingCaCertificate: { serialHex: 'aa', sha256Fingerprint: 'e'.repeat(64) } }) },
    supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'sup-1', name: '测试供应商', userId: 'user-1' }) },
    fileAsset: {
      findMany: jest.fn().mockResolvedValue(over.ownedAssets ?? [
        { id: 'fa-new-technical', uploaderId: 'user-1' }, { id: 'fa-new-business', uploaderId: 'user-1' },
      ]),
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
        // 新信封 entry.outerSha256 与 staged 资产 sha 对齐（默认一致；over.stagedSha 可注入不符）
        for (const [role, e] of Object.entries((newEnvelope as any).files)) {
          if ((e as any).assetId === where.id) {
            return { id: where.id, key: `v3-staging/${where.id}.outer`, sha256: over.stagedSha ?? (e as any).outerSha256 };
          }
        }
        return null;
      }),
    },
    tx: t,
    $transaction: async (fn: (x: any) => Promise<any>) => fn(t),
  };
  return prisma;
};

const mkSvcV = (prisma: any) => new SupplierPortalService(
  prisma, {} as any, {} as any, mockBidBackup as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  undefined, undefined, { verifySignature: mockVerify } as any,
);

const callReupload = (prisma: any, body: Record<string, any> = {}) =>
  mkSvcV(prisma).reuploadBidV3('sup-1', 'proj-1', {
    operationId: 'op-r', signatureFormat: 'scca-pkcs7-base64', signP7: 'MII.', baseRevision: 1, ...body,
  } as any);

describe('reuploadBidV3（T2）', () => {
  beforeEach(() => { mockVerify.mockClear(); mockVerify.mockResolvedValue({ ok: true, signerSerialHex: 'aa', statusCoverage: ['chain'] }); });

  test('成功：六闸过→revision 1→2+版本快照+状态重置+监督日志+op CAS commit', async () => {
    const prisma = mkT2();
    const r = await callReupload(prisma);
    expect(r).toEqual({ submissionId: 'sub-1', revision: 2 });
    expect(prisma.tx.submissionVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ submissionId: 'sub-1', revision: 2, envelopeHash: 'n'.repeat(64) }),
    }));
    expect(prisma.tx.supplierBidSubmission.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revision: 2, outerDecryptedAt: null, innerAssets: expect.anything() }),
    }));
    expect(prisma.tx.bidSupplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ decryptStatus: 'PENDING', decryptError: null, decryptedAt: null }),
    }));
    expect(prisma.tx.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: expect.stringContaining('v3 补传') }),
    }));
    expect(prisma.tx.caOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'op-r', status: 'PAYLOAD_READY' },
    }));
    // T4（阶段2.5）：补传重备——revision=2 新备份行（版本维度共存）
    expect(mockBidBackup.persistBackup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({}),
      expect.objectContaining({ cryptoVersion: 'dual-envelope-v3', submissionId: 'sub-1', revision: 2 }),
    );
  });

  test('Review Focus 1 改价闸：fieldsCommit ≠ 快照 → 400 FIELDS_COMMIT_CHANGED', async () => {
    const bad = mkNewEnvelope(); bad.fieldsCommit = 'f'.repeat(64);
    const prisma = mkT2({ newEnvelope: bad });
    await expect(callReupload(prisma)).rejects.toThrow(BadRequestException);
    expect(prisma.tx.submissionVersion.create).not.toHaveBeenCalled();
  });

  test('Review Focus 2 明文闸：plainSha256 ≠ 快照 → 400 PLAIN_HASH_MISMATCH', async () => {
    const bad = mkNewEnvelope(); bad.files.technical.plainSha256 = 'x'.repeat(64);
    const prisma = mkT2({ newEnvelope: bad });
    await expect(callReupload(prisma)).rejects.toThrow(BadRequestException);
  });

  test('角色保全闸：快照有 business 新信封缺 → 400 ROLE_LOST', async () => {
    const bad = mkNewEnvelope(); delete bad.files.business;
    const prisma = mkT2({ newEnvelope: bad });
    await expect(callReupload(prisma)).rejects.toThrow(BadRequestException);
  });

  test('外层实算闸：staged 资产 sha ≠ entry.outerSha256 → 400', async () => {
    const prisma = mkT2({ stagedSha: 'y'.repeat(64) });
    await expect(callReupload(prisma)).rejects.toThrow(BadRequestException);
  });

  test('context 闸：信封 revision ≠ base+1 → 400 ENVELOPE_CONTEXT_MISMATCH', async () => {
    const bad = mkNewEnvelope({ context: { revision: 1 } });
    const prisma = mkT2({ newEnvelope: bad });
    await expect(callReupload(prisma)).rejects.toThrow(BadRequestException);
  });

  test('归属闸：新 assetId 他人上传 → 400 FILE_NOT_OWNED', async () => {
    const prisma = mkT2({ ownedAssets: [{ id: 'fa-new-technical', uploaderId: 'user-OTHER' }] });
    await expect(callReupload(prisma)).rejects.toThrow(BadRequestException);
  });

  test('CAS：baseRevision ≠ 服务端现值 → 409 REVISION_CONFLICT（context 已按新 revision 对齐）', async () => {
    const env4 = mkNewEnvelope(); env4.context.revision = 4;
    const prisma = mkT2({ sub: { ...SUB(), revision: 3 }, newEnvelope: env4 });
    await expect(callReupload(prisma, { baseRevision: 1 })).rejects.toThrow(ConflictException);
    expect(prisma.tx.submissionVersion.create).not.toHaveBeenCalled();
  });

  test('P2002 → 409 REVISION_CONFLICT（非裸 500）', async () => {
    const prisma = mkT2();
    prisma.tx.submissionVersion.create.mockRejectedValue({ code: 'P2002' });
    await expect(callReupload(prisma)).rejects.toThrow(ConflictException);
  });

  test('op 非 PAYLOAD_READY（重放）→ 409 OPERATION_NOT_COMMITTABLE', async () => {
    const prisma = mkT2({ op: { id: 'op-r', subjectId: 'sup-1', purpose: 'reupload', status: 'COMMITTED', result: { canonical: JSON.stringify(mkNewEnvelope()) } } });
    await expect(callReupload(prisma)).rejects.toThrow(ConflictException);
  });

  test('阶段门：非 OPENING → 400 PROJECT_NOT_OPENING', async () => {
    const prisma = mkT2({ project: { id: 'proj-1', stage: 'EVALUATING' } });
    await expect(callReupload(prisma)).rejects.toThrow(BadRequestException);
  });
});
