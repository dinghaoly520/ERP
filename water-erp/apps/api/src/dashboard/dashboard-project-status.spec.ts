import { DashboardService } from './dashboard.service';

/** getProjectStatusCounts（2026-11-19 用户裁定：数据总览首排）——归档项目=台账中的项目
 *  （ProcurementRound 全时段行数，含终止留痕、不含回收站）；进行中/异常(=终止)/总数为
 *  PMI 当前状态快照（回收站不计）；总数=归档+进行中（不含异常项目）。 */
describe('DashboardService.getProjectStatusCounts', () => {
  let capturedGroupWhere: unknown;
  let capturedCountWhere: unknown;
  const makePrisma = (groups: Array<{ status: string; _count: { _all: number } }>, ledgerTotal: number) => {
    capturedGroupWhere = undefined;
    capturedCountWhere = undefined;
    const prisma: any = {
      projectManagementItem: {
        groupBy: jest.fn().mockImplementation(({ where }) => {
          capturedGroupWhere = where;
          return Promise.resolve(groups);
        }),
      },
      procurementRound: {
        count: jest.fn().mockImplementation(({ where }) => {
          capturedCountWhere = where;
          return Promise.resolve(ledgerTotal);
        }),
      },
    };
    return prisma;
  };

  it('归档=台账全量行数；PMI 三态 + 总数；两查公司过滤注入', async () => {
    const prisma = makePrisma(
      [
        { status: 'TERMINATED', _count: { _all: 4 } },
        { status: 'ACTIVE', _count: { _all: 2 } },
      ],
      166,
    );
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getProjectStatusCounts({ companyId: 'co-1' });
    expect(r).toEqual({ archived: 166, active: 2, terminated: 4, total: 168 }); // 总数=归档+进行中（不含异常）
    expect(capturedGroupWhere).toEqual({ companyId: 'co-1', status: { not: 'RECYCLED' } });
    // 台账口径=列表默认视图：仅排回收站，全时段全状态（终止留痕在内）
    expect(capturedCountWhere).toEqual({ companyId: 'co-1', isRecycled: false });
  });

  it('无过滤（admin 全部/移动端总数据）同样工作', async () => {
    const prisma = makePrisma([{ status: 'ACTIVE', _count: { _all: 2 } }], 162);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getProjectStatusCounts(undefined);
    expect(r).toEqual({ archived: 162, active: 2, terminated: 0, total: 164 }); // 162+2
    expect(capturedCountWhere).toEqual({ isRecycled: false });
  });

  it('空库全 0（缺态不 NaN）', async () => {
    const prisma = makePrisma([], 0);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getProjectStatusCounts(undefined);
    expect(r).toEqual({ archived: 0, active: 0, terminated: 0, total: 0 });
  });
});
