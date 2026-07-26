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
    prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 's1', projectId: 'p1' });
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
    prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 's1', projectId: 'p1' });
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
    prisma.supplierBidSubmission.findFirst.mockResolvedValue({ supplierId: 's1', projectId: 'p2' });
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
});
