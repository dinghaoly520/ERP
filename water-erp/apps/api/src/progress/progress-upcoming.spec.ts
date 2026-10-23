import { ProgressService } from './progress.service';

// :3011 未来关键节点（Task 11）——按日分组+升序、PMI 关联名优先。
// 注：brief 原 items[1] 断言 ['DEADLINE:标段A','OPENING:标段A'] 与其实现
// （displayName = PMI.title || name，b1 两条事件均用 'R项目'、b2 用 '标段B'）
// 及 items[2] 断言自相矛盾，按实现语义修正为 ['DEADLINE:标段B','OPENING:R项目']。
describe('ProgressService.getUpcoming', () => {
  it('未来节点按日分组且升序、含 PMI 项目名', async () => {
    const day = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000);
    const prisma: any = {
      bidProject: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'b1', name: '标段A', deadline: day(3), openTime: day(2),
            projectManagementItem: { title: 'R项目' } },
          { id: 'b2', name: '标段B', deadline: day(2), openTime: day(1), projectManagementItem: null },
        ]),
      },
    };
    // 构造器依赖 (prisma, aiService)——getUpcoming 仅用 prisma，aiService 置空即可
    const svc = new ProgressService(prisma, {} as any);
    const r = await svc.getUpcoming(14, undefined);
    expect(r.items[0].date).toBe(day(1).toISOString().slice(0, 10));
    expect(r.items[0].events).toHaveLength(1);
    expect(r.items[0].events[0]).toMatchObject({ type: 'OPENING', name: '标段B' });
    expect(r.items[1].events.map((e: { type: string; name: string }) => `${e.type}:${e.name}`).sort())
      .toEqual(['DEADLINE:标段B', 'OPENING:R项目']);
    expect(r.items[2].events[0].name).toBe('R项目');
  });
});
