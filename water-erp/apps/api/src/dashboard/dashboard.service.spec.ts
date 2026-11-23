import { ResultStatus } from '@prisma/client';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const makeService = (customRounds?: Array<Record<string, unknown>>) => {
    const rounds = customRounds ?? [
      {
        id: 'round-awarded-1',
        procurementDate: new Date('2026-04-02T00:00:00.000Z'),
        procurementMethod: '公开招标',
        budgetAmount: 900_000,
        controlAmount: 1_000_000,
        awardAmount: 800_000,
        resultStatus: ResultStatus.AWARDED,
        resultText: '已成交',
        awardedSupplierId: 'supplier-1',
        department: { name: '采购中心' },
        project: { name: '项目 A', createdAt: new Date('2026-03-01T00:00:00.000Z') }, // b7674eb1 时间轴聚合读 createdAt（DB 列永非空，mock 漂移补齐）
        participants: [
          {
            supplierId: 'supplier-1',
            supplier: { name: '供应商 A' },
          },
        ],
      },
      {
        id: 'round-awarded-2',
        procurementDate: new Date('2026-04-03T00:00:00.000Z'),
        procurementMethod: '谈判采购',
        budgetAmount: 1_800_000,
        controlAmount: 2_000_000,
        awardAmount: 1_700_000,
        resultStatus: ResultStatus.AWARDED,
        resultText: '已成交',
        awardedSupplierId: 'supplier-2',
        department: { name: '采购中心' },
        project: { name: '项目 B', createdAt: new Date('2026-03-01T00:00:00.000Z') }, // b7674eb1 时间轴聚合读 createdAt（DB 列永非空，mock 漂移补齐）
        participants: [
          {
            supplierId: 'supplier-2',
            supplier: { name: '供应商 B' },
          },
        ],
      },
      {
        id: 'round-pending-1',
        procurementDate: new Date('2026-04-04T00:00:00.000Z'),
        procurementMethod: '询价',
        budgetAmount: 450_000,
        controlAmount: 500_000,
        awardAmount: null,
        resultStatus: ResultStatus.PENDING,
        resultText: '待开评标',
        awardedSupplierId: null,
        department: { name: '采购中心' },
        project: { name: '项目 C', createdAt: new Date('2026-03-01T00:00:00.000Z') }, // b7674eb1 时间轴聚合读 createdAt（DB 列永非空，mock 漂移补齐）
        participants: [],
      },
      {
        id: 'round-failed-1',
        procurementDate: new Date('2026-04-05T00:00:00.000Z'),
        procurementMethod: '谈判采购',
        budgetAmount: 250_000,
        controlAmount: 300_000,
        awardAmount: null,
        resultStatus: ResultStatus.FAILED_REVIEW,
        resultText: '未成交',
        awardedSupplierId: null,
        department: { name: '采购中心' },
        project: { name: '项目 D', createdAt: new Date('2026-03-01T00:00:00.000Z') }, // b7674eb1 时间轴聚合读 createdAt（DB 列永非空，mock 漂移补齐）
        participants: [],
      },
    ];

    const prisma = {
      procurementRound: {
        findMany: jest.fn().mockResolvedValue(rounds),
      },
      // R6-6③：归档时点映射查 PMI（无关联轮次回退 updatedAt——空映射表等价旧行为）
      projectManagementItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      attachment: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    return {
      service: new DashboardService(prisma as never),
      prisma,
    };
  };

  it('labels 立项/归档-only trend buckets as M/DD instead of the raw ISO bucket key (2026-09-26 底部时间栏统一)', async () => {
    const { service } = makeService();

    const result = await service.getDashboard('2026-04-01', '2026-04-30');

    // 项目立项日 2026-03-01 的桶只承载 initiated 节点（无采购日落点），
    // 此前该桶 label 残留 ISO 键 "2026-03-01"，与 "4/02" 混排在同一条时间轴上
    const labels = result.trendSeries.map((t) => t.label);
    expect(labels).toContain('3/01');
    expect(labels.every((l) => !/^\d{4}-\d{2}-\d{2}$/.test(l))).toBe(true);
  });

  it('returns summary values needed by the dashboard top row', async () => {
    const { service } = makeService();

    const result = await service.getDashboard('2026-04-01', '2026-04-30');

    expect(result.summary).toMatchObject({
      totalBudget: 3_400_000,
      totalBudgetLabel: '340.0 万',
      awardedBudget: 2_700_000,
      awardedBudgetLabel: '270.0 万',
      pendingBudget: 700_000,
      pendingBudgetLabel: '70.0 万',
      totalAward: 2_500_000,
      totalAwardLabel: '250.0 万',
      totalSavings: 200_000,
      totalSavingsLabel: '20.0 万',
      completedCount: 2,
      totalCount: 4,
      // 异常口径（2026-09-28 审计修订）：PENDING=正常在途不算异常——
      // 测试集 4 轮 = 2 AWARDED + 1 PENDING + 1 FAILED_REVIEW → 异常仅 1
      abnormalCount: 1,
    });
  });

  /* 节资公司/部门榜（2026-11-23 用户裁定：节资排行板块加部门维度、单公司时替代公司榜）——
   * 口径同 summary.totalSavings：仅 AWARDED 且预算/成交为正、预算≥成交（超预算中标不计） */
  describe('节资公司/部门榜', () => {
    const round = (over: Record<string, unknown>) => ({
      procurementDate: new Date('2026-04-10T00:00:00.000Z'),
      procurementMethod: '公开招标',
      controlAmount: null,
      resultText: '已成交',
      awardedSupplierId: null,
      participants: [],
      ...over,
    });
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    const coA = { companyId: 'co-a', company: { name: '甲公司' }, companyName: '甲公司' };
    const coB = { companyId: 'co-b', company: { name: '乙公司' }, companyName: '乙公司' };
    const rounds = [
      round({ id: '1', ...coA, department: { name: '工程部' }, project: { name: 'A1', createdAt }, budgetAmount: 1_000_000, awardAmount: 800_000, resultStatus: ResultStatus.AWARDED }),
      round({ id: '2', ...coA, department: { name: '工程部' }, project: { name: 'A2', createdAt }, budgetAmount: 500_000, awardAmount: 400_000, resultStatus: ResultStatus.AWARDED }),
      round({ id: '3', ...coA, department: { name: '财务部' }, project: { name: 'A3', createdAt }, budgetAmount: 2_000_000, awardAmount: 1_500_000, resultStatus: ResultStatus.AWARDED }),
      // 同名部门跨公司各自成行（乙公司·工程部）
      round({ id: '4', ...coB, department: { name: '工程部' }, project: { name: 'B1', createdAt }, budgetAmount: 3_000_000, awardAmount: 2_000_000, resultStatus: ResultStatus.AWARDED }),
      // 超预算中标（预算<成交）不计节资
      round({ id: '5', ...coA, department: { name: '工程部' }, project: { name: 'A4', createdAt }, budgetAmount: 100_000, awardAmount: 150_000, resultStatus: ResultStatus.AWARDED }),
      // 在途轮不计节资
      round({ id: '6', ...coB, department: { name: '工程部' }, project: { name: 'B2', createdAt }, budgetAmount: 400_000, awardAmount: null, resultStatus: ResultStatus.PENDING }),
    ];

    it('部门榜按节资额降序、公司×部门各自成行、合计可对账 totalSavings', async () => {
      const { service } = makeService(rounds);
      const result = await service.getDashboard('2026-04-01', '2026-04-30');

      expect(result.departmentSavingsRanking).toEqual([
        expect.objectContaining({ department: '工程部', company: '乙公司', savings: 1_000_000, savingsRate: 33.3, count: 1, topProject: 'B1' }),
        expect.objectContaining({ department: '财务部', company: '甲公司', savings: 500_000, savingsRate: 25, count: 1, topProject: 'A3' }),
        expect.objectContaining({ department: '工程部', company: '甲公司', savings: 300_000, savingsRate: 20, count: 2, topProject: 'A1' }),
      ]);
      expect(result.departmentSavingsRanking.reduce((s, r) => s + r.savings, 0)).toBe(result.summary.totalSavings);
    });

    it('公司榜按节资额降序，合计 = totalSavings', async () => {
      const { service } = makeService(rounds);
      const result = await service.getDashboard('2026-04-01', '2026-04-30');

      expect(result.companySavingsRanking).toEqual([
        expect.objectContaining({ company: '乙公司', savings: 1_000_000, savingsRate: 33.3, count: 1 }),
        expect.objectContaining({ company: '甲公司', savings: 800_000, savingsRate: 22.9, count: 3 }),
      ]);
      expect(result.companySavingsRanking.reduce((s, r) => s + r.savings, 0)).toBe(result.summary.totalSavings);
    });

    it('节资率项目排行放开到 Top 10 且仍按节资率降序', async () => {
      const many = Array.from({ length: 12 }, (_, i) =>
        round({ id: `m${i}`, ...coA, department: { name: '工程部' }, project: { name: `P${i}`, createdAt }, budgetAmount: 1_000_000, awardAmount: 100_000 + i * 10_000, resultStatus: ResultStatus.AWARDED }),
      );
      const { service } = makeService(many);
      const result = await service.getDashboard('2026-04-01', '2026-04-30');

      expect(result.savingsRanking).toHaveLength(10);
      // 成交额递增 → 节资率递减，榜首 P0、榜尾 P9（P10/P11 截断）
      expect(result.savingsRanking[0].project).toBe('P0');
      expect(result.savingsRanking[9].project).toBe('P9');
    });
  });
});
