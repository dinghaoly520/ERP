/**
 * dual-v3 opening-package + 解密上传 P7 证明单测（Task9，附录 §5.C/§5.D）
 * mock Prisma/MinIO/CaVerificationService——v3 取包字段 / P7 证明 / 无证明兼容 / 锚点交叉 / 万元单位
 */
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { canonicalJson, computeV3FieldsCommit } from '@water-erp/ukey';
import type { DualV3Envelope } from '@water-erp/ukey';

jest.mock('../upload/minio.client', () => ({
  minioClient: { putObject: jest.fn(), getObject: jest.fn(), removeObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

import { SupplierPortalService } from '../supplier-portal/supplier-portal.service';

const mockVerify = jest.fn();
const mockCaVerify = { verifySignature: mockVerify } as any;

const PLAIN = Buffer.from('plain-tech!');
const PLAIN_SHA = createHash('sha256').update(PLAIN).digest('hex');
const NONCE = 'ab12cd34ef56ab12';
const FIELDS = { price: '153.95', amountUnit: '万元', currency: 'CNY', deliveryPeriod: '90 日历天', qualityCommitment: '合格' } as const;

const mkEnv = async (): Promise<DualV3Envelope> => ({
  version: 'dual-v3',
  canonicalVersion: 'erp-json-v1',
  provider: 'scca',
  context: { projectId: 'proj-1', supplierId: 'sup-1', submissionId: 'sub-1', revision: 1, signingBindingId: 'b-1', signingCertFingerprint: 'cf-1' },
  files: {
    technical: {
      assetId: 'fa-outer-1', plainSha256: PLAIN_SHA, plainBytes: PLAIN.length,
      innerSha256: 'i'.repeat(64), innerBytes: 4096, outerSha256: 'o'.repeat(64), outerBytes: 4224,
      kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'r'.repeat(64), value: 'MIIBkzCCKkQ.' },
      kadmin: { format: 'sm2-c1c3c2-hex', adminCertId: 'ac-1', value: '04ab' },
    },
  },
  sealedFields: {
    cipherFormat: 'sm4-cbc-pkcs7-hex', cipher: 'deadbeef01', cipherSha256: 'c'.repeat(64), cipherBytes: 16,
    kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'r'.repeat(64), value: 'MIIBezCCBXo.' },
  },
  fieldsCommit: await computeV3FieldsCommit(FIELDS as any, NONCE),
});

let ENVELOPE: DualV3Envelope;

const SESSION = { id: 'sess-1', decryptWindowStart: new Date(Date.now() - 3600_000), decryptWindowEnd: new Date(Date.now() + 3600_000), pausedAt: null };
const SUBMISSION_BASE = () => ({
  id: 'sub-1', supplierId: 'sup-1', projectId: 'proj-1', status: 'submitted',
  envelopeVersion: 'dual-v3', revision: 1,
  envelope: ENVELOPE as any,
  outerDecryptedAt: new Date(), innerAssets: { technical: 'inner-1' },
  packageFetchedAt: null,
});

const txMocks = () => ({
  fileAsset: { upsert: jest.fn().mockResolvedValue({ id: 'dec-1' }) },
  supplierBidSubmission: { update: jest.fn().mockResolvedValue({}) },
  bidOpeningRecord: { upsert: jest.fn().mockResolvedValue({}) },
  bidSupplier: { update: jest.fn().mockImplementation(async ({ data }: any) => data ?? {}) },
  bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
});

const mkPrisma = () => ({
  bidSupplier: {
    findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierId: 'sup-1', projectId: 'proj-1', supplierName: '测试供应商', decryptStatus: 'PENDING' }),
    count: jest.fn().mockResolvedValue(3),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
  },
  bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'proj-1', stage: 'OPENING', procurementMethod: '询比采购' }) },
  bidOpeningSession: { findUnique: jest.fn().mockResolvedValue(SESSION) },
  supplierBidSubmission: {
    findUnique: jest.fn().mockResolvedValue(SUBMISSION_BASE()),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  submissionVersion: { findUnique: jest.fn().mockResolvedValue({ envelopeHash: 'd'.repeat(64), envelope: ENVELOPE }) },
  fileAsset: {
    findUnique: jest.fn().mockResolvedValue({ id: 'inner-1', sha256: 'i'.repeat(64), size: 4096 }),
    upsert: jest.fn().mockResolvedValue({ id: 'dec-1' }),
  },
  supplierCert: { findFirst: jest.fn() },
  caOperation: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  bidOpeningRecord: { upsert: jest.fn().mockResolvedValue({}) },
  bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
  supplier: { findUnique: jest.fn().mockResolvedValue({ userId: 'user-1' }) },
  tx: txMocks(),
  $transaction: async (fn: (tx: any) => Promise<any>) => fn(prisma.tx),
});
let prisma: any;

const mkCert = () => ({
  certSn: 'SN1', publicKey: '04ab', bindingStatus: 'ACTIVE', credentialScheme: 'scca-pkcs7',
  signingCaCertificate: { serialHex: 'aa', sha256Fingerprint: 'e'.repeat(64) },
});

