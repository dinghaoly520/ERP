/**
 * dual-v3 开标确认 P7 强签单测（Task7，附录 §5.C）
 * mock Prisma + CaVerificationService——canonical v2（无金额明文）/ amountUnit 进快照 / P7 证据 / 旧轨兼容
 */
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { canonicalJson } from '@water-erp/ukey';
import { SupplierPortalService } from '../supplier-portal/supplier-portal.service';
import { computeOpeningRecordHash } from '../supplier-portal/opening-confirm-signature.util';

const mockVerify = jest.fn();
const mockCaVerify = { verifySignature: mockVerify } as any;

const RECORD = {
  id: 'rec-1', projectId: 'proj-1', bidSupplierId: 'bs-1',
  supplierName: '测试供应商', amount: '153.95', amountUnit: '万元',
  period: '90 日历天', qualityTarget: '合格', bondStatus: '已缴纳',
  decryptResult: '解密成功', customFields: null,
  confirmStatus: '待供应商确认', confirmSignature: null, confirmSignedAt: null,
};

const RECORD_SNAPSHOT = {
  supplierName: RECORD.supplierName, amount: RECORD.amount, amountUnit: RECORD.amountUnit,
  period: RECORD.period, qualityTarget: RECORD.qualityTarget, bondStatus: RECORD.bondStatus,
  decryptResult: RECORD.decryptResult, customFields: RECORD.customFields,
};

const mockPrisma: any = {
  bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'proj-1', stage: 'OPENING' }) },
  bidSupplier: {
    findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierId: 'sup-1', projectId: 'proj-1', supplierName: '测试供应商', decryptStatus: 'SUCCESS' }),
    update: jest.fn().mockResolvedValue({}),
  },
  bidOpeningRecord: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
  bidOpeningSession: { findUnique: jest.fn().mockResolvedValue({ id: 'sess-1' }) },
  supplierBidSubmission: { findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', revision: 1 }) },
  supplierCert: { findFirst: jest.fn() },
  caOperation: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
  $transaction: async (fn: (tx: any) => Promise<any>) => fn(mockPrisma),
};

const mkCert = () => ({
  certSn: 'SN1', publicKey: '04ab', bindingStatus: 'ACTIVE', credentialScheme: 'scca-pkcs7',
  signingCaCertificate: { serialHex: 'aa', sha256Fingerprint: 'e'.repeat(64) },
});

const mkService = () => new SupplierPortalService(
  mockPrisma, {} as any, { verify: jest.fn(), isValidPublicKey: jest.fn(() => true) } as any,
  {} as any, {} as any, {} as any, {} as any, {} as any, { autoHandoverIfDone: jest.fn() } as any,
  undefined, undefined, mockCaVerify,
);

