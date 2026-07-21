import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
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
