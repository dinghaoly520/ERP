import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UploadService } from './upload.service';
import { PrismaService } from '../prisma/prisma.service';
import { minioClient } from './minio.client';
import { CompanyScopeService } from '../company/company-scope';

describe('UploadService — download permission', () => {
  let service: UploadService;
  let prisma: any;
  let res: any;
  let companyScope: any;

  const asset = {
    id: 'fa-1', key: 'uploads/x.pdf', originalName: 'x.pdf',
    mimeType: 'application/pdf', size: 100, sha256: 'hash', category: 'bid_document', uploaderId: 'u-supplier',
  };

  /**
   * P1-3 查询形状分流：
   * - SEALED/删件保护的 dual 外层查询 = OR[0] 是 {AND:[{envelopeVersion…},…]}（v2 四列组）或顶层 {AND:[…]}（v3Filter 单查）；
   * - canAccessFile 授权反查 = OR[0] 是列条件（technicalFileAssetId 等），v3Filter 只作为 OR 末元素混入。
   */
  const isDualOuterQuery = (where: any) =>
    Array.isArray(where?.OR) && Array.isArray(where.OR[0]?.AND);
  const isV3OnlyQuery = (where: any) =>
    Array.isArray(where?.AND) && where.AND[0]?.envelopeVersion === 'dual-v3';

  beforeEach(async () => {
    prisma = {
      fileAsset: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
      bidExpert: { findFirst: jest.fn() },
      supplierBidSubmission: { findFirst: jest.fn() },
      bidSupplier: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      supplier: { findUnique: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
      bidOpeningSession: { findFirst: jest.fn() },
      bidSignPacket: { findFirst: jest.fn() },
      bidFileBackup: { findFirst: jest.fn().mockResolvedValue(null) }, // P1-3：v3 删件保护引用反查
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING' }) }, // P2-7：专家分支启动闸（默认已启动）
      awardLetterDelivery: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      contract: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      contractFulfillment: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      supplierQualification: { findMany: jest.fn().mockResolvedValue([]) },
      supplierPerformance: { findMany: jest.fn().mockResolvedValue([]) },
      supplierOwnArchive: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findUnique: jest.fn() },
      expertMemo: { findFirst: jest.fn() },
      openingHallMessage: { findFirst: jest.fn() },
    };
    res = { setHeader: jest.fn() };
    companyScope = {
      resolveScope: jest.fn().mockImplementation((user: any) => Promise.resolve(
        user.role === 'admin'
          ? { all: true }
          : { all: false, companyIds: [user.sub === 'u-company-b' ? 'company-b' : 'company-a'] },
      )),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyScopeService, useValue: companyScope },
      ],
    }).compile();

    service = module.get<UploadService>(UploadService);
    jest.spyOn(minioClient, 'getObject').mockClear().mockResolvedValue({ pipe: jest.fn() } as any);
  });

  describe('上传分类单一来源', () => {
    const file = {
      mimetype: 'application/pdf',
      originalname: 'proof.pdf',
      buffer: Buffer.from('%PDF-1.7\nproof'),
      size: 14,
    } as Express.Multer.File;

    it.each(['contract_document', 'prequal_document'])('接受实际业务使用的 %s 分类', (category) => {
      expect(() => service.validateFile(file, category)).not.toThrow();
    });

    it('拒绝未知分类', () => {
      expect(() => service.validateFile(file, 'made_up_category'))
        .toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'INVALID_CATEGORY' }) }));
    });

    it.each([
      ['application/zip', 'proof.pdf', Buffer.from('PK\u0003\u0004fake')],
      ['application/pdf', 'proof.zip', Buffer.from('%PDF-1.7\nfake')],
      ['application/pdf', 'proof.pdf', Buffer.from('not-a-pdf')],
    ])('合同证明拒绝伪装的 MIME、扩展名或文件头 %#', (mimetype, originalname, buffer) => {
      expect(() => service.validateFile({ ...file, mimetype, originalname, buffer } as Express.Multer.File, 'contract_document'))
        .toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'CONTRACT_DOCUMENT_TYPE_MISMATCH' }) }));
    });
  });

  describe('附件统一限制（2026-11-05：单文件 500MB+10 扩展白名单）', () => {
    const pdfFile = {
      mimetype: 'application/pdf',
      originalname: 'proof.pdf',
      buffer: Buffer.from('%PDF-1.7\nproof'),
      size: 14,
    } as Express.Multer.File;

    it('announcement 类目拒绝白名单外扩展名', () => {
      const exe = { ...pdfFile, originalname: 'a.exe' } as Express.Multer.File;
      expect(() => service.validateFile(exe, 'announcement'))
        .toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'ATTACHMENT_FILE_TYPE_INVALID' }) }));
    });

    it('announcement 允许 rar（MIME 白名单已含变体）', () => {
      const rar = { ...pdfFile, originalname: '打包.rar', mimetype: 'application/vnd.rar' } as Express.Multer.File;
      expect(() => service.validateFile(rar, 'announcement')).not.toThrow();
    });

    it('其余类目 >500MB 由服务层拒绝（2026-11-05 统一上限，旧 50MB 口径废除）', () => {
      const big = { ...pdfFile, size: 501 * 1024 * 1024, buffer: Buffer.alloc(0) } as Express.Multer.File;
      expect(() => service.validateFile(big, 'general'))
        .toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'ATTACHMENT_FILE_TOO_LARGE' }) }));
    });
  });

  describe('generateKey 扩展名白名单（审计第 1 处）', () => {
    it('正常扩展名保留', () => {
      expect(service.generateKey('报告.pdf')).toMatch(/^uploads\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{16}\.pdf$/);
    });

    it.each([
      'x.`>poc-marker',   // 最后一个点之后是 shell 载荷
      'x.a.b/c',          // 含路径分隔符
      'x.',               // 空扩展名
      'x',                // 没有扩展名
      'x.' + 'e'.repeat(9), // 超长
    ])('扩展名不合法（%s）→ bin', (name) => {
      expect(service.generateKey(name)).toMatch(/\/[a-f0-9]{16}\.bin$/);
    });
  });

  it('allows the uploader to stream their own file', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(asset);
    await service.streamFile('fa-1', { sub: 'u-supplier', role: 'supplier' }, res);
    expect(minioClient.getObject).toHaveBeenCalled();
  });

  it('allows admin/bid_host/leader/staff for non-bid-submission files', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(asset);
    prisma.supplierBidSubmission.findFirst.mockResolvedValue(null); // file not part of any submission
    await service.streamFile('fa-1', { sub: 'u-host', role: 'bid_host' }, res);
    expect(minioClient.getObject).toHaveBeenCalled();
  });

  it('签到留档照：bid_host 可见（:3007 核验矩阵展示），非上传人供应商不可见', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: 'expert_signin_photo', uploaderId: 'u-expert' });
    await service.streamFile('fa-1', { sub: 'u-host', role: 'bid_host' }, res);
    expect(minioClient.getObject).toHaveBeenCalled();

    await expect(service.streamFile('fa-1', { sub: 'u-other', role: 'supplier' }, res))
      .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
  });

  describe('审查源文件（审计第 3 处）：只对上传者本人与 admin 开放', () => {
    const reviewSource = { ...asset, id: 'fa-review', category: 'tender_review_source', uploaderId: 'u-owner', key: 'review/2026-11-25/abc.pdf' };

    it('别的内部角色下不了——不落进内部角色的兜底放行', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(reviewSource);
      for (const other of [{ sub: 'u-company-a', role: 'staff' }, { sub: 'u-leader', role: 'leader' }, { sub: 'u-host', role: 'bid_host' }]) {
        await expect(service.streamFile('fa-review', other, res)).rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
      }
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('上传者本人与 admin 能下', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(reviewSource);
      (minioClient.getObject as jest.Mock).mockClear();
      await service.streamFile('fa-review', { sub: 'u-owner', role: 'staff' }, res);
      await service.streamFile('fa-review', { sub: 'u-admin', role: 'admin' }, res);
      expect(minioClient.getObject).toHaveBeenCalledTimes(2);
    });
  });

  describe('合同文档内部用户公司隔离', () => {
    const contractAsset = {
      ...asset,
      category: 'contract_document',
      uploaderId: 'u-staff',
    };

    it('即使是上传人本人，资产已挂他企合同时仍拒绝下载', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(contractAsset);
      prisma.contract.findMany.mockResolvedValue([{ companyId: 'company-b' }]);

      await expect(service.streamFile('fa-1', { sub: 'u-staff', role: 'staff' }, res))
        .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });

      expect(companyScope.resolveScope).toHaveBeenCalledWith({ sub: 'u-staff', role: 'staff' });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('他企履约证明对本公司 staff 拒绝下载', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.contractFulfillment.findMany.mockResolvedValue([{
        contract: { companyId: 'company-b' },
      }]);

      await expect(service.streamFile('fa-1', { sub: 'u-staff', role: 'staff' }, res))
        .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('本公司合同凭证对非上传人经办人放行', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.contractFulfillment.findMany.mockResolvedValue([{
        contract: { companyId: 'company-a' },
      }]);

      await service.streamFile('fa-1', { sub: 'u-staff', role: 'staff' }, res);

      expect(minioClient.getObject).toHaveBeenCalled();
    });

    it('admin 可访问任何公司已引用的合同资产', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.contract.findMany.mockResolvedValue([{ companyId: 'company-b' }]);

      await service.streamFile('fa-1', { sub: 'u-admin', role: 'admin' }, res);

      expect(minioClient.getObject).toHaveBeenCalled();
    });

    it('未被合同链引用的 contract_document 仍按旧规则判定', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(contractAsset);
      await service.streamFile('fa-1', { sub: 'u-staff', role: 'staff' }, res);

      expect(companyScope.resolveScope).not.toHaveBeenCalled();
      expect(minioClient.getObject).toHaveBeenCalled();
    });

    it('存量资产同时被多公司合同引用时，非 admin 一律不放行', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.contract.findMany.mockResolvedValue([
        { companyId: 'company-a' },
        { companyId: 'company-b' },
      ]);

      await expect(service.streamFile('fa-1', { sub: 'u-staff', role: 'staff' }, res))
        .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('存量合同引用缺失 companyId 时对非 admin 默认拒绝', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.contract.findMany.mockResolvedValue([{ companyId: null }]);

      await expect(service.streamFile('fa-1', { sub: 'u-staff', role: 'staff' }, res))
        .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('即使是上传人本人，他企项目成交通知书也拒绝下载', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(contractAsset);
      prisma.awardLetterDelivery.findMany.mockResolvedValue([{
        project: { companyId: 'company-b' },
      }]);

      await expect(service.streamFile('fa-1', { sub: 'u-staff', role: 'staff' }, res))
        .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
      expect(prisma.awardLetterDelivery.findMany).toHaveBeenCalledWith({
        where: { letterAssetId: 'fa-1' },
        select: { project: { select: { companyId: true, assignedHostUserId: true } } },
      });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('本公司成交通知书对非上传人经办人放行', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.awardLetterDelivery.findMany.mockResolvedValue([{
        project: { companyId: 'company-a' },
      }]);

      await service.streamFile('fa-1', { sub: 'u-staff', role: 'staff' }, res);

      expect(minioClient.getObject).toHaveBeenCalled();
    });

    it('成交通知书引用中含他公司或缺失 companyId 时非 admin 一律拒绝', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.awardLetterDelivery.findMany.mockResolvedValue([
        { project: { companyId: 'company-a' } },
        { project: { companyId: null } },
      ]);

      await expect(service.streamFile('fa-1', { sub: 'u-staff', role: 'staff' }, res))
        .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('admin 可访问任意公司成交通知书', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.awardLetterDelivery.findMany.mockResolvedValue([{
        project: { companyId: 'company-b' },
      }]);

      await service.streamFile('fa-1', { sub: 'u-admin', role: 'admin' }, res);

      expect(minioClient.getObject).toHaveBeenCalled();
    });

    it('跨公司被指派的 bid_host 可回看其负责项目的成交通知书', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.awardLetterDelivery.findMany.mockResolvedValue([{
        project: { companyId: 'company-b', assignedHostUserId: 'u-host' },
      }]);

      await service.streamFile('fa-1', { sub: 'u-host', role: 'bid_host' }, res);

      expect(minioClient.getObject).toHaveBeenCalled();
    });

    it('未被指派的 bid_host 不可借角色跨公司下载通知书', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.awardLetterDelivery.findMany.mockResolvedValue([{
        project: { companyId: 'company-b', assignedHostUserId: 'u-another-host' },
      }]);

      await expect(service.streamFile('fa-1', { sub: 'u-host', role: 'bid_host' }, res))
        .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('资产同时被合同引用时，指派主持人不能绕过合同公司域', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...contractAsset, uploaderId: 'u-other' });
      prisma.contract.findMany.mockResolvedValue([{ companyId: 'company-a' }]);
      prisma.awardLetterDelivery.findMany.mockResolvedValue([{
        project: { companyId: 'company-b', assignedHostUserId: 'u-host' },
      }]);

      await expect(service.streamFile('fa-1', { sub: 'u-host', role: 'bid_host' }, res))
        .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });
  });

  it('denies admin when bid submission file is not yet decrypted', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(asset);
    prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 's1', projectId: 'p1' });
    prisma.bidSupplier.findFirst.mockResolvedValue(null); // not decrypted
    await expect(service.streamFile('fa-1', { sub: 'u-admin', role: 'admin' }, res))
      .rejects.toThrow(ForbiddenException);
    expect(minioClient.getObject).not.toHaveBeenCalled();
  });

  it('allows admin when bid submission file is decrypted', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(asset);
    // where-aware：旧轨 submission（envelopeVersion 非 dual-v2）→ 不触发 SEALED_NO_DOWNLOAD
    prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
      isDualOuterQuery(where) ? null : { supplierId: 's1', projectId: 'p1' }); // P1-3：形状分流（dual 外层判定不误伤授权反查）
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', decryptStatus: 'SUCCESS' });
    await service.streamFile('fa-1', { sub: 'u-admin', role: 'admin' }, res);
    expect(minioClient.getObject).toHaveBeenCalled();
  });

  it('denies an unrelated supplier (403)', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(asset);
    await expect(service.streamFile('fa-1', { sub: 'u-other', role: 'supplier' }, res))
      .rejects.toThrow(ForbiddenException);
    expect(minioClient.getObject).not.toHaveBeenCalled();
  });

  it('allows only the recipient supplier to view an admin-uploaded award letter', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: 'contract_document', uploaderId: 'u-admin' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', userId: 'u-supplier', logoUrl: null });
    prisma.bidSupplier.findMany.mockResolvedValue([{ id: 'bid-supplier-1' }]);
    prisma.awardLetterDelivery.findFirst.mockResolvedValue({ id: 'delivery-1' });

    await service.streamFile('fa-1', { sub: 'u-supplier', role: 'supplier' }, res);

    expect(prisma.awardLetterDelivery.findFirst).toHaveBeenCalledWith({
      where: { letterAssetId: 'fa-1', supplierId: { in: ['bid-supplier-1'] } },
      select: { id: true },
    });
    expect(minioClient.getObject).toHaveBeenCalled();
  });

  it('allows a supplier to view files referenced by its own contract', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: 'contract_document', uploaderId: 'u-admin' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', userId: 'u-supplier', logoUrl: null });
    prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1' });

    await service.streamFile('fa-1', { sub: 'u-supplier', role: 'supplier' }, res);

    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: {
        supplierId: 'supplier-1',
        signedAssetId: 'fa-1',
        status: { in: ['signed', 'performing', 'accepted', 'terminated'] },
      },
      select: { id: true },
    });
    expect(minioClient.getObject).toHaveBeenCalled();
  });

  it('供应商即使知道 assetId 也不能下载采购人合同草稿', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: 'contract_document', uploaderId: 'u-admin' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', userId: 'u-supplier', logoUrl: null });
    // 仿真草稿资产：只有查询 draftAssetId 才会命中，安全实现不应发出该条件。
    prisma.contract.findFirst.mockImplementation(({ where }: any) => (
      where?.OR?.some((clause: any) => clause.draftAssetId === 'fa-1') ? { id: 'draft-contract' } : null
    ));

    await expect(service.streamFile('fa-1', { sub: 'u-supplier', role: 'supplier' }, res))
      .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
    expect(minioClient.getObject).not.toHaveBeenCalled();
  });

  it('草拟/内审阶段的存量 signedAssetId 对供应商仍拒绝下载', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: 'contract_document', uploaderId: 'u-admin' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', userId: 'u-supplier', logoUrl: null });
    prisma.contract.findFirst.mockImplementation(({ where }: any) => {
      if (where?.OR?.some((clause: any) => clause.signedAssetId === 'fa-1' && !clause.status)) {
        return { id: 'internal-review-contract' };
      }
      return null;
    });

    await expect(service.streamFile('fa-1', { sub: 'u-supplier', role: 'supplier' }, res))
      .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
    expect(minioClient.getObject).not.toHaveBeenCalled();
  });

  it('allows an expert assigned to the project that owns the asset', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(asset);
    // where-aware：旧轨 submission（envelopeVersion 非 dual-v2）→ 不触发 SEALED_NO_DOWNLOAD
    prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
      isDualOuterQuery(where) ? null : { supplierId: 's1', projectId: 'p1' }); // P1-3：形状分流（dual 外层判定不误伤授权反查）
    prisma.bidExpert.findFirst.mockResolvedValue({ projectId: 'p1' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '测试供应商' });

    await service.streamFile('fa-1', { sub: 'u-exp', role: 'bid_expert' }, res);

    // 专家必须按 asset 所属项目精确匹配，而非取任意一条 expert 记录
    expect(prisma.bidExpert.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u-exp', projectId: 'p1' }) }),
    );
    expect(minioClient.getObject).toHaveBeenCalled();
    // 审计：记录专家文件访问
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'p1', role: '专家', target: '测试供应商', action: '文件访问',
        }),
      }),
    );
  });

  it('allows a multi-project expert to view an asset from their other project', async () => {
    // 专家同时被分配到 p1 与 p2；该 asset 属于 p2
    prisma.fileAsset.findUnique.mockResolvedValue(asset);
    // where-aware：旧轨 submission（envelopeVersion 非 dual-v2）→ 不触发 SEALED_NO_DOWNLOAD
    prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
      isDualOuterQuery(where) ? null : { supplierId: 's1', projectId: 'p2' }); // P1-3：同上形状分流
    prisma.bidExpert.findFirst.mockResolvedValue({ projectId: 'p2' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '测试供应商' });

    await service.streamFile('fa-1', { sub: 'u-exp', role: 'bid_expert' }, res);

    expect(prisma.bidExpert.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: 'p2' }) }),
    );
    expect(minioClient.getObject).toHaveBeenCalled();
  });

  it('denies an expert assigned to a different project than the asset', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(asset);
    prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 's1', projectId: 'p2' });
    prisma.bidExpert.findFirst.mockResolvedValue(null); // 专家不在 p2

    await expect(service.streamFile('fa-1', { sub: 'u-exp', role: 'bid_expert' }, res))
      .rejects.toThrow(ForbiddenException);
  });

  it('denies an expert when no submission references the asset', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(asset);
    prisma.supplierBidSubmission.findFirst.mockResolvedValue(null);

    await expect(service.streamFile('fa-1', { sub: 'u-exp', role: 'bid_expert' }, res))
      .rejects.toThrow(ForbiddenException);
  });

  it('throws NotFound for missing file', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(null);
    await expect(service.streamFile('missing', { sub: 'u', role: 'admin' }, res))
      .rejects.toThrow(NotFoundException);
  });

  describe('H7 — delete 引用检查', () => {
    /** P1-3 查询形状分流：v2=AND[0].envelopeVersion、v3=AND[0].envelopeVersion、四列=顶层 OR 含列键 */
    const isV2Query = (where: any) => where?.AND?.[0]?.envelopeVersion === 'dual-v2' || where?.envelopeVersion === 'dual-v2';
    const isV3Query = (where: any) => where?.AND?.[0]?.envelopeVersion === 'dual-v3';
    const isFourColQuery = (where: any) =>
      Array.isArray(where?.OR) && where.OR.some((c: any) => c?.technicalFileAssetId || c?.bidBondAssetId);

    it('文件已被 SupplierBidSubmission 引用时拒绝删除', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(asset);
      // where-aware：v2/v3 C_outer 查询无命中 → 走旧轨四列引用保护
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }: any) => {
        if (isV2Query(where) || isV3Query(where)) return null;
        if (isFourColQuery(where)) return { id: 'sub1' };
        return null;
      });
      jest.spyOn(minioClient, 'removeObject').mockClear().mockResolvedValue(undefined as any);

      await expect(service.delete('uploads/x.pdf', { sub: 'u-supplier', role: 'supplier' }))
        .rejects.toMatchObject({ response: { code: 'FILE_REFERENCED' } });
      expect(minioClient.removeObject).not.toHaveBeenCalled();
      expect(prisma.fileAsset.delete).not.toHaveBeenCalled();
    });

    it('未被引用时正常删除（MinIO 对象 + 元数据）', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(asset);
      prisma.supplierBidSubmission.findFirst.mockResolvedValue(null); // 未引用
      prisma.fileAsset.delete.mockResolvedValue({});
      jest.spyOn(minioClient, 'removeObject').mockClear().mockResolvedValue(undefined as any);

      await expect(service.delete('uploads/x.pdf', { sub: 'u-supplier', role: 'supplier' }))
        .resolves.toMatchObject({ deleted: true });
      expect(minioClient.removeObject).toHaveBeenCalled();
      expect(prisma.fileAsset.delete).toHaveBeenCalledWith({ where: { key: 'uploads/x.pdf' } });
    });

    it('P1-3：已被 dual-v3 信封引用的 C_outer（ uploader 本人删）→ 409 FILE_REFERENCED——防截标后删件毁解密链', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(asset);
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }: any) =>
        isV3Query(where) ? { id: 'sub-v3' } : null);
      jest.spyOn(minioClient, 'removeObject').mockClear().mockResolvedValue(undefined as any);

      await expect(service.delete('uploads/x.pdf', { sub: 'u-supplier', role: 'supplier' }))
        .rejects.toMatchObject({ response: { code: 'FILE_PROTECTED' } }); // category=bid_document 先吃 FILE_PROTECTED（更强的语义）
      expect(minioClient.removeObject).not.toHaveBeenCalled();
    });

    it('P1-3：非 bid_document 类目但被 BidFileBackup 备份引用（v3 补传历史版本资产）→ 409 FILE_REFERENCED', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: 'general' });
      prisma.supplierBidSubmission.findFirst.mockResolvedValue(null);
      prisma.bidFileBackup.findFirst.mockResolvedValue({ id: 'bk-1' });
      jest.spyOn(minioClient, 'removeObject').mockClear().mockResolvedValue(undefined as any);

      await expect(service.delete('uploads/x.pdf', { sub: 'u-supplier', role: 'supplier' }))
        .rejects.toMatchObject({ response: { code: 'FILE_REFERENCED' } });
      expect(prisma.fileAsset.delete).not.toHaveBeenCalled();
    });
  });

  describe('§5.5b — 解密链路资产删除保护（Task 18）', () => {
    beforeEach(() => {
      jest.spyOn(minioClient, 'removeObject').mockClear().mockResolvedValue(undefined as any);
    });

    it('bid_decrypted 明文资产（admin 亦）→ 409 FILE_PROTECTED，不落 MinIO 删除', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({
        ...asset, id: 'fa-dec', category: 'bid_decrypted', uploaderId: 'u-supplier',
      });

      await expect(service.delete('uploads/dec.pdf', { sub: 'u-admin', role: 'admin' }))
        .rejects.toMatchObject({ response: { code: 'FILE_PROTECTED' } });
      expect(minioClient.removeObject).not.toHaveBeenCalled();
      expect(prisma.fileAsset.delete).not.toHaveBeenCalled();
    });

    it('被 dual-v2 submission 四列引用的 bid_document（C_outer）→ 409 FILE_PROTECTED', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({
        ...asset, id: 'fa-outer', category: 'bid_document', uploaderId: 'u-supplier',
      });
      // P1-3 查询形状：v2 判定迁移至 AND[0].envelopeVersion（顶层 envelopeVersion 键不复存在）
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }: any) =>
        where?.AND?.[0]?.envelopeVersion === 'dual-v2' ? { id: 'sub-1' } : null);

      await expect(service.delete('uploads/outer.enc', { sub: 'u-admin', role: 'admin' }))
        .rejects.toMatchObject({ response: { code: 'FILE_PROTECTED' } });
      expect(minioClient.removeObject).not.toHaveBeenCalled();
    });

    it('P1-3：被 dual-v3 信封引用的 bid_document（C_outer）→ 409 FILE_PROTECTED（v3 不写四列，按信封 path 反查）', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({
        ...asset, id: 'fa-outer-v3', category: 'bid_document', uploaderId: 'u-supplier',
      });
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }: any) =>
        where?.AND?.[0]?.envelopeVersion === 'dual-v3' ? { id: 'sub-v3' } : null);

      await expect(service.delete('uploads/outer-v3.enc', { sub: 'u-admin', role: 'admin' }))
        .rejects.toMatchObject({ response: { code: 'FILE_PROTECTED' } });
      expect(minioClient.removeObject).not.toHaveBeenCalled();
    });

    it('P1-3：仅被 BidFileBackup 备份引用（补传后历史版本 C_outer）→ 409 FILE_PROTECTED（证据件不丢）', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({
        ...asset, id: 'fa-outer-old', category: 'bid_document', uploaderId: 'u-supplier',
      });
      prisma.supplierBidSubmission.findFirst.mockResolvedValue(null); // 当前信封/四列均已不引用（补传替换）
      prisma.bidFileBackup.findFirst.mockResolvedValue({ id: 'bk-old' });

      await expect(service.delete('uploads/outer-old.enc', { sub: 'u-admin', role: 'admin' }))
        .rejects.toMatchObject({ response: { code: 'FILE_PROTECTED' } });
      expect(minioClient.removeObject).not.toHaveBeenCalled();
    });

    it('旧轨四列引用仍 409 FILE_REFERENCED（dual 判定先行不吞旧轨保护）', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(asset);
      // P1-3 查询形状：四列查询为顶层 OR（无 envelopeVersion 前缀）
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }: any) => {
        if (where?.AND?.[0]?.envelopeVersion) return null; // dual-v2/v3 判定不命中
        return { id: 'sub-legacy' }; // 旧轨四列命中
      });

      await expect(service.delete('uploads/x.pdf', { sub: 'u-supplier', role: 'supplier' }))
        .rejects.toMatchObject({ response: { code: 'FILE_REFERENCED' } });
      expect(minioClient.removeObject).not.toHaveBeenCalled();
    });
  });

  describe('§P0-5 — 开评标留痕资产删除保护（category 全集 + 引用反查兜底）', () => {
    const EVIDENCE_CATEGORIES = [
      'bid_opening_handover', 'bid_evaluation_handover', 'bid_evaluation_sign_handover',
      'bid_sign_packet', 'sign_packet_signature_page', 'expert_sign_scan',
      'expert_memo_ink', 'expert_signin_photo', 'ai_bid_report',
    ];

    beforeEach(() => {
      jest.spyOn(minioClient, 'removeObject').mockClear().mockResolvedValue(undefined as any);
    });

    for (const cat of [...EVIDENCE_CATEGORIES, 'opening_sign_page', 'opening_sign_scan']) {
      it(`${cat} 资产（admin 亦）→ 409 FILE_PROTECTED，不落 MinIO 删除`, async () => {
        prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: cat, uploaderId: 'u-host' });

        await expect(service.delete('uploads/evidence.bin', { sub: 'u-admin', role: 'admin' }))
          .rejects.toMatchObject({ response: { code: 'FILE_PROTECTED' } });
        expect(minioClient.removeObject).not.toHaveBeenCalled();
        expect(prisma.fileAsset.delete).not.toHaveBeenCalled();
      });
    }

    it('反查兜底：中标通知书 DOCX 被 AwardLetterDelivery 引用 → 409 FILE_PROTECTED', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: 'general' });
      prisma.awardLetterDelivery.findFirst.mockResolvedValue({ id: 'ald-1' });

      await expect(service.delete('uploads/letter.docx', { sub: 'u-admin', role: 'admin' }))
        .rejects.toMatchObject({ response: { code: 'FILE_PROTECTED' } });
      expect(minioClient.removeObject).not.toHaveBeenCalled();
    });

    it('反查兜底：签字包 PDF 被 BidSignPacket 引用 → 409 FILE_PROTECTED', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: 'general' });
      prisma.bidSignPacket.findFirst.mockResolvedValue({ id: 'sp-1' });

      await expect(service.delete('uploads/packet.pdf', { sub: 'u-admin', role: 'admin' }))
        .rejects.toMatchObject({ response: { code: 'FILE_PROTECTED' } });
      expect(minioClient.removeObject).not.toHaveBeenCalled();
    });

    it.each([
      ['合同正文', 'contract', 'draftAssetId'],
      ['签署版合同', 'contract', 'signedAssetId'],
      ['履约证明', 'contractFulfillment', 'proofAssetId'],
    ])('反查兜底：%s被引用后不可删除', async (_label, model, _field) => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: 'contract_document' });
      prisma[model].findFirst.mockResolvedValue({ id: 'ref-1' });

      await expect(service.delete('uploads/contract-proof.pdf', { sub: 'u-supplier', role: 'supplier' }))
        .rejects.toMatchObject({ response: { code: 'FILE_PROTECTED' } });
      expect(minioClient.removeObject).not.toHaveBeenCalled();
    });

    it('反查兜底：无任何引用的一般资产 → 照删（回归）', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue({ ...asset, category: 'general' });
      for (const k of ['awardLetterDelivery', 'bidSignPacket', 'bidOpeningSession', 'bidExpert', 'expertMemo', 'openingHallMessage']) {
        prisma[k].findFirst.mockResolvedValue(null);
      }
      prisma.supplierBidSubmission.findFirst.mockResolvedValue(null);

      await expect(service.delete('uploads/plain.pdf', { sub: 'u-supplier', role: 'supplier' })).resolves.toEqual({ deleted: true, key: 'uploads/plain.pdf' });
    });
  });

  describe('§5.4a dual 家下载分派（P1-3 起含 v3）', () => {
    const dualOuter = {
      ...asset, id: 'fa-outer', category: 'bid_document', clientEncrypted: true, uploaderId: 'u-supplier',
    };
    /** P1-3：v3 C_outer 暂存资产——无 clientEncrypted/encrypted/sealedKey 任何标志（四加密分支全不命中） */
    const v3Outer = {
      ...asset, id: 'fa-outer-v3', category: 'bid_document', clientEncrypted: false, encrypted: false, sealedKey: null, uploaderId: 'u-supplier',
    };
    const cInner = {
      ...asset, id: 'fa-inner', category: 'bid_inner_ciphertext', clientEncrypted: false, uploaderId: 'u-host',
    };
    const decAsset = {
      ...asset, id: 'fa-dec', category: 'bid_decrypted', clientEncrypted: false, uploaderId: 'u-supplier',
    };

    it('供应商本人下载 dual-v2 C_outer → 400 SEALED_NO_DOWNLOAD', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(dualOuter);
      // P1-3 查询形状：OR[0].AND[0].envelopeVersion（顶层 envelopeVersion 键已迁入 AND）
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
        where?.OR?.[0]?.AND?.[0]?.envelopeVersion === 'dual-v2' ? { id: 'sub-1' } : null);

      await expect(service.streamFile('fa-outer', { sub: 'u-supplier', role: 'supplier' }, res))
        .rejects.toMatchObject({ response: { code: 'SEALED_NO_DOWNLOAD' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('P1-3：供应商本人下载 dual-v3 C_outer → 400 SEALED_NO_DOWNLOAD（原走兜底分支直出密文）', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(v3Outer);
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
        isDualOuterQuery(where) ? { id: 'sub-v3' } : null); // SEALED 段外层查询命中（v3Filter 在 OR[1]）

      await expect(service.streamFile('fa-outer-v3', { sub: 'u-supplier', role: 'supplier' }, res))
        .rejects.toMatchObject({ response: { code: 'SEALED_NO_DOWNLOAD' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('P1-3：管理角色（staff）下载 dual-v3 C_outer（解密前）→ 403 FILE_FORBIDDEN（v3 信封命中 SUCCESS 闸，不再兜底放行）', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(v3Outer);
      // canAccessFile 管理角色分支（OR[0]=列条件+v3Filter 混入）：命中 → 查 bidSupplier SUCCESS → null → 拒绝
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
        !isDualOuterQuery(where) && !isV3OnlyQuery(where)
          ? { supplierId: 'sys-1', projectId: 'p1' }
          : null);
      prisma.bidSupplier.findFirst.mockResolvedValue(null); // 解密未成功

      await expect(service.streamFile('fa-outer-v3', { sub: 'u-staff', role: 'staff' }, res))
        .rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('旧轨 clientEncrypted 资产本人下载不触发 SEALED（进入 E2EE 分支）', async () => {
      // 判定必须限定 dual-v2 引用——旧轨供应商本人下载明文是合法功能
      prisma.fileAsset.findUnique.mockResolvedValue({ ...dualOuter, id: 'fa-legacy-e2ee' });
      prisma.supplierBidSubmission.findFirst.mockResolvedValue(null); // 无 dual-v2 引用、无 submission

      await expect(service.streamFile('fa-legacy-e2ee', { sub: 'u-supplier', role: 'supplier' }, res))
        .rejects.toMatchObject({ response: { code: 'MISSING_SEALED_KEY' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('项目成员下载 C_inner → 放行（原样字节输出）', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(cInner);
      prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 'sys-1', projectId: 'p1' });
      prisma.supplier.findUnique.mockResolvedValue({ userId: 'u-supplier' });

      await service.streamFile('fa-inner', { sub: 'u-supplier', role: 'supplier' }, res);
      expect(minioClient.getObject).toHaveBeenCalled();
    });

    it('非成员下载 C_inner → 403', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(cInner);
      prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 'sys-1', projectId: 'p1' });
      prisma.supplier.findUnique.mockResolvedValue({ userId: 'u-supplier' }); // 真正的成员

      await expect(service.streamFile('fa-inner', { sub: 'u-other', role: 'supplier' }, res))
        .rejects.toThrow(ForbiddenException);
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('P2-7：专家下载投标文件在评标启动前（OPENING 期）→ 403 EVALUATION_NOT_STARTED（旁路端点补齐专家专用链启动闸）', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(decAsset);
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
        isDualOuterQuery(where) ? null : { supplierId: 'sys-1', projectId: 'p1' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e1', projectId: 'p1' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '甲', decryptStatus: 'SUCCESS' });
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' }); // 解密 SUCCESS 但评标未启动

      await expect(service.streamFile('fa-dec', { sub: 'u-expert', role: 'bid_expert' }, res))
        .rejects.toMatchObject({ response: { code: 'EVALUATION_NOT_STARTED' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('staff 下载 bid_decrypted 且供应商 SUCCESS → 放行', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(decAsset);
      prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 'sys-1', projectId: 'p1' });
      prisma.supplier.findUnique.mockResolvedValue({ userId: 'u-supplier' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', decryptStatus: 'SUCCESS' });

      await service.streamFile('fa-dec', { sub: 'u-staff', role: 'staff' }, res);
      expect(minioClient.getObject).toHaveBeenCalled();
    });

    it('staff 下载 bid_decrypted 且供应商未 SUCCESS → 403', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(decAsset);
      prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 'sys-1', projectId: 'p1' });
      prisma.supplier.findUnique.mockResolvedValue({ userId: 'u-supplier' });
      prisma.bidSupplier.findFirst.mockResolvedValue(null); // 未解密成功

      await expect(service.streamFile('fa-dec', { sub: 'u-staff', role: 'staff' }, res))
        .rejects.toThrow(ForbiddenException);
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });

    it('本项目专家下载 bid_decrypted（SUCCESS 门控）→ 放行并写监督日志', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(decAsset);
      prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 'sys-1', projectId: 'p1' });
      prisma.supplier.findUnique.mockResolvedValue({ userId: 'u-supplier' });
      prisma.bidExpert.findFirst.mockResolvedValue({ projectId: 'p1' });
      prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '测试供应商' });

      await service.streamFile('fa-dec', { sub: 'u-exp', role: 'bid_expert' }, res);
      expect(minioClient.getObject).toHaveBeenCalled();
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ projectId: 'p1', role: '专家' }) }),
      );
    });

    it('非本项目专家下载 bid_decrypted → 403', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(decAsset);
      prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 'sys-1', projectId: 'p2' });
      prisma.supplier.findUnique.mockResolvedValue({ userId: 'u-supplier' });
      prisma.bidExpert.findFirst.mockResolvedValue(null);

      await expect(service.streamFile('fa-dec', { sub: 'u-exp', role: 'bid_expert' }, res))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('旧轨服务端密封资产 sealedPath 流式解密（clean-legacy-plaintext 清理后回看）', () => {
    // 终审 named-risk 修复：cleanup 删除 asset.key 明文后，旧轨密封资产（encrypted && sealedPath）
    // 的通用下载必须从 sealedPath 读密文并 KMS 解密输出——否则供应商回看/staff/专家下载 404。
    const DUMMY_RAW_KEY = `${'a'.repeat(64)}:${'b'.repeat(24)}:${'c'.repeat(32)}`; // key:iv:authTag hex
    const sealedAsset = {
      ...asset, id: 'fa-sealed', key: 'uploads/legacy.pdf', encrypted: true,
      clientEncrypted: false, sealedPath: 'sealed/legacy.pdf.enc',
    };

    it('旧轨密封资产从 sealedPath 读取并解密输出（key 明文对象已清理）', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(sealedAsset);
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
        isDualOuterQuery(where) ? null
          : { id: 'sub-1', technicalFileAssetId: 'fa-sealed', technicalSealedKey: DUMMY_RAW_KEY }); // P1-3：形状分流
      // 链式 pipe（生产 MinIO 流 pipe 返回自身；mock 需同形）
      (minioClient.getObject as jest.Mock).mockResolvedValue({ pipe: jest.fn(() => ({ pipe: jest.fn() })) } as any);

      await service.streamFile('fa-sealed', { sub: 'u-supplier', role: 'supplier' }, res);

      expect(minioClient.getObject).toHaveBeenCalledWith(expect.anything(), 'sealed/legacy.pdf.enc');
      expect(res.setHeader).toHaveBeenCalled();
    });

    it('旧轨密封资产缺 sealedKey → 400 MISSING_SEALED_KEY', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(sealedAsset);
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
        isDualOuterQuery(where) ? null : { id: 'sub-1', technicalFileAssetId: 'fa-sealed', technicalSealedKey: null }); // P1-3：形状分流

      await expect(service.streamFile('fa-sealed', { sub: 'u-supplier', role: 'supplier' }, res))
        .rejects.toMatchObject({ response: { code: 'MISSING_SEALED_KEY' } });
      expect(minioClient.getObject).not.toHaveBeenCalled();
    });
  });

  describe('通用服务端密封（2026-10-12 密文评估 P1-1）', () => {
    const plain = Buffer.from('%PDF-1.7\nqualification-proof');
    const sealFile = {
      mimetype: 'application/pdf', originalname: 'license.pdf', buffer: plain, size: plain.length,
    } as Express.Multer.File;

    let prevKms: string | undefined;
    let prevSealSwitch: string | undefined;

    beforeEach(() => {
      prevKms = process.env.KMS_SECRET;
      prevSealSwitch = process.env.UPLOAD_SERVER_SEAL;
      process.env.KMS_SECRET = 'unit-test-kms-secret-0123456789abcdef';
      delete process.env.UPLOAD_SERVER_SEAL;
      prisma.fileAsset.create.mockImplementation(({ data }: any) => ({ id: 'fa-new', ...data, createdAt: new Date() }));
      jest.spyOn(minioClient, 'putObject').mockClear().mockResolvedValue({} as any);
    });
    afterEach(() => {
      if (prevKms === undefined) delete process.env.KMS_SECRET; else process.env.KMS_SECRET = prevKms;
      if (prevSealSwitch === undefined) delete process.env.UPLOAD_SERVER_SEAL; else process.env.UPLOAD_SERVER_SEAL = prevSealSwitch;
    });

    it('qualification 类目上传：MinIO 落密文、encrypted/sealedKey 落库、KMS 包裹可解回原文', async () => {
      await service.upload(sealFile, 'qualification', 'u-1');

      const putArgs = (minioClient.putObject as jest.Mock).mock.calls[0];
      const stored: Buffer = putArgs[2];
      expect(stored.equals(plain)).toBe(false); // 落的是密文
      const created = prisma.fileAsset.create.mock.calls[0][0].data;
      expect(created.encrypted).toBe(true);
      expect(created.clientEncrypted).toBe(false);
      expect(typeof created.sealedKey).toBe('string');
      // 端到端回读：unwrap DEK → 解密 == 原文（保证下载分支必然可还原）
      const { unwrapKey } = await import('../common/crypto/envelope-crypto');
      const { decryptBuffer } = await import('../announcement/bid-document.crypto');
      const rawKey = unwrapKey(created.sealedKey, 'unit-test-kms-secret-0123456789abcdef');
      expect(decryptBuffer(stored, rawKey).equals(plain)).toBe(true);
    });

    it.each(['announcement', 'bid_document'])('%s 类目不密封（公开级/投标轨排除）', async (category) => {
      await service.upload(sealFile, category, 'u-1');
      const stored: Buffer = (minioClient.putObject as jest.Mock).mock.calls[0][2];
      expect(stored.equals(plain)).toBe(true); // 原文直存
      expect(prisma.fileAsset.create.mock.calls[0][0].data.sealedKey).toBeUndefined();
    });

    it('UPLOAD_SERVER_SEAL=false 运维逃生口：明文直存', async () => {
      process.env.UPLOAD_SERVER_SEAL = 'false';
      await service.upload(sealFile, 'qualification', 'u-1');
      const stored: Buffer = (minioClient.putObject as jest.Mock).mock.calls[0][2];
      expect(stored.equals(plain)).toBe(true);
      expect(prisma.fileAsset.create.mock.calls[0][0].data.sealedKey).toBeUndefined();
    });

    it('sealedKey 资产下载走通用解密分支（读 sealedPath||key + 解密流 + Content-Length）', async () => {
      const { encryptBuffer } = await import('../announcement/bid-document.crypto');
      const { wrapKey } = await import('../common/crypto/envelope-crypto');
      const sealed = encryptBuffer(plain);
      const genericSealedAsset = {
        ...asset, id: 'fa-gseal', key: 'uploads/2026-10-12/ab.pdf', category: 'qualification',
        uploaderId: 'u-1', clientEncrypted: false, sealedPath: null, size: plain.length,
        sealedKey: wrapKey(sealed.decryptKey, 'unit-test-kms-secret-0123456789abcdef'),
      };
      prisma.fileAsset.findUnique.mockResolvedValue(genericSealedAsset);
      prisma.supplierBidSubmission.findFirst.mockResolvedValue(null);
      (minioClient.getObject as jest.Mock)
        .mockClear()
        .mockResolvedValue({ pipe: jest.fn(() => ({ pipe: jest.fn() })) } as any);

      await service.streamFile('fa-gseal', { sub: 'u-1', role: 'supplier' }, res);

      // 密文读点 = asset.key（新上传无 sealedPath）；不查 submission（密钥自持）
      expect(minioClient.getObject).toHaveBeenCalledWith(expect.anything(), 'uploads/2026-10-12/ab.pdf');
      expect(prisma.supplierBidSubmission.findFirst).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', String(plain.length));
    });

    it('KMS 未配置时降级明文不抛错（dev 形态；生产由启动守卫拦截）', async () => {
      delete process.env.KMS_SECRET;
      await expect(service.upload(sealFile, 'qualification', 'u-1')).resolves.toBeTruthy();
      const stored: Buffer = (minioClient.putObject as jest.Mock).mock.calls[0][2];
      expect(stored.equals(plain)).toBe(true);
    });
  });
});
