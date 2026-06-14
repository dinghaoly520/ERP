import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';

@Injectable()
export class AnnouncementTool implements AssistantTool {
  name = 'announcement';
  description =
    '查询公告列表/详情/统计，支持按类型和状态筛选。args: { action: "list"|"detail"|"stats", type?, status?, announcementId?, limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const type = args.type as string | undefined;
    const status = args.status as string | undefined;
    const announcementId = args.announcementId as string | undefined;
    const limit = (args.limit as number) || 10;

    if (action === 'detail' && announcementId) {
      const ann = await this.prisma.announcement.findUnique({
        where: { id: announcementId },
        include: { _count: { select: { attachments: true } } },
      });
      if (!ann) return { success: false, error: '公告不存在' };
      return { success: true, data: ann };
    }

    if (action === 'stats') {
      const [total, published, draft] = await Promise.all([
        this.prisma.announcement.count(),
        this.prisma.announcement.count({ where: { status: 'PUBLISHED' } }),
        this.prisma.announcement.count({ where: { status: 'DRAFT' } }),
      ]);
      const byType = await this.prisma.announcement.groupBy({
        by: ['type'], _count: true,
      });
      return {
        success: true,
        cards: [
          { type: 'metric', title: '公告总数', value: String(total) },
          { type: 'metric', title: '已发布', value: String(published) },
          { type: 'metric', title: '草稿', value: String(draft) },
          {
            type: 'table', title: '按类型分布',
            columns: [{ key: 'type', label: '类型' }, { key: 'count', label: '数量' }],
            rows: byType.map((t) => ({ type: t.type, count: t._count })),
          },
        ],
      };
    }

    // default: list
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;
    const announcements = await this.prisma.announcement.findMany({
      where: where as never,
      take: limit,
      orderBy: { publishDate: 'desc' },
      select: {
        id: true, title: true, type: true, status: true,
        publishDate: true, viewCount: true, isTop: true,
      },
    });
    return { success: true, data: announcements };
  }
}
