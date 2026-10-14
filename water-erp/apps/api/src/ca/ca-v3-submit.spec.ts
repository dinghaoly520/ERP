/**
 * dual-v3 submitBidV3 行为级单测（评审修复轮——替换原空转 spec）
 * 覆盖：C2 名册/serverSubmittedAt 落库、I1 baseRevision CAS+P2002→409、
 *      I2 操作单次性 CAS commit、I6 assetId 归属、I7 context 交叉
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SupplierPortalService } from '../supplier-portal/supplier-portal.service';

jest.mock('../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn(), putObject: jest.fn(), removeObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));
import { Readable } from 'stream';
import { minioClient } from '../upload/minio.client';
beforeEach(() => { (minioClient.getObject as jest.Mock).mockReturnValue(Readable.from([Buffer.from('outer-cipher')])); });

const mockVerify = jest.fn();
const mockBidBackup = {
  stageBackup: jest.fn().mockImplementation(async (i: any) => ({ backupKey: `bk-${i.fileRole}`, ...i })),
  persistBackup: jest.fn().mockResolvedValue({}),
};

const BASE_CTX = { projectId: 'proj-1', supplierId: 'sup-1', submissionId: '', revision: 1, signingBindingId: 'b-1', signingCertFingerprint: 'f'.repeat(64) };
const mkEnvelope = (over: Record<string, any> = {}) => ({
  version: 'dual-v3', canonicalVersion: 'erp-json-v1', provider: 'scca',
  context: { ...BASE_CTX, ...(over.context ?? {}) },
  files: { technical: { assetId: 'fa-mine', plainSha256: 'p'.repeat(64), plainBytes: 1, innerSha256: 'i'.repeat(64), innerBytes: 2, outerSha256: 'o'.repeat(64), outerBytes: 3, kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'e'.repeat(64), value: 'P7'.repeat(60) }, kadmin: { format: 'sm2-c1c3c2-hex', adminCertId: 'ac-1', value: '04' + 'ab'.repeat(32) } } },
  sealedFields: { cipherFormat: 'sm4-cbc-pkcs7-hex', cipher: 'aa', cipherSha256: 'c'.repeat(64), cipherBytes: 1, kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'e'.repeat(64), value: 'P7'.repeat(60) } },
  fieldsCommit: 'a'.repeat(64),
  ...(({ context, ...rest }: any = over) => rest)(),
});

const tx = () => ({
  supplierBidSubmission: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'sub-1', revision: 0, status: 'submitted' }),
    update: jest.fn().mockResolvedValue({}),
  },
  bidSupplier: {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  },
  submissionVersion: { create: jest.fn().mockResolvedValue({}) },
  outbox: { create: jest.fn().mockResolvedValue({}) },
  caOperation: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
});

const mkSvc = (prisma: any) => new SupplierPortalService(
  prisma, {} as any, {} as any, mockBidBackup as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  undefined, undefined, { verifySignature: mockVerify } as any,
);

describe('submitBidV3（评审修复轮）', () => {
  let prisma: any;
  let t: ReturnType<typeof tx>;
  beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockResolvedValue({ ok: true, signerSerialHex: 'aa', statusCoverage: ['chain'] });
    t = tx();
    prisma = {
      caOperation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'op-1', subjectId: 'sup-1', purpose: 'submit', status: 'PAYLOAD_READY',
          result: { canonical: JSON.stringify(mkEnvelope()), canonicalSha256: 'c'.repeat(64) },
        }),
      },
      supplierCert: { findFirst: jest.fn().mockResolvedValue({ certSn: 'SN1', publicKey: '04ab', credentialScheme: 'scca-pkcs7', signingCaCertificate: { serialHex: 'aa', sha256Fingerprint: 'e'.repeat(64) } }) },
      // submitBid 前置链（self 检查/I6 归属查询共用）+ v3 事务
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'sup-1', name: '测试供应商', userId: 'user-1', status: 'APPROVED', isTemporary: false }) },
      supplierBidSubmission: { findUnique: jest.fn().mockResolvedValue(null) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'proj-1', stage: 'SUBMIT', deadline: new Date(Date.now() + 86400000), procurementMethod: '公开招标', projectManagementItemId: null, bondRequired: false }) },
      announcement: { findFirst: jest.fn().mockResolvedValue({ id: 'a-1' }) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue(null) },
      fileAsset: {
        findMany: jest.fn().mockResolvedValue([{ id: 'fa-mine', uploaderId: 'user-1' }]),
        findUnique: jest.fn().mockResolvedValue({ id: 'fa-mine', key: 'v3-staging/x.outer' }),
      },
      tx: t,
      $transaction: async (fn: (x: any) => Promise<any>) => fn(t),
    };
  });

  const call = (over: Record<string, any> = {}) =>
    mkSvc(prisma).submitBid('sup-1', 'proj-1', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MII.', ...over,
    } as any);

  test('成功：名册写入+receiptNo 生成+serverSubmittedAt 落列+操作 CAS commit', async () => {
    const result = await call();
    expect(result).toEqual({ submissionId: 'sub-1', revision: 1 });
    // C2：BidSupplier 名册（投递即入册——开标名单/回执编号数据源）
    expect(t.bidSupplier.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: 'proj-1', supplierId: 'sup-1', supplierName: '测试供应商',
        submitStatus: '已提交', receiptNo: expect.stringMatching(/^TB-\d{8}-\d{3}$/),
      }),
    }));
    // C2：serverSubmittedAt（审计信任锚点）随递交落列（首投随 create；重投随 status update）
    expect(t.supplierBidSubmission.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'submitted', serverSubmittedAt: expect.any(Date) }),
    }));
    expect(t.supplierBidSubmission.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revision: 1, envelopeVersion: 'dual-v3' }),
    }));
    expect(t.submissionVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ submissionId: 'sub-1', revision: 1, envelopeHash: 'c'.repeat(64) }),
    }));
    // I2：操作 commit 走条件 CAS（PAYLOAD_READY→COMMITTED 单次）
    expect(t.caOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'op-1', status: 'PAYLOAD_READY' },
      data: expect.objectContaining({ status: 'COMMITTED' }),
    }));
    // T4（阶段2.5）：未解密备份固化——每 role 一条，双钥合账 + 版本维度
    expect(mockBidBackup.stageBackup).toHaveBeenCalledWith(expect.objectContaining({
      fileRole: 'technical',
      sealedPath: expect.any(String),
      wrappedDek: expect.stringContaining('kadmin'),
      plaintextSha256: 'p'.repeat(64),
    }));
    expect(mockBidBackup.persistBackup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileRole: 'technical' }),
      expect.objectContaining({ cryptoVersion: 'dual-envelope-v3', submissionId: 'sub-1', revision: 1 }),
    );
  });

  test('I1：baseRevision 与服务端不符 → 409 REVISION_CONFLICT（客户端 CAS）', async () => {
    t.supplierBidSubmission.findUnique.mockResolvedValue({ id: 'sub-1', revision: 2, status: 'withdrawn' });
    t.supplierBidSubmission.update.mockResolvedValue({});
    await expect(call({ baseRevision: 1 })).rejects.toThrow(ConflictException);
  });

  test('I1：SubmissionVersion 唯一索引 P2002 → 409 REVISION_CONFLICT（非裸 500）', async () => {
    t.submissionVersion.create.mockRejectedValue({ code: 'P2002' });
    await expect(call()).rejects.toThrow(ConflictException);
  });

  test('I6：信封 assetId 非本人上传 → 400 FILE_NOT_OWNED', async () => {
    prisma.fileAsset.findMany.mockResolvedValue([{ id: 'fa-mine', uploaderId: 'user-OTHER' }]);
    await expect(call()).rejects.toThrow(BadRequestException);
  });

  test('I7：context.supplierId 与本人不符 → 400 ENVELOPE_CONTEXT_MISMATCH', async () => {
    prisma.caOperation.findUnique.mockResolvedValue({
      id: 'op-1', subjectId: 'sup-1', purpose: 'submit', status: 'PAYLOAD_READY',
      result: { canonical: JSON.stringify(mkEnvelope({ context: { supplierId: 'sup-OTHER' } })), canonicalSha256: 'c'.repeat(64) },
    });
    await expect(call()).rejects.toThrow(BadRequestException);
  });

  test('I2：op 已 COMMITTED（重放）→ 409 OPERATION_NOT_COMMITTABLE', async () => {
    prisma.caOperation.findUnique.mockResolvedValue({
      id: 'op-1', subjectId: 'sup-1', purpose: 'submit', status: 'COMMITTED',
      result: { canonical: JSON.stringify(mkEnvelope()), canonicalSha256: 'c'.repeat(64) },
    });
    await expect(call()).rejects.toThrow(ConflictException);
  });
});
