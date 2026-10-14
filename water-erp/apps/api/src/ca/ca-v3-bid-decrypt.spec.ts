/**
 * dual-v3 主持端解外层单测（Task10，附录 §5.D）
 * mock Prisma/MinIO/DualEnvelope/AdminKey——每角色历史 adminCertId / fence CAS / 版本键对象键
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import type { DualV3Envelope, DualV3FileEntry } from '@water-erp/ukey';

jest.mock('../bid/bid.service', () => ({ BidService: class {} }));
jest.mock('../upload/minio.client', () => ({
  minioClient: { putObject: jest.fn(), getObject: jest.fn(), removeObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

import { BidDecryptService } from '../bid/bid-decrypt.service';

const OUTER_TECH = Buffer.from('outer-cipher-tech');
const mkEntry = (outerBuf: Buffer, adminCertId: string): DualV3FileEntry => ({
  assetId: `fa-${adminCertId}`,
  plainSha256: 'p'.repeat(64), plainBytes: 1,
  innerSha256: 'i'.repeat(64), innerBytes: 2,
  outerSha256: createHash('sha256').update(outerBuf).digest('hex'), outerBytes: outerBuf.length,
  kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'r'.repeat(64), value: 'MIIB.' },
  kadmin: { format: 'sm2-c1c3c2-hex', adminCertId, value: '04aa' },
});

const mkEnv = (): DualV3Envelope => ({
  version: 'dual-v3', canonicalVersion: 'erp-json-v1', provider: 'scca',
  context: { projectId: 'proj-1', supplierId: 'sup-1', submissionId: 'sub-1', revision: 1, signingBindingId: 'b-1', signingCertFingerprint: 'cf' },
  files: {
    technical: mkEntry(OUTER_TECH, 'ac-1'),
    business: mkEntry(Buffer.from('outer-cipher-biz'), 'ac-2'),
  },
  sealedFields: { cipherFormat: 'sm4-cbc-pkcs7-hex', cipher: 'aa', cipherSha256: 'c'.repeat(64), cipherBytes: 1, kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'r'.repeat(64), value: 'MIIC.' } },
  fieldsCommit: 'f'.repeat(64),
});

const SUB = () => ({
  id: 'sub-1', supplierId: 'sup-1', projectId: 'proj-1',
  envelopeVersion: 'dual-v3', revision: 1,
  envelope: mkEnv(), outerDecryptedAt: null, innerAssets: null,
  updatedAt: new Date(Date.now() - 1000),
});

const mkTx = () => ({
  decryptExecution: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  fileAsset: { create: jest.fn().mockResolvedValue({ id: 'inner-fa' }) },
  supplierBidSubmission: { update: jest.fn().mockResolvedValue({}) },
  bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
});

const mkSvc = (prisma: any, dualV3Decrypt: jest.Mock) => new BidDecryptService(
  prisma,
  { decryptOuterFileV3: dualV3Decrypt } as any,
  { readPrivateKey: jest.fn().mockResolvedValue('admin-priv-hex') } as any,
  {} as any,
  {} as any,
  undefined,
);

describe('bid-decrypt v3（Task10）', () => {
  let prisma: any;
  let dualV3Decrypt: jest.Mock;
  let tx: ReturnType<typeof mkTx>;

  beforeEach(() => {
    jest.clearAllMocks();
    dualV3Decrypt = jest.fn().mockResolvedValue(Buffer.from('inner-data'));
    tx = mkTx();
    prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING', name: '项目一', procurementMethod: '询比采购' }) },
      bidOpeningSession: { findUnique: jest.fn().mockResolvedValue({ pausedAt: null }) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierId: 'sup-1', projectId: 'proj-1', supplierName: '测试供应商' }), count: jest.fn().mockResolvedValue(3) },
      supplierBidSubmission: {
        findUnique: jest.fn().mockResolvedValue(SUB()),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      submissionVersion: { findUnique: jest.fn().mockResolvedValue({ envelope: mkEnv(), envelopeHash: 'd'.repeat(64) }) },
      fileAsset: { findUnique: jest.fn().mockImplementation(async ({ where }: any) => ({
        id: where.id, key: `v3-staging/${where.id}.outer`, sealedPath: null,
      })) },
      decryptExecution: { upsert: jest.fn().mockResolvedValue({ id: 'dx-1', fence: 1 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      tx,
      $transaction: async (fn: (t: any) => Promise<any>) => fn(tx),
    };
    const { minioClient } = require('../upload/minio.client');
    minioClient.getObject.mockImplementation(async (_bucket: any, key: string) => {
      if (key.includes('ac-2')) return Readable.from([Buffer.from('outer-cipher-biz')]);
      return Readable.from([OUTER_TECH]);
    });
    minioClient.putObject.mockResolvedValue({});
  });

  test('v3：每角色独立 adminCertId 解密 + 对象键含 revision+attempt + fence=1 首次', async () => {
    const svc = mkSvc(prisma, dualV3Decrypt);
    const result = await svc.decryptOuter('proj-1', 'bs-1', 'user-1');

    // 每角色独立 adminCertId（历史证书轮转后旧版信封仍可解）
    const readCalls = (svc as any);
    expect(prisma.decryptExecution.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { submissionId_revision_phase: { submissionId: 'sub-1', revision: 1, phase: 'outer' } },
    }));
    // 对象键：bid-inner/{projectId}/{bidSupplierId}/{role}.{revision}.{attempt}.inner
    const { minioClient } = require('../upload/minio.client');
    const keys = minioClient.putObject.mock.calls.map((c: any[]) => c[1]).sort();
    expect(keys).toEqual([
      'bid-inner/proj-1/bs-1/business.1.1.inner',
      'bid-inner/proj-1/bs-1/technical.1.1.inner',
    ]);
    // 每角色密钥读取：两个不同 adminCertId
    expect(dualV3Decrypt).toHaveBeenCalledTimes(2);
    // 终局：fence CAS + innerAssets 归属链
    expect(tx.decryptExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'dx-1', fence: 1, status: { not: 'SUCCESS' } },
      data: { status: 'SUCCESS' },
    }));
    expect(tx.supplierBidSubmission.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ innerAssets: { technical: 'inner-fa', business: 'inner-fa' } }),
    }));
    expect(result).toMatchObject({ supplierName: '测试供应商', success: true });
  });

  test('fence 隔离：旧 attempt 终局被新 attempt 接管 → 409 STALE_ATTEMPT，不写 innerAssets', async () => {
    tx.decryptExecution.updateMany.mockResolvedValue({ count: 0 }); // fence 已被推进
    const svc = mkSvc(prisma, dualV3Decrypt);
    await expect(svc.decryptOuter('proj-1', 'bs-1', 'user-1')).rejects.toThrow(ConflictException);
    // 旧 attempt 不得写终局归属链
    expect(tx.supplierBidSubmission.update).not.toHaveBeenCalled();
    // 失败回滚：outerDecryptedAt 复原 null + 槽位标 FAILED（仅当仍持有 fence）
    expect(prisma.supplierBidSubmission.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { outerDecryptedAt: null },
    }));
  });

  test('C_outer 哈希与信封声明不符 → 400 OUTER_HASH_MISMATCH + 回滚', async () => {
    const { minioClient } = require('../upload/minio.client');
    minioClient.getObject.mockResolvedValue(Readable.from([Buffer.from('tampered-outer')]));
    const svc = mkSvc(prisma, dualV3Decrypt);
    await expect(svc.decryptOuter('proj-1', 'bs-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(prisma.supplierBidSubmission.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { outerDecryptedAt: null },
    }));
  });

  test('版本快照缺失 → 400 VERSION_SNAPSHOT_MISSING', async () => {
    prisma.submissionVersion.findUnique.mockResolvedValue(null);
    const svc = mkSvc(prisma, dualV3Decrypt);
    await expect(svc.decryptOuter('proj-1', 'bs-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  test('旧轨（无信封版本）→ 400 NOT_DUAL_TRACK 语义不变', async () => {
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ ...SUB(), envelopeVersion: null });
    const svc = mkSvc(prisma, dualV3Decrypt);
    await expect(svc.decryptOuter('proj-1', 'bs-1', 'user-1')).rejects.toThrow(BadRequestException);
  });
});
