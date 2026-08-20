import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UploadService } from './upload.service';
import { PrismaService } from '../prisma/prisma.service';
import { minioClient } from './minio.client';

describe('UploadService — download permission', () => {
  let service: UploadService;
  let prisma: any;
  let res: any;

  const asset = {
    id: 'fa-1', key: 'uploads/x.pdf', originalName: 'x.pdf',
    mimeType: 'application/pdf', size: 100, sha256: 'hash', category: 'bid_document', uploaderId: 'u-supplier',
  };

  beforeEach(async () => {
    prisma = {
      fileAsset: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
      bidExpert: { findFirst: jest.fn() },
      supplierBidSubmission: { findFirst: jest.fn() },
      bidSupplier: { findFirst: jest.fn() },
      supplier: { findUnique: jest.fn() },
      bidSupervisionLog: { create: jest.fn() },
    };
    res = { setHeader: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UploadService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UploadService>(UploadService);
    jest.spyOn(minioClient, 'getObject').mockClear().mockResolvedValue({ pipe: jest.fn() } as any);
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
      where?.envelopeVersion === 'dual-v2' ? null : { supplierId: 's1', projectId: 'p1' });
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

  it('allows an expert assigned to the project that owns the asset', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(asset);
    // where-aware：旧轨 submission（envelopeVersion 非 dual-v2）→ 不触发 SEALED_NO_DOWNLOAD
    prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
      where?.envelopeVersion === 'dual-v2' ? null : { supplierId: 's1', projectId: 'p1' });
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
      where?.envelopeVersion === 'dual-v2' ? null : { supplierId: 's1', projectId: 'p2' });
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
    it('文件已被 SupplierBidSubmission 引用时拒绝删除', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(asset);
      prisma.supplierBidSubmission.findFirst.mockResolvedValue({ id: 'sub1' }); // 被引用
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
  });

  describe('§5.4a dual-v2 下载分派', () => {
    const dualOuter = {
      ...asset, id: 'fa-outer', category: 'bid_document', clientEncrypted: true, uploaderId: 'u-supplier',
    };
    const cInner = {
      ...asset, id: 'fa-inner', category: 'bid_inner_ciphertext', clientEncrypted: false, uploaderId: 'u-host',
    };
    const decAsset = {
      ...asset, id: 'fa-dec', category: 'bid_decrypted', clientEncrypted: false, uploaderId: 'u-supplier',
    };

    it('供应商本人下载 dual-v2 C_outer → 400 SEALED_NO_DOWNLOAD', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(dualOuter);
      prisma.supplierBidSubmission.findFirst.mockImplementation(({ where }) =>
        where?.envelopeVersion === 'dual-v2' ? { id: 'sub-1' } : null);

      await expect(service.streamFile('fa-outer', { sub: 'u-supplier', role: 'supplier' }, res))
        .rejects.toMatchObject({ response: { code: 'SEALED_NO_DOWNLOAD' } });
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
});
