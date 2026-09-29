import { Injectable } from '@nestjs/common';
import { PUBLIC_VISIBLE_CLASSES } from '@water-erp/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';
import { ANNOUNCEMENT_TYPE_LABEL, t as translate } from './labels';

/** 公开域判定（2026-09-29 二审 P1）：AI 工具只答"已发布且公开可见"的公告——
 *  草稿/保密级/定向（RESTRICTED 部分供应商可见）一律不进 AI 上下文，
 *  与 /announcements/public 列表同口径。否则匿名问"公告详情"即可带出定向公告正文，
 *  旁路公告可见性收口。 */
function isPubliclyVisible(ann: { status: string; dataClass?: string | null; metadata?: unknown }): boolean {
  if (ann.status !== 'PUBLISHED') return false;
  if (ann.dataClass && !(PUBLIC_VISIBLE_CLASSES as readonly string[]).includes(ann.dataClass)) return false;
  const meta = ann.metadata as Record<string, unknown> | null | undefined;
  return !(meta && meta.visibility === 'RESTRICTED');
}

/** 列表/统计查询的公开域 where 片段（与 isPubliclyVisible 同口径的 SQL 版） */
const PUBLIC_WHERE = {
  status: 'PUBLISHED' as const,
  AND: [
    { OR: [{ dataClass: { in: [...PUBLIC_VISIBLE_CLASSES] } }, { dataClass: null }] },
    { OR: [{ metadata: { path: ['visibility'], not: 'RESTRICTED' } }, { metadata: null }] },
  ],
};

@Injectable()
export class AnnouncementTool implements AssistantTool {
  name = 'announcement';
  description =
    '查询已公开的公告列表/详情/统计，支持按类型筛选。args: { action: "list"|"detail"|"stats", type?, announcementId?, limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const type = args.type as string | undefined;
    const announcementId = args.announcementId as string | undefined;
    const limit = (args.limit as number) || 10;

    if (action === 'detail' && announcementId) {
      const ann = await this.prisma.announcement.findUnique({
        where: { id: announcementId },
        include: { _count: { select: { attachments: true } } },
      });
      if (!ann || !isPubliclyVisible(ann)) return { success: false, error: '公告不存在或不可见' };
      return { success: true, data: ann };
    }

    if (action === 'stats') {
      const [published, byType] = await Promise.all([
        this.prisma.announcement.count({ where: PUBLIC_WHERE as never }),
        this.prisma.announcement.groupBy({
          by: ['type'], _count: true,
          where: PUBLIC_WHERE as never,
        }),
      ]);
      byType.sort((a, b) => b._count - a._count);
      const annTotal = byType.reduce((s, r) => s + r._count, 0);
      return {
        success: true,
        cards: [
          {
            type: 'table', title: '公告概览',
            columns: [
              { key: 'item', label: '统计项' },
              { key: 'value', label: '数值' },
            ],
            rows: [
              { item: '已发布公告', value: published },
            ],
          },
          {
            type: 'table', title: '按类型分布',
            columns: [
              { key: 'type', label: '类型' },
              { key: 'count', label: '数量' },
              { key: 'pct', label: '占比' },
            ],
            rows: byType.map((item) => ({
              type: translate(ANNOUNCEMENT_TYPE_LABEL, item.type),
              count: item._count,
              pct: annTotal > 0 ? ((item._count / annTotal) * 100).toFixed(1) + '%' : '-',
            })),
            viz: { kind: 'distribution', category: 'type', value: 'count' },
          },
        ],
      };
    }

    // default: list —— 公开域口径，不提供按草稿/下架状态筛选
    const where: Record<string, unknown> = { ...PUBLIC_WHERE };
    if (type) where.type = type;
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
