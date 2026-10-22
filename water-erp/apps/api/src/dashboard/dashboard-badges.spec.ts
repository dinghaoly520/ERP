import { DashboardService } from './dashboard.service';

describe('DashboardService.getBadges', () => {
  const makePrisma = (stalledWhere: unknown) => ({
    procurementRound: { count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(7) },
    projectManagementStage: { count: jest.fn().mockImplementation(({ where }) => {
      (makePrisma as any).lastStageWhere = where;
      // 公司过滤注入仅在传入 filter 时断言（admin 全部：无 projectManagementItem 键）
      if ((where as any).projectManagementItem !== undefined) {
        expect((where as any).projectManagementItem).toEqual({ companyId: 'co-1' });
      } else {
        expect((where as any).projectManagementItem).toBeUndefined();
      }
      return Promise.resolve(stalledWhere === null ? 2 : stalledWhere);
    }) },
  });
  it('三计数口径正确且公司过滤注入', async () => {
    const prisma: any = makePrisma(2);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBadges({ companyId: 'co-1' });
    expect(r).toEqual({ abnormalCount: 3, pendingCount: 7, stalledCount: 2 });
    expect(prisma.procurementRound.count).toHaveBeenNthCalledWith(1, {
      where: { companyId: 'co-1', resultStatus: { notIn: ['AWARDED', 'PENDING'] } },
    });
  });
  it('无过滤（admin 全部）同样工作', async () => {
    const prisma: any = makePrisma(0);
    const svc = new (DashboardService as any)(prisma);
    await svc.getBadges(undefined);
    expect(prisma.procurementRound.count).toHaveBeenCalledWith({
      where: { resultStatus: { notIn: ['AWARDED', 'PENDING'] } },
    });
  });
});
