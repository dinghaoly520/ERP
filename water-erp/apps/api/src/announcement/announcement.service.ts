import { Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';
import { AnnouncementAiService } from './announcement-ai.service';
import { BidService } from '../bid/bid.service';

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

    return this.prisma.announcement.create({
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
        status: (dto.status as any) ?? 'DRAFT',
        ...(dto.metadata !== undefined && { metadata: dto.metadata as any }),
      },
      include: { attachments: { include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } } } },
    });
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

  /** Public listing — only published items；公开端不含招标文件（首页不泄露） */
  async publicList(params: { type?: string; search?: string; page?: number; pageSize?: number }) {
    const res = await this.list({ ...params, status: 'PUBLISHED' });
    return { ...res, items: res.items.map((a: any) => this.stripForPublic(a)) };
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

    // ── 联动：BID_NOTICE 首次发布 → 创建 BidProject ──
    if (isPublishTransition && this.bidService) {
      try {
        const meta = (result.metadata || {}) as Record<string, any>;
        // 幂等检查：relatedProjectCode 是否已关联有效项目
        let existingProject = null;
        if (announcement.relatedProjectCode) {
          existingProject = await this.prisma.bidProject.findUnique({
            where: { projectCode: announcement.relatedProjectCode },
          });
        }

        if (existingProject) {
          // 已存在 → 同步更新
          await this.bidService.syncFromAnnouncement(
            existingProject.id,
            { title: result.title },
            meta,
          );
          this.logger.log(
            `公告已关联项目 ${existingProject.projectCode}，同步更新字段`,
          );
        } else {
          // 不存在 → 创建
          const project = await this.bidService.createFromAnnouncement(
            { id: result.id, title: result.title, publishDate: result.publishDate },
            meta,
          );
          // 回写 relatedProjectCode
          await this.prisma.announcement.update({
            where: { id },
            data: { relatedProjectCode: project.projectCode },
          });
          // 挂载招标文件
          const bidDoc = await this.prisma.bidDocument.findUnique({
            where: { announcementId: id },
          });
          if (bidDoc) {
            await this.prisma.bidDocument.update({
              where: { announcementId: id },
              data: { bidProjectId: project.id },
            });
          }
          this.logger.log(
            `公告首次发布，自动创建项目 ${project.projectCode}`,
          );
        }
      } catch (e) {
        // 联动失败不阻塞发布，记录日志供排查
        this.logger.error(
          `公告发布联动创建项目失败 (announcementId=${id}): ${(e as Error).message}`,
          (e as Error).stack,
        );
      }
    }

    return result;
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
        })
      : null;

    try {
      await this.prisma.$transaction(async (tx) => {
        // Cleanup linked project before delete
        if (project) {
          await tx.bidProject.update({
            where: { projectCode: relatedProjectCode! },
            data: {
              riskNote: (project.riskNote || '') + '（来源公告已删除）',
            },
          });
          await tx.bidDocument.updateMany({
            where: { announcementId: id },
            data: { bidProjectId: null },
          });
        }

        await tx.announcement.delete({ where: { id } });
      });
    } catch (e) {
      this.logger.error(
        `公告删除事务失败 (announcementId=${id}): ${(e as Error).message}`,
      );
      throw e; // re-throw so caller knows delete failed
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
      return {
        supplierName: s.supplierName,
        classification: s.supplier?.classification?.name,
        downloadStatus: s.downloadStatus,
        submitStatus: s.submitStatus,
        submitted: sub?.status === 'submitted' || (!sub && s.submitStatus === '已提交'),
        withdrawn: sub?.status === 'withdrawn',
        submittedAt: sub?.submittedAt,
        bidPrice: sub?.bidPrice,
      };
    });
    return {
      project: { name: project.name, projectCode: project.projectCode, stage: project.stage, deadline: project.deadline },
      suppliers: rows,
      stats: { total: rows.length, submitted: rows.filter(r => r.submitted).length },
    };
  }
}
