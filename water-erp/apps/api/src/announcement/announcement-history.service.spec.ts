import { AnnouncementHistoryService } from './announcement-history.service';

/** 操作人姓名口径（2026-11-09）：写端落 displayName 快照、读端按 operatorId 联查治愈存量账号名行 */
describe('AnnouncementHistoryService 操作人姓名', () => {
  function makeService(users: any[]) {
    const prisma: any = {
      user: { findMany: jest.fn().mockResolvedValue(users) },
      announcementHistory: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    return { service: new AnnouncementHistoryService(prisma), prisma };
  }

  const users = [
    { id: 'u1', displayName: '彭强', username: 'Swhi-CGZX-05' },
    { id: 'u2', displayName: '', username: 'Swhi-CGZX-02' }, // 无姓名账号 → 回退 username
  ];

  it('write：operatorId 可解析时落姓名快照（displayName 优先）', async () => {
    const { service, prisma } = makeService(users);
    await service.write({ announcementId: 'a1', action: 'CREATE', title: 't', operatorId: 'u1', operatorName: 'Swhi-CGZX-05' });
    expect(prisma.announcementHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ operatorId: 'u1', operatorName: '彭强' }),
    }));
  });

  it('write：displayName 空串回退 username', async () => {
    const { service } = makeService(users);
    const name = await service.resolvedName('u2', 'Swhi-CGZX-02');
    expect(name).toBe('Swhi-CGZX-02');
  });

  it('write：无 operatorId 时保留调用方快照（匿名/系统路径）', async () => {
    const { service, prisma } = makeService(users);
    await service.write({ announcementId: 'a1', action: 'CREATE', title: 't', operatorName: '系统' });
    expect(prisma.announcementHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ operatorName: '系统' }),
    }));
  });

  it('timeline：存量账号名行按 operatorId 联查治愈为姓名', async () => {
    const { service, prisma } = makeService(users);
    prisma.announcementHistory.findMany.mockResolvedValue([
      { id: 'h1', operatorId: 'u1', operatorName: 'Swhi-CGZX-05' },
      { id: 'h2', operatorId: null, operatorName: 'system' },
      { id: 'h3', operatorId: 'uGone', operatorName: '已删用户快照' },
    ]);
    const rows = await service.timeline('a1');
    expect(rows.map((r) => r.operatorName)).toEqual(['彭强', 'system', '已删用户快照']);
  });

  it('listAll：同口径治愈', async () => {
    const { service, prisma } = makeService(users);
    prisma.announcementHistory.findMany.mockResolvedValue([{ id: 'h1', operatorId: 'u1', operatorName: 'Swhi-CGZX-05' }]);
    const r = await service.listAll({});
    expect(r.items[0].operatorName).toBe('彭强');
  });
});
