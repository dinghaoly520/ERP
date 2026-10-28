import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnnouncementAttachmentService } from './announcement-attachment.service';

jest.mock('../upload/minio.client', () => ({
  minioClient: { putObject: jest.fn(), removeObject: jest.fn(), getObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

 
const { minioClient } = require('../upload/minio.client');

describe('AnnouncementAttachmentService.attachFromObject', () => {
  const uploadsSubdir = resolve(process.cwd(), 'uploads', 'project-management');
  let tmpKey: string;
  let tmpPath: string;
  let service: AnnouncementAttachmentService;
  let prisma: any;
  const fileBuffer = Buffer.from('hello-procurement');

  beforeEach(async () => {
    jest.clearAllMocks();
    await mkdir(uploadsSubdir, { recursive: true });
    tmpKey = `project-management/spec-${Date.now()}.docx`;
    tmpPath = resolve(process.cwd(), 'uploads', tmpKey);
    await writeFile(tmpPath, fileBuffer);

    prisma = {
      announcement: { findUnique: jest.fn() },
      fileAsset: { create: jest.fn() },
      announcementAttachment: { create: jest.fn() },
    };
    service = new AnnouncementAttachmentService(prisma as PrismaService);
  });

  afterEach(async () => {
    await rm(tmpPath, { force: true });
  });

  it('公告不存在时抛出 NotFoundException', async () => {
    prisma.announcement.findUnique.mockResolvedValue(null);
    await expect(
      service.attachFromObject('ann-1', { objectKey: tmpKey, fileName: 'f.docx' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('源文件不存在时抛出 NotFoundException', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'ann-1' });
    await expect(
      service.attachFromObject('ann-1', {
        objectKey: 'project-management/never-exists.bin',
        fileName: 'x.bin',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('成功：读文件、算 sha256、传 MinIO、建 FileAsset 与附件', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'ann-1' });
    (minioClient.putObject as jest.Mock).mockResolvedValue(undefined);
    prisma.fileAsset.create.mockResolvedValue({ id: 'fa-1' });
    prisma.announcementAttachment.create.mockResolvedValue({ id: 'att-1', fileAssetId: 'fa-1' });

    const result = await service.attachFromObject(
      'ann-1',
      {
        objectKey: tmpKey,
        fileName: '采购文件.docx',
        mimeType: 'application/vnd.openxmlformats',
        size: 123,
        title: '采购文件',
      },
      'user-9',
    );

    const expectedSha = createHash('sha256').update(fileBuffer).digest('hex');
    expect(minioClient.putObject).toHaveBeenCalledWith(
      'test-bucket',
      expect.stringMatching(/^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.docx$/),
      fileBuffer,
      fileBuffer.length,
      { 'Content-Type': 'application/vnd.openxmlformats' },
    );
    expect(prisma.fileAsset.create).toHaveBeenCalledWith({
      data: {
        key: expect.stringMatching(/^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.docx$/),
        originalName: '采购文件.docx',
        mimeType: 'application/vnd.openxmlformats',
        size: 123,
        sha256: expectedSha,
        category: 'announcement',
        uploaderId: 'user-9',
      },
    });
    expect(prisma.announcementAttachment.create).toHaveBeenCalledWith({
      data: { announcementId: 'ann-1', fileAssetId: 'fa-1', title: '采购文件' },
      include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } },
    });
    expect(result).toEqual({ id: 'att-1', fileAssetId: 'fa-1' });
  });
});

describe('AnnouncementAttachmentService.stream 可见性闸门（2026-10-28：正文不可看则附件亦不可下载）', () => {
  let service: AnnouncementAttachmentService;
  let prisma: any;
  let res: any;

  const makeAtt = (announcement: Record<string, unknown>) => ({
    id: 'att-1',
    fileAssetId: 'fa-1',
    fileAsset: { id: 'fa-1', key: 'uploads/x.pdf', originalName: '附件.pdf', mimeType: 'application/pdf', size: 9 },
    announcement: { id: 'ann-1', relatedProjectCode: null, ...announcement },
  });

  const published = { status: 'PUBLISHED', publicityEnd: null, dataClass: null, metadata: {} };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      announcementAttachment: { findUnique: jest.fn() },
      announcement: { findUnique: jest.fn() },
      supplier: { findUnique: jest.fn() },
      bidProject: { findFirst: jest.fn().mockResolvedValue(null) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue(null) },
      fileAsset: { create: jest.fn() },
    };
    service = new AnnouncementAttachmentService(prisma as PrismaService);
    res = { setHeader: jest.fn() };
  });

  it('公开已发布公告：匿名放行并流式输出', async () => {
    prisma.announcementAttachment.findUnique.mockResolvedValue(makeAtt(published));
    const fakeStream = { pipe: jest.fn() };
    (minioClient.getObject as jest.Mock).mockResolvedValue(fakeStream);

    const stream = await service.stream('att-1', res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(stream).toBe(fakeStream);
    expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    expect(prisma.supplier.findUnique).not.toHaveBeenCalled();
  });

  it('公示期满（PUBLISHED 但 publicityEnd 已过）：拒绝下载', async () => {
    prisma.announcementAttachment.findUnique.mockResolvedValue(
      makeAtt({ ...published, publicityEnd: new Date(Date.now() - 86_400_000) }),
    );

    const err = await service.stream('att-1', res).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'PUBLICITY_ENDED' });
    expect(minioClient.getObject).not.toHaveBeenCalled();
  });

  it('已下线（ARCHIVED）：拒绝下载', async () => {
    prisma.announcementAttachment.findUnique.mockResolvedValue(makeAtt({ ...published, status: 'ARCHIVED' }));

    const err = await service.stream('att-1', res).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'OFFLINED' });
  });

  it('未发布（DRAFT）：拒绝下载', async () => {
    prisma.announcementAttachment.findUnique.mockResolvedValue(makeAtt({ ...published, status: 'DRAFT' }));

    const err = await service.stream('att-1', res).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'NOT_PUBLISHED' });
  });

  it('保密级 dataClass：拒绝下载（与 getPublic 同口径）', async () => {
    prisma.announcementAttachment.findUnique.mockResolvedValue(makeAtt({ ...published, dataClass: 'confidential' }));

    const err = await service.stream('att-1', res).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'NOT_PUBLIC' });
  });

  it('RESTRICTED 定向公告：匿名拒绝下载', async () => {
    prisma.announcementAttachment.findUnique.mockResolvedValue(
      makeAtt({ ...published, metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['sup-1'] } }),
    );

    const err = await service.stream('att-1', res).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'NOT_PUBLIC' });
  });

  it('RESTRICTED 定向公告：非白名单供应商拒绝下载', async () => {
    prisma.announcementAttachment.findUnique.mockResolvedValue(
      makeAtt({ ...published, metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['sup-1'] } }),
    );
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-other' });

    const err = await service.stream('att-1', res, { sub: 'user-2' }).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'NOT_PUBLIC' });
  });

  it('RESTRICTED 定向公告：白名单命中供应商放行', async () => {
    prisma.announcementAttachment.findUnique.mockResolvedValue(
      makeAtt({ ...published, metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['sup-1'] } }),
    );
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1' });
    const fakeStream = { pipe: jest.fn() };
    (minioClient.getObject as jest.Mock).mockResolvedValue(fakeStream);

    const stream = await service.stream('att-1', res, { sub: 'user-1' });

    expect(prisma.supplier.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
    expect(stream).toBe(fakeStream);
  });

  it('RESTRICTED 定向公告：白名单未命中但受邀参与关联项目的供应商放行（对齐采购文件「受邀即授权」口径）', async () => {
    // 邀请步骤后补的供应商只写 BidSupplier、不回写公告 restrictedSupplierIds——
    // 不得出现「项目机会正文可见、采购文件可下、附件却 400」的口径分叉
    prisma.announcementAttachment.findUnique.mockResolvedValue(
      makeAtt({
        ...published,
        relatedProjectCode: 'ZJ-TEST-1',
        metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['sup-1'] },
      }),
    );
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-other' });
    prisma.bidProject.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
    const fakeStream = { pipe: jest.fn() };
    (minioClient.getObject as jest.Mock).mockResolvedValue(fakeStream);

    const stream = await service.stream('att-1', res, { sub: 'user-2' });

    expect(prisma.bidProject.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectCode: { in: ['ZJ-TEST-1'] } } }),
    );
    expect(prisma.bidSupplier.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'proj-1', supplierId: 'sup-other' } }),
    );
    expect(stream).toBe(fakeStream);
  });

  it('RESTRICTED 定向公告：白名单外、且未受邀参与关联项目（无关联项目）仍拒绝', async () => {
    prisma.announcementAttachment.findUnique.mockResolvedValue(
      makeAtt({ ...published, metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['sup-1'] } }),
    );
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-other' });
    // bidProject.findFirst 默认 null（无关联项目）

    const err = await service.stream('att-1', res, { sub: 'user-2' }).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'NOT_PUBLIC' });
  });

  it('RESTRICTED 定向公告：白名单外、受邀反查也未命中仍拒绝', async () => {
    prisma.announcementAttachment.findUnique.mockResolvedValue(
      makeAtt({
        ...published,
        relatedProjectCode: 'ZJ-TEST-1',
        metadata: { visibility: 'RESTRICTED', restrictedSupplierIds: ['sup-1'] },
      }),
    );
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-other' });
    prisma.bidProject.findFirst.mockResolvedValue({ id: 'proj-1' });
    // bidSupplier.findFirst 默认 null（未受邀）

    const err = await service.stream('att-1', res, { sub: 'user-2' }).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'NOT_PUBLIC' });
  });
});
