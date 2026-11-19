import { DashboardService } from './dashboard.service';

/** getBidStageProjects（2026-11-19 用户裁定：态势 KPI 下方最新 5 项+复合状态行）。
 *  状态行规则：标后=中标单位·当前步骤；标前且 PMI 未到开标评标=当前步骤；标前且已到
 *  开标评标=已投 X/Y·专家 N；标中未到开标时间=开标时间·等待开标；已到时间未移交=
 *  开标时间·开标中；已移交(session 开标完成)未归档=开标时间·归档中。 */
describe('DashboardService.getBidStageProjects', () => {
  const iso = (s: string) => new Date(`${s}:00+08:00`).toISOString();
  const future = '2099-01-01T10:00';
  const past = '2020-01-01T10:00';
  const mk = (over: Record<string, unknown>) => ({
    id: 'p1',
    name: '钻机采购',
    stage: 'SUBMIT',
    openTime: new Date(iso(future)),
    projectManagementItem: null,
    openingSession: null,
    _count: { suppliers: 5 },
    ...over,
  });

  const makePrisma = (projects: unknown[]) => {
    const captured: Record<string, unknown> = {};
    const subRows = projects.map((p: { id: string }) => ({ projectId: p.id, _count: { projectId: 3 } }));
    const expRows = projects.map((p: { id: string }) => ({ projectId: p.id, _count: { projectId: 4 } }));
    const prisma: any = {
      bidProject: {
        findMany: jest.fn().mockImplementation(({ where, take }) => {
          captured.where = where;
          captured.take = take;
          return Promise.resolve(projects);
        }),
      },
      supplierBidSubmission: {
        groupBy: jest.fn().mockResolvedValue(subRows),
      },
      bidExpert: {
        groupBy: jest.fn().mockResolvedValue(expRows),
      },
    };
    (prisma as any).captured = () => captured;
    return prisma;
  };

  it('running 桶：标前+标中四阶段、take=5、isExtractionOnly 排除+公司过滤', async () => {
    const prisma = makePrisma([mk({})]);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBidStageProjects({ companyId: 'co-1' }, 'running');
    expect(r.bucket).toBe('running');
    const { where, take } = (prisma as any).captured();
    expect(where).toEqual({ companyId: 'co-1', stage: { in: ['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING'] }, isExtractionOnly: false });
    expect(take).toBe(5);
  });

  it('标前：PMI 未到开标评标=当前步骤；已到开标评标=已投/专家计数', async () => {
    const prisma = makePrisma([
      mk({ id: 'a', projectManagementItem: { currentStage: 'TENDER_DOCUMENT', awardedSupplier: null } }),
      mk({ id: 'b', name: '谈判文件公告 — 便携式全液压岩心钻机（800型）采购', projectManagementItem: { currentStage: 'BID_EVALUATION', awardedSupplier: null } }),
    ]);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBidStageProjects(undefined, 'pre');
    expect(r.projects.map((x: { status: string }) => x.status)).toEqual(['采购文件', '已投 3/5 · 专家 4']);
    // 项目名剥公告类型前缀（2026-11-19 用户裁定：存量名带前缀入库，读端兜底）
    expect(r.projects.map((x: { name: string }) => x.name)).toEqual(['钻机采购', '便携式全液压岩心钻机（800型）采购']);
  });

  it('标中：未到时间=等待开标；已到未移交=开标中；已移交未归档=归档中', async () => {
    const prisma = makePrisma([
      mk({ id: 'a', stage: 'OPENING', openTime: new Date(iso(future)), openingSession: { status: '待开标' } }),
      mk({ id: 'b', stage: 'EVALUATING', openTime: new Date(iso(past)), openingSession: { status: '待开标' } }),
      mk({ id: 'c', stage: 'OPENING', openTime: new Date(iso(past)), openingSession: { status: '开标完成' } }),
    ]);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBidStageProjects(undefined, 'in');
    expect(r.projects.map((x: { status: string }) => x.status)).toEqual([
      '01-01 10:00 · 等待开标',
      '01-01 10:00 · 开标中',
      '01-01 10:00 · 归档中',
    ]);
  });

  it('标后：中标单位·当前步骤', async () => {
    const prisma = makePrisma([
      mk({ stage: 'ARCHIVED', projectManagementItem: { currentStage: 'CONTRACT', awardedSupplier: '四川水发建设有限公司' } }),
    ]);
    const svc = new (DashboardService as any)(prisma);
    const r = await svc.getBidStageProjects(undefined, 'post');
    expect(r.projects[0].status).toBe('四川水发建设有限公司 · 合同');
  });
});
