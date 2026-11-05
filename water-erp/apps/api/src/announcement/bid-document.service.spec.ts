import { BidDocumentService } from './bid-document.service';

/**
 * checkEligibility OPEN 公司隔离（2026-10-21 边界闭环）：
 * 「全库供应商可下载」收紧为「本公司库」——公告归属公司 ∈ 供应商 APPROVED SupplierCompanyLink；
 * 平台级公告（companyId null）仍全员；存量跨公司受邀行（BidSupplier）放行（受邀即授权）。
 */
describe('BidDocumentService — checkEligibility OPEN 公司隔离（2026-10-21）', () => {
  const mk = (prismaOverrides: Record<string, any> = {}) => {
    const prisma: any = {
      announcement: { findUnique: jest.fn() },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue(null) },
      ...prismaOverrides,
    };
    const svc: any = Object.create(BidDocumentService.prototype);
    svc.prisma = prisma;
    return { svc, prisma };
  };

  it('OPEN + 公告归属公司命中 APPROVED 归属 → eligible「公开下载」', async () => {
    const { svc, prisma } = mk();
    prisma.announcement.findUnique.mockResolvedValue({ companyId: 'co-A' });
    prisma.supplierCompanyLink.findMany.mockResolvedValue([{ companyId: 'co-A' }]);
    await expect(svc.checkEligibility({ accessScope: 'OPEN', announcementId: 'a1' }, 's1'))
      .resolves.toEqual({ eligible: true, reason: '公开下载' });
  });

  it('OPEN + 他司公告且无归属/无受邀 → 拒绝（reason 指引归属口径）', async () => {
    const { svc, prisma } = mk();
    prisma.announcement.findUnique.mockResolvedValue({ companyId: 'co-B' });
    await expect(svc.checkEligibility({ accessScope: 'OPEN', announcementId: 'a1' }, 's1'))
      .resolves.toMatchObject({ eligible: false });
  });

  it('OPEN + 平台级公告（companyId null）→ 全员放行', async () => {
    const { svc, prisma } = mk();
    prisma.announcement.findUnique.mockResolvedValue({ companyId: null });
    await expect(svc.checkEligibility({ accessScope: 'OPEN', announcementId: 'a1' }, 's1'))
      .resolves.toEqual({ eligible: true, reason: '公开下载' });
  });

  it('OPEN + 他司公告 + 存量跨公司受邀行 → 放行（受邀即授权）', async () => {
    const { svc, prisma } = mk();
    prisma.announcement.findUnique.mockResolvedValue({ companyId: 'co-B' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1' });
    await expect(svc.checkEligibility({ accessScope: 'OPEN', announcementId: 'a1', bidProjectId: 'p1' }, 's1'))
      .resolves.toEqual({ eligible: true, reason: '受邀参与本项目' });
  });

  it('INVITED 分支不受影响（受邀名单判定照旧）', async () => {
    const { svc, prisma } = mk();
    prisma.bidDocumentAccess = { findUnique: jest.fn().mockResolvedValue({ eligible: true }) };
    await expect(svc.checkEligibility({ accessScope: 'INVITED', announcementId: 'a1', id: 'd1' }, 's1'))
      .resolves.toMatchObject({ eligible: true });
  });
});

/**
 * 下载方式治理（2026-11-05 用户裁定）：
 * - 解密下载真实闸门——密码存 announcement.metadata.downloadPassword，配置了即须校验
 *   （原 DESIGNATED 条件是历史死口径）；供应商端只回 needPassword 布尔。
 * - 付费下载暂不支持——requirePayment=true 新开一律 400。
 * - free 显式下发清密码；downloadMode 不传（旧客户端/向导）不动既有密码。
 */
describe('BidDocumentService — 下载方式治理（2026-11-05）', () => {
  const { Readable } = require('node:stream');
  const { encryptBuffer } = require('./bid-document.crypto');
  const { wrapKey } = require('../common/crypto/envelope-crypto');

  const mk = (prismaOverrides: Record<string, any> = {}) => {
    const prisma: any = {
      announcement: { findUnique: jest.fn().mockResolvedValue({ metadata: {} }), update: jest.fn().mockResolvedValue({}) },
      bidDocument: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      bidDocumentAccess: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn(), upsert: jest.fn() },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue(null) },
      fileAsset: { findUnique: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
      ...prismaOverrides,
    };
    const svc: any = Object.create(BidDocumentService.prototype);
    svc.prisma = prisma;
    return { svc, prisma };
  };

  const DOC_FULL = {
    id: 'd1', announcementId: 'a1', title: 't', accessScope: 'OPEN', requirePayment: false, price: null,
    bidProjectId: null, downloadCount: 0,
    fileAsset: { id: 'f1', originalName: 'a.pdf', size: 1, mimeType: 'application/pdf' },
    announcement: { metadata: {} },
    accesses: [],
  };

  it('updateConfig encrypted → 密码写入 metadata（合并保留其他键，不整列覆盖）', async () => {
    const { svc, prisma } = mk();
    prisma.bidDocument.findUnique.mockResolvedValue({ ...DOC_FULL });
    prisma.announcement.findUnique.mockResolvedValue({ metadata: { aiSummary: '保留我' } });
    await svc.updateConfig('a1', { downloadMode: 'encrypted', downloadPassword: '285913' });
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { metadata: { aiSummary: '保留我', downloadPassword: '285913' } },
    });
  });

  it('updateConfig free → 清除密码（merge 写，保留其余键）', async () => {
    const { svc, prisma } = mk();
    prisma.bidDocument.findUnique.mockResolvedValue({ ...DOC_FULL });
    prisma.announcement.findUnique.mockResolvedValue({ metadata: { aiSummary: '保留我', downloadPassword: 'old' } });
    await svc.updateConfig('a1', { downloadMode: 'free' });
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { metadata: { aiSummary: '保留我' } },
    });
  });

  it('updateConfig 不传 downloadMode → 不动密码（向导/旧客户端只改 scope 不误清）', async () => {
    const { svc, prisma } = mk();
    prisma.bidDocument.findUnique.mockResolvedValue({ ...DOC_FULL });
    await svc.updateConfig('a1', { accessScope: 'OPEN' });
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });

  it('付费暂不支持：requirePayment=true → 400 PAID_NOT_SUPPORTED（upload 与 updateConfig 双闸）', async () => {
    const { svc, prisma } = mk();
    prisma.bidDocument.findUnique.mockResolvedValue({ ...DOC_FULL });
    await expect(svc.updateConfig('a1', { requirePayment: true })).rejects.toMatchObject({
      status: 400, response: { code: 'PAID_NOT_SUPPORTED' },
    });
  });

  it('encrypted 缺密码/密码过短 → 400 PASSWORD_REQUIRED', async () => {
    const { svc, prisma } = mk();
    prisma.bidDocument.findUnique.mockResolvedValue({ ...DOC_FULL });
    await expect(svc.updateConfig('a1', { downloadMode: 'encrypted' })).rejects.toMatchObject({
      status: 400, response: { code: 'PASSWORD_REQUIRED' },
    });
    await expect(svc.updateConfig('a1', { downloadMode: 'encrypted', downloadPassword: '12' })).rejects.toMatchObject({
      status: 400, response: { code: 'PASSWORD_REQUIRED' },
    });
  });

  it('getForSupplier：metadata 有密码 → needPassword=true、canDownload=false（模式驱动，DESIGNATED 死口径已废）', async () => {
    const { svc, prisma } = mk();
    prisma.bidDocument.findUnique.mockResolvedValue({
      id: 'd1', announcementId: 'a1', title: 't', accessScope: 'OPEN', requirePayment: false, price: null, fileAssetId: 'f1',
      announcement: { id: 'a1', title: 't', type: 'BID_NOTICE', status: 'PUBLISHED', metadata: { downloadPassword: '285913' } },
    });
    prisma.fileAsset.findUnique.mockResolvedValue({ size: 10 });
    const r = await svc.getForSupplier('a1', 's1');
    expect(r.needPassword).toBe(true);
    expect(r.canDownload).toBe(false);
  });

  it('downloadForSupplier：密码错误 → 403 WRONG_PASSWORD；密码正确 → 解密放行', async () => {
    const prevSecret = process.env.KMS_SECRET;
    process.env.KMS_SECRET = 'spec-kms-secret-0123456789abcdef-2026';
    const { svc, prisma } = mk();
    const { ciphertext, decryptKey } = encryptBuffer(Buffer.from('DOC-PLAIN'));
    const minioMod = require('../upload/minio.client');
    const getObjectSpy = jest.spyOn(minioMod.minioClient, 'getObject')
      .mockResolvedValue(Readable.from([ciphertext]) as any);
    prisma.bidDocument.findUnique.mockResolvedValue({
      id: 'd1', announcementId: 'a1', accessScope: 'OPEN', requirePayment: false, decryptKey: wrapKey(decryptKey, process.env.KMS_SECRET),
      fileAsset: { key: 'k', originalName: '标书.pdf', mimeType: 'application/pdf' },
      announcement: { metadata: { downloadPassword: '285913' } },
    });
    try {
      await expect(svc.downloadForSupplier('a1', 's1', '000000')).rejects.toMatchObject({
        status: 403, response: { code: 'WRONG_PASSWORD' },
      });
      await expect(svc.downloadForSupplier('a1', 's1')).rejects.toMatchObject({
        status: 403, response: { code: 'WRONG_PASSWORD' },
      });
      const ok = await svc.downloadForSupplier('a1', 's1', '285913');
      expect(ok.buffer.toString()).toBe('DOC-PLAIN');
      expect(ok.fileName).toBe('标书.pdf');
    } finally {
      getObjectSpy.mockRestore();
      if (prevSecret === undefined) delete process.env.KMS_SECRET; else process.env.KMS_SECRET = prevSecret;
    }
  });

  it('getForManagement：回显 downloadMode/downloadPassword（管理端自设需线下告知）', async () => {
    const { svc, prisma } = mk();
    prisma.bidDocument.findUnique.mockResolvedValue({
      id: 'd1', announcementId: 'a1', title: 't', accessScope: 'OPEN', requirePayment: false, price: null,
      bidProjectId: null, downloadCount: 0, fileAsset: { id: 'f1', originalName: 'a.pdf', size: 1, mimeType: 'application/pdf' },
      announcement: { metadata: { downloadPassword: '285913' } },
      accesses: [],
    });
    const r = await svc.getForManagement('a1');
    expect(r.downloadMode).toBe('encrypted');
    expect(r.downloadPassword).toBe('285913');
  });
});
