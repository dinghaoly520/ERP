import { DashboardService } from './dashboard.service';

/** getProjectStatusCounts（2026-11-19 用户裁定：数据总览首排改 PMI 状态盘点——
 *  归档/进行中/异常(=终止)/总数）。当前状态快照口径（存量，非本年事件窗）；
 *  回收站（RECYCLED）不计入。 */
describe('DashboardService.getProjectStatusCounts', () => {
  let capturedWhere: unknown;
  const makePrisma = (groups: Array<{ status: string; _count: { _all: number } }>) => {
    capturedWhere = undefined;
    const prisma: any = {
      projectManagementItem: {
        groupBy: jest.fn().mockImplementation(({ where }) => {
          capturedWhere = where;
          return Promise.resolve(groups);
        }),
      },
    };
    return prisma;
  };

  it('三态映射 + 总数=三态之和；回收站排除 + 公司过滤注入', async () => {
    const prisma = makePrisma([
      { status: 'TERMINATED', _count: { _all: 4 } },
      { status: 'ACTIVE', _count: { _all: 2 } },
      { status: 'ARCHIVED', _count: { _all: 0 } },
    ]);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getProjectStatusCounts({ companyId: 'co-1' });
    expect(r).toEqual({ archived: 0, active: 2, terminated: 4, total: 6 });
    expect(capturedWhere).toEqual({ companyId: 'co-1', status: { not: 'RECYCLED' } });
  });

  it('无过滤（admin 全部/移动端总数据）同样工作', async () => {
    const prisma = makePrisma([{ status: 'ACTIVE', _count: { _all: 2 } }]);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getProjectStatusCounts(undefined);
    expect(r).toEqual({ archived: 0, active: 2, terminated: 0, total: 2 });
    expect(capturedWhere).toEqual({ status: { not: 'RECYCLED' } });
  });

  it('空库全 0（缺态不 NaN）', async () => {
    const prisma = makePrisma([]);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getProjectStatusCounts(undefined);
    expect(r).toEqual({ archived: 0, active: 0, terminated: 0, total: 0 });
  });
});
