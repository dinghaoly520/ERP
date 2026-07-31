import { Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';
import { AnnouncementAiService } from './announcement-ai.service';
import { BidService } from '../bid/bid.service';
import { openField } from '../common/crypto/field-crypto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private prisma: PrismaService,
    private announcementAi: AnnouncementAiService,
    @Optional() private bidService?: BidService,
  ) {}

  async create(dto: CreateAnnouncementDto, authorId?: string) {
    const aiSummary = dto.aiSummary ?? await this.announcementAi.summarize({
      title: dto.title,
      type: dto.type,
      content: dto.content,
    });

    const status = (dto.status as any) ?? 'DRAFT';

    const result = await this.prisma.announcement.create({
      data: {
        title: dto.title,
        content: dto.content,
        aiSummary,
        type: dto.type as any,
        summary: dto.summary,
        publishDate: dto.publishDate ? new Date(dto.publishDate) : new Date(),
        isTop: dto.isTop ?? false,
        relatedProjectCode: dto.relatedProjectCode,
        authorId,
        status,
        ...(dto.metadata !== undefined && { metadata: dto.metadata as any }),
      },
      include: { attachments: { include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } } } },
    });

    // P1: create 端点也触发联动（status=PUBLISHED + BID_NOTICE）
    const isPublishTransition = dto.type === 'BID_NOTICE' && status === 'PUBLISHED';
    if (isPublishTransition) {
      await this.syncBidProject(result.id, {
        id: result.id, title: result.title, publishDate: result.publishDate,
        metadata: result.metadata, relatedProjectCode: result.relatedProjectCode,
      });
      return this.get(result.id);
    }

    return result;
  }

  async list(params: { type?: string; status?: string; search?: string; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { content: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ isTop: 'desc' }, { publishDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          attachments: { include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } } },
          bidDocument: { select: { id: true, title: true, accessScope: true, requirePayment: true, price: true, downloadCount: true } },
        },
      }),
    ]);

    return { total, page, pageSize, items };
  }

  /** Public listing — only published items；公开端不含招标文件（首页不泄露）；RESTRICTED 可见范围不流转到首页 */
  async publicList(params: { type?: string; search?: string; page?: number; pageSize?: number }) {
    const res = await this.list({ ...params, status: 'PUBLISHED' });
    return { ...res, items: res.items
      .filter((a: any) => a.metadata?.visibility !== 'RESTRICTED')
      .map((a: any) => this.stripForPublic(a)) };
  }

  async get(id: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      include: {
        attachments: { include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } } },
        bidDocument: { select: { id: true, title: true, accessScope: true, requirePayment: true, price: true, downloadCount: true, fileAsset: { select: { originalName: true, size: true } } } },
      },
    });
    if (!announcement) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });
    return announcement;
  }

  async getPublic(id: string) {
    const announcement = await this.get(id);
    if (announcement.status !== 'PUBLISHED') {
      throw new BadRequestException({ error: '公告未发布', code: 'NOT_PUBLISHED' });
    }
    await this.prisma.announcement.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });
    // 公开端剔除招标文件，仅保留普通附件
    return this.stripForPublic(announcement);
  }

  /** 移除招标文件信息（首页/公开端不暴露） */
  private stripForPublic(a: any) {
    const { bidDocument, ...rest } = a;
    return rest;
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });

    const title = dto.title ?? announcement.title;
    const type = dto.type ?? announcement.type;
    const content = dto.content ?? announcement.content;
    const shouldRegenerateSummary = dto.aiSummary === undefined && (
      dto.title !== undefined || dto.content !== undefined || dto.type !== undefined
    );
    const aiSummary = dto.aiSummary ?? (shouldRegenerateSummary
      ? await this.announcementAi.summarize({ title, type, content })
      : undefined);

    const targetStatus = dto.status ?? announcement.status;
    const isPublishTransition =
      announcement.type === 'BID_NOTICE' &&
      announcement.status !== 'PUBLISHED' &&
      targetStatus === 'PUBLISHED';

    let result;
    try {
      result = await this.prisma.announcement.update({
        where: {
          id,
          ...(isPublishTransition ? { status: { not: 'PUBLISHED' } } : {}),
        },
        data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.type !== undefined && { type: dto.type as any }),
        ...(dto.summary !== undefined && { summary: dto.summary }),
        ...(aiSummary !== undefined && { aiSummary }),
        ...(dto.status !== undefined && { status: dto.status as any }),
        ...(dto.publishDate !== undefined && { publishDate: new Date(dto.publishDate) }),
        ...(dto.isTop !== undefined && { isTop: dto.isTop }),
        ...(dto.relatedProjectCode !== undefined && { relatedProjectCode: dto.relatedProjectCode }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata as any }),
      },
    });
    } catch (e: any) {
      if (
        isPublishTransition &&
        e?.code === 'P2025' // Prisma "record not found" — status already changed by concurrent request
      ) {
        // Re-fetch and return the already-published version (another request won the race)
        result = await this.prisma.announcement.findUnique({ where: { id } });
        this.logger.warn(
          `公告发布竞争：公告已由其他请求发布，跳过联动 (announcementId=${id})`,
        );
      } else {
        throw e;
      }
    }

    if (!result) {
      throw new BadRequestException({ error: '公告不存在或已删除', code: 'NOT_FOUND' });
    }

    // A1: WIN_NOTICE 发布时自动设置公示期（3 个日历日，Wave 1 简化）
    if (result.type === 'WIN_NOTICE' && targetStatus === 'PUBLISHED' && !result.publicityEnd) {
      const end = new Date(result.publishDate || new Date());
      end.setDate(end.getDate() + 3);
      await this.prisma.announcement.update({ where: { id: result.id }, data: { publicityEnd: end } });
      result.publicityEnd = end;
    }

    // ── 联动：BID_NOTICE 首次发布 → 创建 BidProject ──
    if (isPublishTransition) {
      await this.syncBidProject(id, { id: result.id, title: result.title, publishDate: result.publishDate, metadata: result.metadata, relatedProjectCode: result.relatedProjectCode });
      return this.get(id);
    }

    return result;
  }

  /** 联动：BID_NOTICE 发布时自动创建/同步 BidProject，幂等安全 */
  private async syncBidProject(annId: string, announcement: { id: string; title: string; publishDate: Date | null; metadata?: any; relatedProjectCode?: string | null }) {
    if (!this.bidService) return;
    try {
      const meta = AnnouncementService.validateMetadata(announcement.metadata);
      const existingProject = announcement.relatedProjectCode
        ? await this.prisma.bidProject.findUnique({
            where: { projectCode: announcement.relatedProjectCode },
          })
        : null;

      if (existingProject) {
        await this.bidService.syncFromAnnouncement(existingProject.id, { title: announcement.title }, meta);
        this.logger.log(`公告已关联项目 ${existingProject.projectCode}，同步更新字段`);
        // 流标公告：发布后自动将 BidProject 置为 ABORTED
        if (meta.category === 'failed_bid') {
          await this.bidService.abortBidProject(existingProject.id);
          this.logger.log(`流标公告已发布，项目 ${existingProject.projectCode} 已标记为 ABORTED`);
        }
      } else {
        const project = await this.bidService.createFromAnnouncement(
          { id: announcement.id, title: announcement.title, publishDate: announcement.publishDate }, meta,
        );
        await this.prisma.announcement.update({ where: { id: annId }, data: { relatedProjectCode: project.projectCode } });
        const bidDoc = await this.prisma.bidDocument.findUnique({ where: { announcementId: annId } });
        if (bidDoc) {
          await this.prisma.bidDocument.update({ where: { announcementId: annId }, data: { bidProjectId: project.id } });
        }
        this.logger.log(`公告首次发布，自动创建项目 ${project.projectCode}`);
      }
    } catch (e) {
      this.logger.error(`公告发布联动创建项目失败 (announcementId=${annId}): ${(e as Error).message}`, (e as Error).stack);
    }
  }

  async remove(id: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      select: { type: true, relatedProjectCode: true, status: true },
    });

    const relatedProjectCode =
      announcement &&
      announcement.type === 'BID_NOTICE' &&
      announcement.status === 'PUBLISHED'
        ? announcement.relatedProjectCode
        : null;

    const project = relatedProjectCode
      ? await this.prisma.bidProject.findUnique({
          where: { projectCode: relatedProjectCode },
          select: { id: true, projectCode: true, stage: true, riskNote: true },
        })
      : null;

    let sealedPathsToClean: string[] = [];

    try {
      await this.prisma.$transaction(async (tx) => {
        // Cleanup linked project before delete — reset to DOWNLOAD if progressed
        if (project) {
          const stageReset = project.stage !== 'DOWNLOAD' && project.stage !== 'ARCHIVED';
          await tx.bidProject.update({
            where: { projectCode: relatedProjectCode! },
            data: {
              stage: stageReset ? 'DOWNLOAD' : undefined,
              riskNote: (project.riskNote || '') + '（来源公告已删除）',
            },
          });
          if (stageReset) {
            await tx.bidSupervisionLog.create({
              data: {
                projectId: project.id,
                time: new Date(),
                role: '系统',
                target: relatedProjectCode!,
                action: '公告删除导致项目阶段重置',
                result: `阶段从 ${project.stage} 重置为 DOWNLOAD（来源公告已删除）`,
                riskFlag: '高',
              },
            });
            // H3: 级联失效下游开标/评标产物——否则陈旧数据被棘轮跳步当作合法准入凭证
            // （可直接用上一轮的解密成功供应商/已确认报告"启动评标/生成结果"；重投新标书因 SUCCESS 保护永不开封）。
            // 复位供应商与专家、删除开标会话/唱标/评分记录/评标结果/废标，关闭所有流转闸门。
            // 注：评分标准结构（BidScoreItem/BidScorePoint）保留以便重招复用；闸门已由复位关闭。
            await tx.bidOpeningSession.deleteMany({ where: { projectId: project.id } });
            await tx.bidOpeningRecord.deleteMany({ where: { projectId: project.id } });
            await tx.bidScoreRecord.deleteMany({ where: { supplier: { projectId: project.id } } });
            await tx.bidEvaluationResult.deleteMany({ where: { projectId: project.id } });
            await tx.bidInvalidBid.deleteMany({ where: { projectId: project.id } });
            await tx.bidSupplier.updateMany({
              where: { projectId: project.id },
              data: { decryptStatus: 'PENDING', confirmStatus: 'PENDING', bidValidity: null },
            });
            await tx.bidExpert.updateMany({
              where: { projectId: project.id },
              data: { reportConfirmed: false, reportConfirmedAt: null },
            });
          }
          await tx.bidDocument.updateMany({
            where: { announcementId: id },
            data: { bidProjectId: null },
          });

          // 收集密封文件路径（供事务后异步清理 MinIO 孤儿对象）
          if (stageReset) {
            const submissions = await tx.supplierBidSubmission.findMany({
              where: { projectId: project.id },
              select: { technicalFileAssetId: true, businessFileAssetId: true, coverLetterAssetId: true },
            });
            const assetIds = new Set<string>();
            for (const s of submissions) {
              if (s.technicalFileAssetId) assetIds.add(s.technicalFileAssetId);
              if (s.businessFileAssetId) assetIds.add(s.businessFileAssetId);
              if (s.coverLetterAssetId) assetIds.add(s.coverLetterAssetId);
            }
            if (assetIds.size > 0) {
              const fileAssets = await tx.fileAsset.findMany({
                where: { id: { in: [...assetIds] } },
                select: { sealedPath: true },
              });
              sealedPathsToClean = fileAssets.map(f => f.sealedPath).filter(Boolean) as string[];
            }
          }
        }

        await tx.announcement.delete({ where: { id } });
      });
    } catch (e) {
      this.logger.error(
        `公告删除事务失败 (announcementId=${id}): ${(e as Error).message}`,
      );
      throw e; // re-throw so caller knows delete failed
    }

    // 事务成功后异步清理 MinIO 密封文件（best-effort，不阻塞）
    if (sealedPathsToClean.length > 0) {
      for (const path of [...new Set(sealedPathsToClean)]) {
        try { await minioClient.removeObject(MINIO_BUCKET, path); } catch (_) { /* best-effort */ }
      }
      this.logger.log(`公告删除清理 MinIO 密封文件 ${sealedPathsToClean.length} 个 (project=${relatedProjectCode})`);
    }

    if (project) {
      this.logger.log(
        `公告删除，解除项目 ${relatedProjectCode} 关联`,
      );
    }
  }

  async getStats() {
    const [total, published, bidNotice, winNotice, policy] = await Promise.all([
      this.prisma.announcement.count(),
      this.prisma.announcement.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.announcement.count({ where: { type: 'BID_NOTICE', status: 'PUBLISHED' } }),
      this.prisma.announcement.count({ where: { type: 'WIN_NOTICE', status: 'PUBLISHED' } }),
      this.prisma.announcement.count({ where: { type: 'POLICY', status: 'PUBLISHED' } }),
    ]);
    return { total, published, bidNotice, winNotice, policy };
  }

  /** 运行时校验公告 metadata 字段类型，防止 typo 导致静默数据丢失 */
  private static METADATA_SCHEMA: Record<string, { type: string }> = {
    method: { type: 'string' },
    budget: { type: 'number' },
    scope: { type: 'string' },
    qualification: { type: 'string' },
    contact: { type: 'string' },
    openTime: { type: 'string' },
    deadline: { type: 'string' },
  };

  private static validateMetadata(raw: any): Record<string, any> {
    if (typeof raw !== 'object' || raw === null) return {};
    const validated: Record<string, any> = {};
    for (const [key, spec] of Object.entries(AnnouncementService.METADATA_SCHEMA)) {
      if (raw[key] !== undefined) {
        validated[key] = spec.type === 'number' && typeof raw[key] === 'string'
          ? Number(raw[key])
          : raw[key];
      }
    }
    return validated;
  }

  /** 招标公示的投标情况：关联项目 → 参与供应商 + 是否已投标（只读监控，不含开标/评标） */
  async getParticipants(id: string) {
    const ann = await this.prisma.announcement.findUnique({ where: { id }, select: { type: true, relatedProjectCode: true } });
    if (!ann) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });
    if (!ann.relatedProjectCode) return { project: null, suppliers: [], stats: { total: 0, submitted: 0 } };

    const project = await this.prisma.bidProject.findUnique({
      where: { projectCode: ann.relatedProjectCode },
      select: { id: true, name: true, projectCode: true, stage: true, deadline: true },
    });
    if (!project) return { project: null, suppliers: [], stats: { total: 0, submitted: 0 } };

    const [suppliers, submissions] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: project.id },
        include: { supplier: { select: { name: true, classification: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.supplierBidSubmission.findMany({
        where: { projectId: project.id },
        select: { supplierId: true, status: true, submittedAt: true, bidPrice: true },
      }),
    ]);
    const subMap = new Map(submissions.map(s => [s.supplierId, s]));
    const rows = suppliers.map(s => {
      const sub = s.supplierId ? subMap.get(s.supplierId) : null;
      // 收紧为解密制（原阶段制会让 OPENING 阶段未解密的报价暴露给采购管理端）：
      // 只有该供应商 decryptStatus==='SUCCESS' 才拆封 bidPrice 返回明文；否则 null。
      // bidPrice 入库已密封，这里 openField 拆封；旧明文行经 legacy 兼容原样返回。
      const decrypted = s.decryptStatus === 'SUCCESS';
      return {
        supplierName: s.supplierName,
        classification: s.supplier?.classification?.name,
        downloadStatus: s.downloadStatus,
        submitStatus: s.submitStatus,
        submitted: sub?.status === 'submitted' || (!sub && s.submitStatus === '已提交'),
        withdrawn: sub?.status === 'withdrawn',
        submittedAt: sub?.submittedAt,
        bidPrice: decrypted && sub?.bidPrice ? openField(sub.bidPrice, process.env.KMS_SECRET!) : null,
      };
    });
    return {
      project: { name: project.name, projectCode: project.projectCode, stage: project.stage, deadline: project.deadline },
      suppliers: rows,
      stats: { total: rows.length, submitted: rows.filter(r => r.submitted).length },
    };
  }
}
