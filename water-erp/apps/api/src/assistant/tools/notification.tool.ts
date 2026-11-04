import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { NOTIFICATION_TYPE_LABEL, t } from './labels';

/** 通知工具（2026-11-03 公司隔离收口）：通知是发给个人的私有数据——此前全表裸查
 *  （全平台未读总数 / 任何人最近通知标题直接出给 AI），既无本人也无公司口径。
 *  现一律按登录人（ctx.user.sub）过滤；匿名（公开 :3008 访客）不可用本工具。 */
@Injectable()
export class NotificationTool implements AssistantTool {
  name = 'notification';
  description =
    '查询当前登录用户的通知列表/统计/未读数量。args: { action: "list"|"stats"|"unread", limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    if (!ctx?.user?.sub) {
      return { success: false, error: '通知为个人数据，请登录后查询' };
    }
    const action = (args.action as string) || 'stats';
    const limit = (args.limit as number) || 10;
    const mine = { userId: ctx.user.sub };

    if (action === 'unread') {
      const unread = await this.prisma.notification.count({
        where: { ...mine, isRead: false },
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
        this.prisma.notification.count({ where: mine }),
        this.prisma.notification.count({ where: { ...mine, isRead: false } }),
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
      where: mine,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, type: true, title: true, isRead: true, createdAt: true,
      },
    });
    /* 出卡（2026-11-04 审查 P3-26）：此前只回 data、type 英文原键经
     * serializeDataForLlm 裸进 LLM 上下文——现在产出中文标签卡片 */
    return {
      success: true,
      data: notifications,
      cards: [
        {
          type: 'table',
          title: `通知列表（${notifications.length} 条）`,
          columns: [
            { key: '类型', label: '类型' },
            { key: '标题', label: '标题' },
            { key: '状态', label: '状态' },
          ],
          rows: notifications.map((n) => ({
            类型: t(NOTIFICATION_TYPE_LABEL, n.type),
            标题: n.title,
            状态: n.isRead ? '已读' : '未读',
          })),
        },
      ],
    };
  }
}
