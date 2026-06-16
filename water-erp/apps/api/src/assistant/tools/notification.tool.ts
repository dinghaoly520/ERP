import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';

@Injectable()
export class NotificationTool implements AssistantTool {
  name = 'notification';
  description =
    '查询通知列表/统计/未读数量。args: { action: "list"|"stats"|"unread", limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}): Promise<ToolResult> {
    const action = (args.action as string) || 'stats';
    const limit = (args.limit as number) || 10;

    if (action === 'unread') {
      const unread = await this.prisma.notification.count({
        where: { isRead: false },
      });
      return {
        success: true,
        cards: [
          {
            type: 'table', title: '未读通知',
            columns: [
              { key: 'item', label: '统计项' },
              { key: 'value', label: '数值' },
            ],
            rows: [{ item: '未读通知', value: unread }],
          },
        ],
      };
    }

    if (action === 'stats') {
      const [total, unread] = await Promise.all([
        this.prisma.notification.count(),
        this.prisma.notification.count({ where: { isRead: false } }),
      ]);
      return {
        success: true,
        cards: [
          {
            type: 'table', title: '通知概览',
            columns: [
              { key: 'item', label: '统计项' },
              { key: 'value', label: '数值' },
            ],
            rows: [
              { item: '通知总数', value: total },
              { item: '未读通知', value: unread },
            ],
          },
        ],
      };
    }

    // list
    const notifications = await this.prisma.notification.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, type: true, title: true, isRead: true, createdAt: true,
      },
    });
    return { success: true, data: notifications };
  }
}
