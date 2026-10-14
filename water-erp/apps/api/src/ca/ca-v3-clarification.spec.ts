/**
 * dual-v3 澄清答复 P7 强签单测（Task8，附录 §5.C）
 * mock Prisma + CaVerificationService——reply 摘要入签 / 附件排序去重 / P7 证据 / 旧轨兼容
 */
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { canonicalJson } from '@water-erp/ukey';
import { SupplierPortalService } from '../supplier-portal/supplier-portal.service';

const mockVerify = jest.fn();
const mockCaVerify = { verifySignature: mockVerify } as any;

const REPLY = '经复核，本司投标文件技术参数满足招标文件第三章要求。';
const ATTACHMENTS = [
  { id: 'fa-2', category: 'clarification_reply', uploaderId: 'user-1', sha256: 'h2', originalName: '说明.pdf' },
  { id: 'fa-1', category: 'clarification_reply', uploaderId: 'user-1', sha256: 'h1', originalName: '佐证.pdf' },
];

const mkPrisma = () => ({
  bidClarification: {
    findFirst: jest.fn().mockResolvedValue({ id: 'clar-1', projectId: 'proj-1', type: 'clarification', supplierId: 'sup-1', status: '待回复' }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn().mockResolvedValue({ id: 'clar-1', status: '已回复', replySignature: {} }),
  },
  bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING' }) },
  supplierBidSubmission: { findUnique: jest.fn().mockResolvedValue(null) }, // 默认无投递行（legacy）
  fileAsset: { findMany: jest.fn().mockResolvedValue(ATTACHMENTS) },
  supplierCert: { findFirst: jest.fn() },
  caOperation: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  $transaction: async (fn: (tx: any) => Promise<any>) => fn({}),
});

const mkCert = () => ({
  certSn: 'SN1', publicKey: '04ab', bindingStatus: 'ACTIVE', credentialScheme: 'scca-pkcs7',
  signingCaCertificate: { serialHex: 'aa', sha256Fingerprint: 'e'.repeat(64) },
});

const mkService = (prisma: any) => new SupplierPortalService(
  prisma, {} as any, { verify: jest.fn(), isValidPublicKey: jest.fn(() => true) } as any,
  {} as any, {} as any, {} as any,
  {} as any, { resolveActionableForUser: jest.fn().mockResolvedValue({}) } as any,
  {} as any, undefined, undefined, mockCaVerify,
);

describe('澄清答复 P7 强签（dual-v3 Task8）', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = mkPrisma();
    mockVerify.mockReset();
    mockVerify.mockResolvedValue({ ok: true, signerSerialHex: 'aa', statusCoverage: ['chain'] });
    prisma.supplierCert.findFirst.mockResolvedValue(mkCert());
    prisma.caOperation.findUnique.mockResolvedValue({
      id: 'op-1', subjectId: 'sup-1', purpose: 'clarification', status: 'PAYLOAD_READY',
    });
    prisma.caOperation.updateMany = jest.fn().mockResolvedValue({ count: 1 });
  });

  test('v3 澄清：P7 验签通过→证据含 scca-pkcs7-base64/certSn/certPublicKey，operation COMMITTED', async () => {
    const svc = mkService(prisma);
    const result = await svc.submitClarificationReply('proj-1', 'clar-1', 'sup-1', { sub: 'user-1', name: '张三' }, {
      reply: REPLY,
      attachmentIds: ['fa-2', 'fa-1'],
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    } as any);

    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith(expect.objectContaining({
      p7B64: 'MIIxBgQ.',
      expectedToSign: expect.not.stringContaining(REPLY), // reply 全文不进签——只有摘要
      expectedSignCert: { serialHex: 'aa', sha256: 'e'.repeat(64) },
    }));

    const writeArg = prisma.bidClarification.updateMany.mock.calls[0][0];
    expect(writeArg.where).toEqual({ id: 'clar-1', status: '待回复' }); // TOCTOU 条件写保留
    expect(writeArg.data.replySignature).toEqual(expect.objectContaining({
      algorithm: 'scca-pkcs7-base64',
      signature: 'MIIxBgQ.',
      certSn: 'SN1',
      certPublicKey: '04ab',
      replySha256: createHash('sha256').update(REPLY, 'utf8').digest('hex'),
    }));
    expect(prisma.caOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'op-1', status: 'PAYLOAD_READY' },
      data: expect.objectContaining({ status: 'COMMITTED' }),
    }));
    expect(result.status).toBe('已回复');
  });

  test('canonical v2：reply 摘要+附件排序去重入签（乱序/重复 id 归一）', async () => {
    const svc = mkService(prisma);
    const { payload } = await svc.getClarificationReplyPayload('proj-1', 'clar-1', 'sup-1', { sub: 'user-1' }, {
      reply: REPLY,
      attachmentIds: ['fa-2', 'fa-1', 'fa-2'], // 乱序 + 重复
    } as any);

    const parsed = JSON.parse(payload);
    expect(parsed.version).toBe(2);
    expect(parsed.purpose).toBe('clarification-reply');
    expect(parsed.replySha256).toBe(createHash('sha256').update(REPLY, 'utf8').digest('hex'));
    expect(parsed.reply).toBeUndefined();
    // 排序去重：fa-1, fa-2 恰两条且字典序
    expect(parsed.attachments).toEqual([
      { fileAssetId: 'fa-1', sha256: 'h1' },
      { fileAssetId: 'fa-2', sha256: 'h2' },
    ]);
    // canonical 键序稳定
    expect(payload).toBe(canonicalJson(parsed));
  });

  test('旧轨兼容：无 operationId + 空签名 → 免签照走（不调 P7 验签）', async () => {
    const svc = mkService(prisma);
    await svc.submitClarificationReply('proj-1', 'clar-1', 'sup-1', { sub: 'user-1' }, {
      reply: REPLY,
    } as any);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(prisma.bidClarification.updateMany).toHaveBeenCalledTimes(1);
  });

  test('I2：op 已 COMMITTED（重放）→ 409', async () => {
    prisma.caOperation.findUnique.mockResolvedValue({
      id: 'op-1', subjectId: 'sup-1', purpose: 'clarification', status: 'COMMITTED',
    });
    const svc = mkService(prisma);
    const { ConflictException } = require('@nestjs/common');
    await expect(svc.submitClarificationReply('proj-1', 'clar-1', 'sup-1', { sub: 'user-1' }, {
      reply: REPLY,
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    } as any)).rejects.toThrow(ConflictException);
  });

  test('I8：v3 轨空签名 → 400 CLARIFICATION_P7_REQUIRED', async () => {
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ id: 'sub-1', envelopeVersion: 'dual-v3' });
    const svc = mkService(prisma);
    await expect(svc.submitClarificationReply('proj-1', 'clar-1', 'sup-1', { sub: 'user-1' }, {
      reply: REPLY,
    } as any)).rejects.toThrow(BadRequestException);
  });

  test('T8 op 时序：并发答复失败（count=0）→ op 不烧（留 PAYLOAD_READY 可重试）', async () => {
    prisma.bidClarification.updateMany.mockResolvedValue({ count: 0 });
    const svc = mkService(prisma);
    const { ConflictException } = require('@nestjs/common');
    await expect(svc.submitClarificationReply('proj-1', 'clar-1', 'sup-1', { sub: 'user-1' }, {
      reply: REPLY,
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    } as any)).rejects.toThrow(ConflictException);
    expect(prisma.caOperation.updateMany).not.toHaveBeenCalled();
  });

  test('P7 验签失败 → 400 拒收，零落库', async () => {
    mockVerify.mockResolvedValue({ ok: false, code: 'CA_CONTENT_MISMATCH' });
    const svc = mkService(prisma);
    await expect(svc.submitClarificationReply('proj-1', 'clar-1', 'sup-1', { sub: 'user-1' }, {
      reply: REPLY,
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    } as any)).rejects.toThrow(BadRequestException);
    expect(prisma.bidClarification.updateMany).not.toHaveBeenCalled();
    expect(prisma.caOperation.update).not.toHaveBeenCalled();
  });

  test('purpose 非 clarification → 400 PURPOSE_MISMATCH', async () => {
    prisma.caOperation.findUnique.mockResolvedValue({
      id: 'op-1', subjectId: 'sup-1', purpose: 'receipt', status: 'PAYLOAD_READY',
    });
    const svc = mkService(prisma);
    await expect(svc.submitClarificationReply('proj-1', 'clar-1', 'sup-1', { sub: 'user-1' }, {
      reply: REPLY,
      operationId: 'op-1', signatureFormat: 'scca-pkcs7-base64', signP7: 'MIIxBgQ.',
    } as any)).rejects.toThrow(BadRequestException);
  });
});
