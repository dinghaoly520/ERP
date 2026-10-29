import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PUBLIC_VISIBLE_CLASSES } from '@water-erp/shared';
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

  /**
   * 从已有本地对象挂载公告附件（用于「引用项目采购文件」）。
   * 读取 uploads/<objectKey> 本地文件 → 复制到 MinIO → 建 FileAsset + AnnouncementAttachment。
   */
  async attachFromObject(
    announcementId: string,
    dto: {
      objectKey: string;
      fileName?: string;
      title?: string;
      mimeType?: string;
      size?: number;
    },
    userId?: string,
  ) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!announcement) {
      throw new NotFoundException({ error: '公告不存在', code: 'NOT_FOUND' });
    }

    const localPath = resolve(process.cwd(), 'uploads', dto.objectKey);
    try {
      await access(localPath);
    } catch {
      throw new NotFoundException({ error: '源文件不存在', code: 'SOURCE_NOT_FOUND' });
    }
    const buffer = await readFile(localPath);
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    const baseName = dto.fileName || dto.objectKey;
    const ext = baseName.includes('.') ? baseName.split('.').pop()!.toLowerCase() : 'bin';
    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    const mimeType = dto.mimeType || 'application/octet-stream';

    await minioClient.putObject(MINIO_BUCKET, key, buffer, buffer.length, {
      'Content-Type': mimeType,
    });

    const fileAsset = await this.prisma.fileAsset.create({
      data: {
        key,
        originalName: baseName,
        mimeType,
        size: dto.size ?? buffer.length,
        sha256,
        category: 'announcement',
        uploaderId: userId,
      },
    });

    return this.prisma.announcementAttachment.create({
      data: {
        announcementId,
        fileAssetId: fileAsset.id,
        title: dto.title || baseName,
      },
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

  /**
   * 附件下载闸门（2026-10-28）：与 getPublic 同口径——公开公告匿名可下；RESTRICTED 定向
   * 公告仅白名单供应商（登录 token → Supplier.userId 反查 → restrictedSupplierIds 命中）；
   * 已下线（公示期满 PUBLISHED / ARCHIVED）与未发布一律拒绝（2026-10-20 裁定「正文不可看
   * 则附件亦不可下载」此前只在列表/详情剥除层生效，凭附件 ID 直链可绕行——三端加入口后
   * 该绕行面变真，收口于此）。
   */
  private async assertDownloadable(ann: any, user?: { sub?: string; role?: string }) {
    // A2（表 B.1）：应保密/未公开级的公告，附件同为不可公开
    if (ann.dataClass && !(PUBLIC_VISIBLE_CLASSES as readonly string[]).includes(ann.dataClass)) {
      throw new BadRequestException({ error: '公告不存在或不可公开', code: 'NOT_PUBLIC' });
    }
    // P1 收口（同 getPublic）+「受邀即授权」（2026-10-21 既有裁定口径，对齐采购文件
    // checkEligibility）：RESTRICTED 定向公告附件放行集 = 被选定供应商（restrictedSupplierIds
    // 命中）∪ 公告关联项目的受邀供应商（BidSupplier）。邀请步骤后补的供应商只写 BidSupplier、
    // 不回写公告白名单——不得出现「项目机会正文可见、采购文件可下、附件却 400」的口径分叉。
    const meta = (ann.metadata ?? {}) as Record<string, unknown>;
    if (meta.visibility === 'RESTRICTED') {
      let eligible = false;
      if (user?.sub) {
        const supplier = await this.prisma.supplier.findUnique({
          where: { userId: user.sub },
          select: { id: true },
        });
        eligible =
          !!supplier &&
          Array.isArray(meta.restrictedSupplierIds) &&
          (meta.restrictedSupplierIds as string[]).includes(supplier.id);
        if (!eligible && supplier) {
          const codes = [ann.relatedProjectCode, typeof meta.projectCode === 'string' ? meta.projectCode : null]
            .filter((c): c is string => !!c);
          const project = codes.length > 0
            ? await this.prisma.bidProject.findFirst({ where: { projectCode: { in: codes } }, select: { id: true } })
            : null;
          if (project) {
            eligible = !!(await this.prisma.bidSupplier.findFirst({
              where: { projectId: project.id, supplierId: supplier.id },
              select: { id: true },
            }));
          }
        }
      }
      if (!eligible) {
        throw new BadRequestException({ error: '公告不存在或不可公开', code: 'NOT_PUBLIC' });
      }
    }
    if (ann.status === 'ARCHIVED') {
      throw new BadRequestException({ error: '该公告已下线，附件不再提供下载', code: 'OFFLINED' });
    }
    if (ann.status !== 'PUBLISHED') {
      throw new BadRequestException({ error: '公告未发布，附件不可下载', code: 'NOT_PUBLISHED' });
    }
    if (ann.publicityEnd && new Date(ann.publicityEnd).getTime() < Date.now()) {
      throw new BadRequestException({ error: '该公告公示期已过，附件不再提供下载', code: 'PUBLICITY_ENDED' });
    }
  }

  /** 公开下载附件（流式；匿名可下公开公告附件，可见性闸门与公告详情同口径） */
  async stream(attachmentId: string, res: any, user?: { sub?: string; role?: string }) {
    const att = await this.prisma.announcementAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        fileAsset: true,
        announcement: { select: { id: true, status: true, publicityEnd: true, dataClass: true, relatedProjectCode: true, metadata: true } },
      },
    });
    if (!att) throw new NotFoundException({ error: '附件不存在', code: 'NOT_FOUND' });
    await this.assertDownloadable(att.announcement, user);
    const fa = att.fileAsset;
    res.setHeader('Content-Type', fa.mimeType);
    res.setHeader('Content-Length', String(fa.size));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fa.originalName)}"`);
    const stream = await minioClient.getObject(MINIO_BUCKET, fa.key);
    stream.pipe(res);
    return stream;
  }
}