describe('开标确认 P7 强签（dual-v3 Task7）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.mockReset();
    mockPrisma.bidOpeningRecord.findFirst.mockResolvedValue({ ...RECORD });
    mockPrisma.supplierBidSubmission.findUnique.mockResolvedValue({ id: 'sub-1', revision: 1 }); // 默认旧轨行（I8 用例按需覆写）
    mockPrisma.supplierCert.findFirst.mockResolvedValue(mkCert());
    mockPrisma.caOperation.findUnique.mockResolvedValue({
      id: 'op-1', subjectId: 'sup-1', purpose: 'opening-confirm', status: 'PAYLOAD_READY',
    });
    mockPrisma.caOperation.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    mockVerify.mockResolvedValue({ ok: true, signerSerialHex: 'aa', statusCoverage: ['chain'] });
  });

  test('v3 确认：P7 验签通过→证据含 openingRecordHash/amountUnit 进快照/certSn，operation COMMITTED', async () => {
    const svc = mkService();
    const result = await svc.confirmOpening('sup-1', 'proj-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    });

    expect(mockVerify).toHaveBeenCalledWith(expect.objectContaining({
      p7B64: 'MIIxBgQ.',
      expectedToSign: expect.not.stringContaining('153.95'),
      expectedSignCert: { serialHex: 'aa', sha256: 'e'.repeat(64) },
    }));

    const expectedHash = createHash('sha256').update(canonicalJson(RECORD_SNAPSHOT), 'utf8').digest('hex');
    const updateArg = mockPrisma.bidOpeningRecord.updateMany.mock.calls[0][0];
    expect(updateArg.data.confirmSignature).toEqual(expect.objectContaining({
      algorithm: 'scca-pkcs7-base64',
      signature: 'MIIxBgQ.',
      certSn: 'SN1',
      certPublicKey: '04ab',
      openingRecordHash: expectedHash,
    }));
    // amountUnit 必须进快照（单位歧义钉死——万元/元铁律）
    expect(createHash('sha256').update(canonicalJson({ ...RECORD_SNAPSHOT, amountUnit: null }), 'utf8').digest('hex'))
      .not.toBe(expectedHash);
    expect(mockPrisma.caOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'op-1', status: 'PAYLOAD_READY' },
      data: expect.objectContaining({ status: 'COMMITTED' }),
    }));
    expect(mockPrisma.bidSupplier.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bs-1' },
      data: { confirmStatus: 'CONFIRMED' },
    }));
    expect(result).toEqual({ success: true });
  });

  test('canonical v2：无金额明文/无 amountUnit 字面量，含 openingRecordHash 与 revision', async () => {
    mockPrisma.supplierBidSubmission.findUnique.mockResolvedValue({ id: 'sub-1', revision: 1, envelopeVersion: 'dual-v3' });
    const svc = mkService();
    const result = await svc.getOpeningConfirmPayload('sup-1', 'proj-1');
    expect(result.canonical).not.toContain('153.95');
    expect(result.canonical).not.toContain('万元');
    expect(result.canonical).toContain('"purpose":"confirm"');
    expect(result.payload).toMatchObject({
      version: 2, purpose: 'confirm', recordId: 'rec-1',
      submissionId: 'sub-1', revision: 1, openingSessionId: 'sess-1',
    });
    expect(typeof result.payload.openingRecordHash).toBe('string');
    expect(result.payload.openingRecordHash).toHaveLength(64);
  });

  test('I2：op 已 COMMITTED（重放）→ 409', async () => {
    mockPrisma.caOperation.findUnique.mockResolvedValue({
      id: 'op-1', subjectId: 'sup-1', purpose: 'opening-confirm', status: 'COMMITTED',
    });
    const svc = mkService();
    const { ConflictException } = require('@nestjs/common');
    await expect(svc.confirmOpening('sup-1', 'proj-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    })).rejects.toThrow(ConflictException);
  });

  test('I8：v3 轨空签名 → 400 OPENING_CONFIRM_P7_REQUIRED', async () => {
    mockPrisma.supplierBidSubmission.findUnique.mockResolvedValue({ id: 'sub-1', revision: 1, envelopeVersion: 'dual-v3' });
    const svc = mkService();
    await expect(svc.confirmOpening('sup-1', 'proj-1', '')).rejects.toThrow(BadRequestException);
  });

  test('旧轨兼容：空签名 → unsigned-legacy 照走（v1 canonical 重建不受影响）', async () => {
    const svc = mkService();
    await svc.confirmOpening('sup-1', 'proj-1', '');
    const updateArg = mockPrisma.bidOpeningRecord.updateMany.mock.calls[0][0];
    expect(updateArg.data.confirmSignature).toEqual(expect.objectContaining({
      algorithm: 'unsigned-legacy', signature: null,
    }));
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('T8 op 时序：resign 回填失败 → op 不烧（业务写先于 commit）', async () => {
    mockPrisma.bidOpeningRecord.findFirst.mockResolvedValue({ ...RECORD, confirmStatus: '供应商已确认', confirmSignature: null });
    mockPrisma.bidOpeningRecord.update.mockRejectedValueOnce(new Error('db down'));
    const svc = mkService();
    await expect(svc.confirmOpening('sup-1', 'proj-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    })).rejects.toThrow('db down');
    expect(mockPrisma.caOperation.updateMany).not.toHaveBeenCalled();
  });

  test('P7 验签失败 → 400 拒收，零落库', async () => {
    mockVerify.mockResolvedValue({ ok: false, code: 'CA_CONTENT_MISMATCH' });
    const svc = mkService();
    await expect(svc.confirmOpening('sup-1', 'proj-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    })).rejects.toThrow(BadRequestException);
    expect(mockPrisma.bidOpeningRecord.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.caOperation.update).not.toHaveBeenCalled();
  });

  test('resign v3：已确认未签名 → 定点补签 P7（不改状态字段）', async () => {
    mockPrisma.bidOpeningRecord.findFirst.mockResolvedValue({
      ...RECORD, confirmStatus: '供应商已确认', confirmSignature: null,
    });
    const svc = mkService();
    const result = await svc.confirmOpening('sup-1', 'proj-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    });
    expect(mockVerify).toHaveBeenCalled();
    expect(mockPrisma.bidOpeningRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_bidSupplierId: { projectId: 'proj-1', bidSupplierId: 'bs-1' } },
      data: expect.objectContaining({
        confirmSignature: expect.objectContaining({ algorithm: 'scca-pkcs7-base64' }),
        confirmSignedAt: expect.any(Date),
      }),
    }));
    // 补签不动状态机
    expect(mockPrisma.bidOpeningRecord.update.mock.calls[0][0].data.confirmStatus).toBeUndefined();
    expect(result).toEqual({ success: true, alreadySigned: false });
  });

  test('purpose 非 opening-confirm → 400 PURPOSE_MISMATCH', async () => {
    mockPrisma.caOperation.findUnique.mockResolvedValue({
      id: 'op-1', subjectId: 'sup-1', purpose: 'receipt', status: 'PAYLOAD_READY',
    });
    const svc = mkService();
    await expect(svc.confirmOpening('sup-1', 'proj-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    })).rejects.toThrow(BadRequestException);
  });

  test('computeOpeningRecordHash：快照键序无关（canonicalJson 排序）', () => {
    const a = computeOpeningRecordHash(RECORD_SNAPSHOT);
    const b = computeOpeningRecordHash(Object.fromEntries(Object.entries(RECORD_SNAPSHOT).reverse()) as typeof RECORD_SNAPSHOT);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});
