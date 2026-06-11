import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';

@Injectable()
export class AnnouncementService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAnnouncementDto, authorId?: string) {
    return this.prisma.announcement.create({
      data: {
        title: dto.title,
        content: dto.content,
        type: dto.type as any,
        summary: dto.summary,
        publishDate: dto.publishDate ? new Date(dto.publishDate) : new Date(),
        isTop: dto.isTop ?? false,
        relatedProjectCode: dto.relatedProjectCode,
        authorId,
        status: 'PUBLISHED',
      },
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
      }),
    ]);

    return { total, page, pageSize, items };
  }

  /** Public listing — only published items */
  async publicList(params: { type?: string; search?: string; page?: number; pageSize?: number }) {
    return this.list({ ...params, status: 'PUBLISHED' });
  }

  async get(id: string) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });
    return announcement;
  }

  async getPublic(id: string) {
    const announcement = await this.get(id);
    if (announcement.status !== 'PUBLISHED') {
      throw new BadRequestException({ error: '公告未发布', code: 'NOT_PUBLISHED' });
    }
    // Increment view count
    await this.prisma.announcement.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });
    return announcement;
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });

    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.type !== undefined && { type: dto.type as any }),
        ...(dto.summary !== undefined && { summary: dto.summary }),
        ...(dto.status !== undefined && { status: dto.status as any }),
        ...(dto.publishDate !== undefined && { publishDate: new Date(dto.publishDate) }),
        ...(dto.isTop !== undefined && { isTop: dto.isTop }),
        ...(dto.relatedProjectCode !== undefined && { relatedProjectCode: dto.relatedProjectCode }),
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
}
