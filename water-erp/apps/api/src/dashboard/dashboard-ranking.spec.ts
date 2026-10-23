import { DashboardService } from './dashboard.service';

describe('DashboardService 公司龙虎榜', () => {
  const makeGroups = () => [
    { companyId: 'c1', _count: { _all: 10 }, _sum: { awardAmount: 500, budgetAmount: 600 } },
    { companyId: 'c2', _count: { _all: 5 }, _sum: { awardAmount: 900, budgetAmount: 1000 } },
  ];
  const makeCompanies = () => [{ id: 'c1', name: '甲公司' }, { id: 'c2', name: '乙公司' }];

  it('按公司聚合、公司名回填、按成交额降序', async () => {
    const prisma: any = {
      procurementRound: { groupBy: jest.fn().mockResolvedValue(makeGroups()) },
      company: { findMany: jest.fn().mockResolvedValue(makeCompanies()) },
    };
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getCompanyRanking('2026-10-01');
    expect(r.rows[0]).toMatchObject({ companyName: '乙公司', totalCount: 5 });
    expect(r.rows[1].companyName).toBe('甲公司');
    // 无归属不计排名：companyId not null 过滤必须在 where 里
    expect(prisma.procurementRound.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['companyId'],
        where: expect.objectContaining({ companyId: { not: null } }),
      }),
    );
  });

  it('leader：本公司排位 + 集团均值（rows 按 awardAmount 降序定 rank）', async () => {
    const prisma: any = {
      procurementRound: { groupBy: jest.fn().mockResolvedValue(makeGroups()) },
      company: { findMany: jest.fn().mockResolvedValue(makeCompanies()) },
      user: { findUnique: jest.fn().mockResolvedValue({ companyId: 'c1' }) },
    };
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getCompanyRankingView({ sub: 'u1', role: 'leader' }, 'year');
    expect(r).toEqual({
      range: 'year',
      self: { rank: 2, companyName: '甲公司', awardAmount: 500 },
      groupAvg: { awardAmount: 700, totalCount: 7.5 },
    });
  });

  it('leader：公司不在榜（区间内无轮次/无归属）→ self=null，均值仍返回', async () => {
    const prisma: any = {
      procurementRound: { groupBy: jest.fn().mockResolvedValue(makeGroups()) },
      company: { findMany: jest.fn().mockResolvedValue(makeCompanies()) },
      user: { findUnique: jest.fn().mockResolvedValue({ companyId: 'cX' }) },
    };
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getCompanyRankingView({ sub: 'u1', role: 'leader' });
    expect(r.range).toBe('month'); // 缺省 range=month
    expect(r.self).toBeNull();
    expect(r.groupAvg).toEqual({ awardAmount: 700, totalCount: 7.5 });
  });

  it('admin：直接返回全榜（不查 User 排位）', async () => {
    const prisma: any = {
      procurementRound: { groupBy: jest.fn().mockResolvedValue(makeGroups()) },
      company: { findMany: jest.fn().mockResolvedValue(makeCompanies()) },
      user: { findUnique: jest.fn() },
    };
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getCompanyRankingView({ sub: 'u9', role: 'admin' });
    expect(r.range).toBe('month');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ companyName: '乙公司', awardAmount: 900, savings: 100 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
