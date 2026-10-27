import { DashboardService } from './dashboard.service';

/** getBadges 停滞口径（2026-10-26 修正）：ACTIVE 项目 × currentStage 指针定位的当前阶段行
 *  停留>30 天——数项目数；回收/归档项目与历史未完阶段不计入（旧口径数全部非完成阶段行，
 *  实录 131 行显 99+）。Prisma 不能跨表比对列，实现为两步查 + JS 配对。 */
describe('DashboardService.getBadges', () => {
  const item = (id: string, currentStage: string) => ({ id, currentStage });
  const stage = (itemId: string, stageKey: string) => ({ projectManagementItemId: itemId, stageKey });

  const makePrisma = (items: unknown[], stages: unknown[]) => {
    let lastItemWhere: unknown;
    let lastStageWhere: unknown;
    const prisma: any = {
      procurementRound: { count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(7) },
      projectManagementItem: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          lastItemWhere = where;
          return Promise.resolve(items);
        }),
      },
      projectManagementStage: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          lastStageWhere = where;
          return Promise.resolve(stages);
        }),
      },
    };
    (prisma as any).calls = () => ({ lastItemWhere, lastStageWhere });
    return prisma;
  };

  it('三计数口径正确且公司过滤注入（stalled=ACTIVE×当前阶段指针配对）', async () => {
    const prisma = makePrisma(
      [item('i1', 'BID_EVALUATION'), item('i2', 'CONTRACT'), item('i3', 'ARCHIVE_FILING')],
      [
        stage('i1', 'BID_EVALUATION'), // 命中：当前阶段且超 30 天
        stage('i1', 'TENDER_WRITE'), // 不计：同项目的历史阶段行
        stage('i2', 'ARCHIVE_FILING'), // 不计：i2 的当前阶段是 CONTRACT
        stage('i3', 'ARCHIVE_FILING'), // 命中
      ],
    );
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBadges({ companyId: 'co-1' });
    expect(r).toEqual({ abnormalCount: 3, pendingCount: 7, stalledCount: 2 });
    expect(prisma.procurementRound.count).toHaveBeenNthCalledWith(1, {
      where: { companyId: 'co-1', resultStatus: { notIn: ['AWARDED', 'PENDING'] } },
    });
    // ACTIVE + 公司过滤注入到 item 查询（回收/归档项目从源头排除）
    const { lastItemWhere } = (prisma as any).calls();
    expect(lastItemWhere).toEqual({ status: 'ACTIVE', companyId: 'co-1' });
  });

  it('无过滤（admin 全部）同样工作', async () => {
    const prisma = makePrisma([item('i1', 'BID_EVALUATION')], [stage('i1', 'BID_EVALUATION')]);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBadges(undefined);
    expect(r).toEqual({ abnormalCount: 3, pendingCount: 7, stalledCount: 1 });
    expect(prisma.procurementRound.count).toHaveBeenCalledWith({
      where: { resultStatus: { notIn: ['AWARDED', 'PENDING'] } },
    });
    const { lastItemWhere } = (prisma as any).calls();
    expect(lastItemWhere).toEqual({ status: 'ACTIVE' });
  });

  it('无 ACTIVE 项目时不发第二查（stalled=0）', async () => {
    const prisma = makePrisma([], []);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBadges(undefined);
    expect(r).toEqual({ abnormalCount: 3, pendingCount: 7, stalledCount: 0 });
    expect(prisma.projectManagementStage.findMany).not.toHaveBeenCalled();
  });
});
