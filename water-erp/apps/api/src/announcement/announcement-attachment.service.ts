import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

/** 普通公告附件（公开可下载，无加密/权限/付费）—— 复用既有 FileAsset */
@Injectable()
export class AnnouncementAttachmentService {
  private readonly logger = new Logger(AnnouncementAttachmentService.name);
  constructor(private prisma: PrismaService) {}

  async list(announcementId: string) {
    return this.prisma.announcementAttachment.findMany({
      where: { announcementId },
      include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async add(announcementId: string, fileAssetId: string, title: string) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!announcement) throw new NotFoundException({ error: '公告不存在', code: 'NOT_FOUND' });
    const fileAsset = await this.prisma.fileAsset.findUnique({ where: { id: fileAssetId } });
    if (!fileAsset) throw new NotFoundException({ error: '文件不存在', code: 'FILE_NOT_FOUND' });
    return this.prisma.announcementAttachment.create({
      data: { announcementId, fileAssetId, title: title || fileAsset.originalName },
      include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } },
    });
  }

  async remove(attachmentId: string) {
    const att = await this.prisma.announcementAttachment.findUnique({ where: { id: attachmentId }, include: { fileAsset: true } });
    if (!att) throw new NotFoundException({ error: '附件不存在', code: 'NOT_FOUND' });
    await this.prisma.announcementAttachment.delete({ where: { id: attachmentId } });
    // 清理 MinIO 对象，再清理 FileAsset 记录
    if (att.fileAsset) {
      try {
        await minioClient.removeObject(MINIO_BUCKET, att.fileAsset.key);
      } catch (e) {
        this.logger.warn(`MinIO 对象删除失败 ${att.fileAsset.key}: ${(e as Error).message}`);
      }
    }
    await this.prisma.fileAsset.delete({ where: { id: att.fileAssetId } }).catch(() => {});
    return { deleted: true };
  }

  /** 公开下载附件（流式，无需鉴权 —— 附件本身是公开文件） */
  async stream(attachmentId: string, res: any) {
    const att = await this.prisma.announcementAttachment.findUnique({
      where: { id: attachmentId },
      include: { fileAsset: true },
    });
    if (!att) throw new NotFoundException({ error: '附件不存在', code: 'NOT_FOUND' });
    const fa = att.fileAsset;
    res.setHeader('Content-Type', fa.mimeType);
    res.setHeader('Content-Length', String(fa.size));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fa.originalName)}"`);
    const stream = await minioClient.getObject(MINIO_BUCKET, fa.key);
    stream.pipe(res);
    return stream;
  }
}
