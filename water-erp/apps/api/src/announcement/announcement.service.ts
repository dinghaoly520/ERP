import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';
import { AnnouncementAiService } from './announcement-ai.service';

@Injectable()
export class AnnouncementService {
  constructor(
    private prisma: PrismaService,
    private announcementAi: AnnouncementAiService,
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

    return this.prisma.announcement.update({
      where: { id },
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
  }

  async remove(id: string) {
    return this.prisma.announcement.delete({ where: { id } });
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
