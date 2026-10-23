import { resolveToolCtx, pickAdminCompanyIds, AssistantService } from './assistant.service';
import { ToolRegistry } from './tools/tool-registry';
import type { AssistantTool, AssistantToolCtx } from './tools/assistant-tool';

describe('工具上下文解析', () => {
  it('认证用户解析出 companyId（prisma 单查）', async () => {
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue({ companyId: 'co-1' }) } };
    const ctx = await resolveToolCtx(prisma, { userId: 'u1', role: 'leader' }, undefined);
    expect(ctx.user).toEqual({ sub: 'u1', role: 'leader', companyId: 'co-1' });
  });
  it('匿名访客 ctx 为空对象', async () => {
    const prisma: any = { user: { findUnique: jest.fn() } };
    const ctx = await resolveToolCtx(prisma, { guestKey: 'g' }, undefined);
    expect(ctx).toEqual({});
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('context.companyIds 仅 admin 采纳，非 admin 忽略', () => {
    expect(pickAdminCompanyIds(['a', 'b', 3], 'admin')).toEqual(['a', 'b']);
    expect(pickAdminCompanyIds(['a'], 'leader')).toBeUndefined();
  });
});

describe('兜底路径 ctx 线程（P1：无工具调用安全网不泄漏全公司卡片）', () => {
  const buildService = (overviewExecute: jest.Mock) => {
    const registry = new ToolRegistry();
    const overview = { name: 'global_overview', description: 'mock', execute: overviewExecute };
    registry.register(overview as AssistantTool);
    const filler = (name: string): any => ({ name, description: 'mock' });
    return new AssistantService(
      {} as any, // prisma —— 兜底路径不触库
      { chat: jest.fn().mockResolvedValue({ text: '系统运行平稳，共有5个项目。' }) } as any,
      registry,
      overview as any,
      filler('procurement'),
      filler('bid'),
      filler('supplier'),
      filler('expert'),
      filler('announcement'),
      filler('notification'),
      filler('mall'),
      filler('cockpit'),
      {} as any, // actionPlanner
      {} as any, // actionExecutor
    );
  };

  it('模型未调用工具 → 强制 global_overview 兜底也穿参公司口径 ctx', async () => {
    const execute = jest.fn().mockResolvedValue({
      success: true,
      cards: [{ type: 'table', title: '全局概览统计', columns: [], rows: [{ item: '采购项目', value: 1 }] }],
    });
    const service = buildService(execute);
    const ctx: AssistantToolCtx = { user: { sub: 'u1', role: 'leader', companyId: 'co-1' } };

    // 第一轮 LLM 未发 TOOL_CALL → handleNormalChat 走 handleFallbackWithGlobalOverview
    await (service as any).handleNormalChat(
      [{ role: 'user', content: '系统整体运行状况如何' }],
      [],
      [],
      null,
      ctx,
    );

    expect(execute).toHaveBeenCalledWith({}, ctx);
  });
});
