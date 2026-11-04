import { NotificationTool } from './notification.tool';

/** 2026-11-04 首个 spec：stats 补类型分布（用户裁定「分布类=多结构全维度」）——
 *  type 英文原键经 NOTIFICATION_TYPE_LABEL 翻译，不裸进卡片。 */
function makeTool() {
  const prisma: any = {
    notification: {
      count: jest.fn().mockResolvedValue(6),
      groupBy: jest.fn().mockResolvedValue([
        { type: 'BID_PUBLISHED', _count: 4 },
        { type: 'EXPERT_ASSIGNED', _count: 2 },
      ]),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return { prisma, tool: new NotificationTool(prisma) };
}

it('stats：概览 metric + 类型分布（中文标签）', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({ action: 'stats' }, { user: { sub: 'u-1', role: 'leader', companyId: 'co-1' } });
  const cards = r.cards as Array<Record<string, unknown>>;
  expect(cards.map((c) => c.title)).toEqual(['通知概览', '通知类型分布']);
  const metrics = (cards[0].metrics as Array<{ label: string; value: string }>).map((m) => `${m.label}=${m.value}`);
  expect(metrics).toEqual(['通知总数=6', '未读=6']);
  const rows = cards[1].rows as Array<Record<string, unknown>>;
  expect(rows[0]).toEqual({ type: '采购公告发布', count: 4 });
  expect(rows[1]).toEqual({ type: '专家指派通知', count: 2 });
});
