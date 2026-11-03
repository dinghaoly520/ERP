import { NotificationTool } from './notification.tool';
import type { AssistantToolCtx } from './assistant-tool';

/** 2026-11-03 公司隔离收口：通知是发给个人的私有数据——此前全表裸查
 *  （全平台未读数/任何人通知标题直出 AI）。现一律按登录人（sub）过滤。 */
describe('NotificationTool 本人隔离', () => {
  const mk = () => {
    const calls: Array<{ where?: unknown; noWhere?: boolean }> = [];
    const prisma: any = {
      notification: {
        count: jest.fn().mockImplementation(({ where }: any) => { calls.push({ where }); return 0; }),
        findMany: jest.fn().mockImplementation(({ where }: any) => { calls.push({ where }); return []; }),
      },
    };
    return { tool: new NotificationTool(prisma), prisma, calls };
  };
  const userCtx: AssistantToolCtx = { user: { sub: 'u-1', role: 'leader', companyId: 'co-1' } };

  it('所有查询 where 恒带 userId=登录人', async () => {
    const { tool, calls } = mk();
    await tool.execute({ action: 'stats' }, userCtx);
    await tool.execute({ action: 'unread' }, userCtx);
    await tool.execute({ action: 'list' }, userCtx);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) {
      expect((c.where as any)?.userId).toBe('u-1');
    }
  });

  it('匿名（公开 :3008 访客）→ 拒绝且不触库', async () => {
    const { tool, prisma } = mk();
    const r = await tool.execute({ action: 'stats' }, {});
    expect(r.success).toBe(false);
    expect(prisma.notification.count).not.toHaveBeenCalled();
  });
});