const mkService = (prisma: any) => new SupplierPortalService(
  prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  { resolveActionableForUser: jest.fn().mockResolvedValue({}), sendToUser: jest.fn().mockResolvedValue({}) } as any,
  { autoHandoverIfDone: jest.fn() } as any, undefined, undefined, mockCaVerify,
);

const PROOF = { operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.' };

describe('opening-package v3 + 解密上传 P7 证明（Task9）', () => {
  beforeAll(async () => { ENVELOPE = await mkEnv(); });
  beforeEach(() => {
    prisma = mkPrisma();
    mockVerify.mockReset();
    mockVerify.mockResolvedValue({ ok: true, signerSerialHex: 'aa', statusCoverage: ['chain'], evidenceId: 'ev-1' });
    prisma.supplierCert.findFirst.mockResolvedValue(mkCert());
    prisma.caOperation.findUnique.mockResolvedValue({ id: 'op-1', subjectId: 'sup-1', purpose: 'decrypt-upload', status: 'PAYLOAD_READY' });
  });

  test('v3 取包：kself P7 值+recipientFingerprint+revision/envelopeDigest/openingSessionId', async () => {
    const svc = mkService(prisma);
    const pkg = await svc.getOpeningPackage('sup-1', 'proj-1');
    expect(pkg.revision).toBe(1);
    expect(pkg.envelopeDigest).toBe('d'.repeat(64));
    expect(pkg.openingSessionId).toBe('sess-1');
    expect(pkg.files).toHaveLength(1);
    const f = pkg.files[0];
    expect(f).toMatchObject({
      role: 'technical', innerAsset: 'inner-1', downloadUrl: '/api/upload/files/inner-1',
      innerSha256: 'i'.repeat(64), innerBytes: 4096,
      kself: { format: 'scca-pkcs7-base64', recipientCertFingerprint: 'r'.repeat(64), value: 'MIIBkzCCKkQ.' },
    });
    expect((pkg.sealedFields as any).kself.value).toBe('MIIBezCCBXo.');
  });

  test('v3 解密上传（带 P7 证明）：canonical 绑 fieldsCommit+明文摘要 → SUCCESS + amountUnit 万元进唱标', async () => {
    const svc = mkService(prisma);
    const result = await svc.decryptUpload('sup-1', 'proj-1', { technical: PLAIN }, JSON.stringify(FIELDS), NONCE, PROOF);

    expect(mockVerify).toHaveBeenCalledTimes(1);
    const expectedCanonical = canonicalJson({
      version: 1, purpose: 'decrypt-upload', openingSessionId: 'sess-1', revision: 1,
      plainSha256ByRole: { technical: PLAIN_SHA }, fieldsCommit: ENVELOPE.fieldsCommit,
    });
    expect(mockVerify).toHaveBeenCalledWith(expect.objectContaining({
      p7B64: 'MIIxBgQ.',
      expectedToSign: expectedCanonical,
    }));
    expect(prisma.caOperation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'COMMITTED', result: expect.any(Object) },
    }));
    // 唱标预填：金额=万元裸数字、单位显式（Review Focus 5）+ 明文资产落 bid_decrypted
    expect(prisma.tx.bidOpeningRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ amount: '153.95', amountUnit: '万元', supplierName: '测试供应商' }),
    }));
    expect(prisma.tx.supplierBidSubmission.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ decryptedPrice: '153.95' }),
    }));
    expect(prisma.tx.fileAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ category: 'bid_decrypted' }),
    }));
    expect(prisma.tx.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ decryptStatus: 'SUCCESS', decryptedAt: expect.any(Date) }),
    }));
    expect(result).toEqual({ confirmStatus: 'PENDING' });
  });

  test('v3 解密上传（无证明）：旧轨照走成功（向后兼容）', async () => {
    const svc = mkService(prisma);
    const result = await svc.decryptUpload('sup-1', 'proj-1', { technical: PLAIN }, JSON.stringify(FIELDS), NONCE);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(prisma.tx.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ decryptStatus: 'SUCCESS' }),
    }));
    expect(result).toEqual({ confirmStatus: 'PENDING' });
  });

  test('P7 证明验签失败 → 400 拒收（claim 前拦截，不留 RUNNING 楔子）', async () => {
    mockVerify.mockResolvedValue({ ok: false, code: 'CA_CONTENT_MISMATCH' });
    const svc = mkService(prisma);
    await expect(svc.decryptUpload('sup-1', 'proj-1', { technical: PLAIN }, JSON.stringify(FIELDS), NONCE, PROOF))
      .rejects.toThrow(BadRequestException);
    // 证明验证在原子抢占之前——不产生 RUNNING 状态残留
    expect(prisma.bidSupplier.updateMany).not.toHaveBeenCalled();
  });

  test('明文哈希不符（锚点交叉失败）→ DANGER 终局 + UNKNOWN 归因', async () => {
    const svc = mkService(prisma);
    const result = await svc.decryptUpload('sup-1', 'proj-1', { technical: Buffer.from('tampered!') }, JSON.stringify(FIELDS), NONCE);
    expect(result).toEqual({ confirmStatus: 'EXCEPTION' });
    expect(prisma.tx.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ decryptStatus: 'DANGER', dangerAttribution: 'UNKNOWN' }),
    }));
  });
});
