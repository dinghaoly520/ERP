import { ResultStatus } from '@prisma/client';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const makeService = () => {
    const rounds = [
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
        project: { name: '项目 A' },
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
        procurementMethod: '竞争性谈判',
        budgetAmount: 1_800_000,
        controlAmount: 2_000_000,
        awardAmount: 1_700_000,
        resultStatus: ResultStatus.AWARDED,
        resultText: '已成交',
        awardedSupplierId: 'supplier-2',
        department: { name: '采购中心' },
        project: { name: '项目 B' },
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
        project: { name: '项目 C' },
        participants: [],
      },
      {
        id: 'round-failed-1',
        procurementDate: new Date('2026-04-05T00:00:00.000Z'),
        procurementMethod: '竞争性谈判',
        budgetAmount: 250_000,
        controlAmount: 300_000,
        awardAmount: null,
        resultStatus: ResultStatus.FAILED_REVIEW,
        resultText: '未成交',
        awardedSupplierId: null,
        department: { name: '采购中心' },
        project: { name: '项目 D' },
        participants: [],
      },
    ];

    const prisma = {
      procurementRound: {
        findMany: jest.fn().mockResolvedValue(rounds),
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
      totalSavings: 500_000,
      totalSavingsLabel: '50.0 万',
      completedCount: 2,
      totalCount: 4,
      abnormalCount: 2,
    });
  });
});
