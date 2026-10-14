/**
 * dual-v3 回执 P7 强签单测（Task6，附录 §5.C）
 * mock Prisma + CaVerificationService——v3 证据字段 / revision 幂等 / 旧轨兼容 / 验签失败拒写
 */
import { BadRequestException } from '@nestjs/common';
import { SupplierPortalService } from '../supplier-portal/supplier-portal.service';

const mockVerify = jest.fn();
const mockCaVerify = { verifySignature: mockVerify } as any;

const mkSub = (over: Record<string, any> = {}) => ({
  id: 'sub-1',
  supplierId: 'sup-1',
  projectId: 'proj-1',
  status: 'submitted',
  revision: 1,
  envelopeVersion: 'dual-v3',
  envelope: null,
  fileHash: 'f'.repeat(64),
  serverSubmittedAt: new Date('2026-10-14T08:00:00Z'),
  submittedAt: new Date('2026-10-14T08:00:00Z'),
  createdAt: new Date('2026-10-14T07:59:00Z'),
  receiptSignature: null,
  receiptSignedAt: null,
  ...over,
});

const mkCert = () => ({
  certSn: 'SN1',
  publicKey: '04ab',
  bindingStatus: 'ACTIVE',
  credentialScheme: 'scca-pkcs7',
  signingCaCertificate: { serialHex: 'aa', sha256Fingerprint: 'e'.repeat(64) },
});

const mockPrisma: any = {
  supplierBidSubmission: { findUnique: jest.fn(), update: jest.fn() },
  supplierCert: { findFirst: jest.fn() },
  caOperation: { findUnique: jest.fn(), update: jest.fn() },
  submissionVersion: { findUnique: jest.fn() },
  bidSupplier: { findFirst: jest.fn() },
  $transaction: async (fn: (tx: any) => Promise<any>) => fn(mockPrisma),
};

const mkService = () => new SupplierPortalService(
  mockPrisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  undefined, undefined, mockCaVerify,
);

describe('回执 P7 强签（dual-v3 Task6）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.mockReset();
    mockPrisma.supplierBidSubmission.findUnique.mockResolvedValue(mkSub());
    mockPrisma.supplierCert.findFirst.mockResolvedValue(mkCert());
    mockPrisma.caOperation.findUnique.mockResolvedValue({
      id: 'op-1', subjectId: 'sup-1', purpose: 'receipt', status: 'PAYLOAD_READY',
    });
    mockPrisma.caOperation.update.mockResolvedValue({});
    mockPrisma.submissionVersion.findUnique.mockResolvedValue({ envelopeHash: 'e'.repeat(64) });
    mockPrisma.bidSupplier.findFirst.mockResolvedValue({ receiptNo: 'TB-20261014-001' });
    mockPrisma.supplierBidSubmission.update.mockImplementation(async ({ data }: any) => ({ ...mkSub(), ...data }));
  });

  test('v3 轨：P7 验签通过→证据含 algorithm/certSn/revision/envelopeHash，operation 转 COMMITTED', async () => {
    mockVerify.mockResolvedValue({ ok: true, signerSerialHex: 'aa', statusCoverage: ['chain'] });
    const svc = mkService();
    const result = await svc.signSubmissionReceipt('sub-1', 'sup-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    });

    // 验签入参：P7 + 服务端重建 canonical + 签名证书指纹
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith(expect.objectContaining({
      p7B64: 'MIIxBgQ.',
      expectedToSign: expect.stringContaining('"purpose":"submission-receipt"'),
      expectedSignCert: { serialHex: 'aa', sha256: 'e'.repeat(64) },
    }));
    // 证据落库：P7 快照 + revision/envelopeHash 键控幂等锚点
    expect(mockPrisma.supplierBidSubmission.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sub-1' },
      data: expect.objectContaining({
        receiptSignature: expect.objectContaining({
          algorithm: 'scca-pkcs7-base64',
          signature: 'MIIxBgQ.',
          certSn: 'SN1',
          revision: 1,
          envelopeHash: 'e'.repeat(64),
        }),
        receiptSignedAt: expect.any(Date),
      }),
    }));
    expect(mockPrisma.caOperation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'op-1' },
      data: { status: 'COMMITTED', result: expect.any(Object) },
    }));
    expect(result).toEqual(expect.objectContaining({ success: true, revision: 1 }));
  });

  test('同 revision 幂等：已签同版直接返回，不验签不落库', async () => {
    const signed = mkSub({ receiptSignature: { revision: 1, signature: 'old-p7' } });
    mockPrisma.supplierBidSubmission.findUnique.mockResolvedValue(signed);
    const svc = mkService();
    const result = await svc.signSubmissionReceipt('sub-1', 'sup-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    });
    expect(result).toBe(signed);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockPrisma.supplierBidSubmission.update).not.toHaveBeenCalled();
  });

  test('revision 推进（撤回重投）后旧回执不拦新签', async () => {
    mockPrisma.supplierBidSubmission.findUnique.mockResolvedValue(
      mkSub({ revision: 2, receiptSignature: { revision: 1, signature: 'old-p7' } }),
    );
    mockVerify.mockResolvedValue({ ok: true, statusCoverage: [] });
    const svc = mkService();
    const result = await svc.signSubmissionReceipt('sub-1', 'sup-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    });
    expect(mockVerify).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ success: true, revision: 2 }));
  });

  test('旧轨兼容：无 operationId + 空签名 → unsigned-legacy 保持（不验签）', async () => {
    const svc = mkService();
    await svc.signSubmissionReceipt('sub-1', 'sup-1', '');
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockPrisma.supplierBidSubmission.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptSignature: expect.objectContaining({ algorithm: 'unsigned-legacy', signature: null }),
      }),
    }));
  });

  test('P7 验签失败 → 400 拒收，零落库', async () => {
    mockVerify.mockResolvedValue({ ok: false, code: 'CA_CONTENT_MISMATCH' });
    const svc = mkService();
    await expect(svc.signSubmissionReceipt('sub-1', 'sup-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    })).rejects.toThrow(BadRequestException);
    expect(mockPrisma.supplierBidSubmission.update).not.toHaveBeenCalled();
    expect(mockPrisma.caOperation.update).not.toHaveBeenCalled();
  });

  test('purpose 非 receipt → 400 PURPOSE_MISMATCH', async () => {
    mockPrisma.caOperation.findUnique.mockResolvedValue({
      id: 'op-1', subjectId: 'sup-1', purpose: 'submit', status: 'PAYLOAD_READY',
    });
    const svc = mkService();
    await expect(svc.signSubmissionReceipt('sub-1', 'sup-1', '', {
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    })).rejects.toThrow(BadRequestException);
  });

  test('getReceiptPayloadFor v3 字段：revision/envelopeHash/serverSubmittedAt/receiptNo 进 payload', async () => {
    const svc = mkService();
    const { payload, canonical } = await svc.getReceiptPayloadFor('sub-1', 'sup-1');
    expect(payload).toEqual(expect.objectContaining({
      version: 1,
      purpose: 'submission-receipt',
      submissionId: 'sub-1',
      projectId: 'proj-1',
      supplierId: 'sup-1',
      revision: 1,
      envelopeHash: 'e'.repeat(64),
      serverSubmittedAt: '2026-10-14T08:00:00.000Z',
      receiptNo: 'TB-20261014-001',
    }));
    // canonical 键序稳定（sorted）且往返无损
    const parsed = JSON.parse(canonical);
    expect(parsed).toEqual(payload);
    expect(canonical).toBe(JSON.stringify(parsed, Object.keys(parsed).sort()));
  });
});
