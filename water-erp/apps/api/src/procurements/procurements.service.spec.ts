import { ProcurementsService } from './procurements.service';

const mockAdminUser = { sub: 'admin-id', username: 'admin', role: 'admin' as const };

describe('ProcurementsService recycle bin', () => {
  const makeService = () => {
    const prisma = {
      procurementRound: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    return {
      prisma,
      service: new ProcurementsService(prisma as any),
    };
  };

  it('excludes recycled procurement rounds from the default database list', async () => {
    const { prisma, service } = makeService();

    await service.findAll({ page: 1, pageSize: 12 }, mockAdminUser);

    expect(prisma.procurementRound.count).toHaveBeenCalledWith({
      where: { isRecycled: false },
    });
    expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isRecycled: false } }),
    );
  });

  it('lists only recycled procurement rounds when status is RECYCLED', async () => {
    const { prisma, service } = makeService();

    await service.findAll({ page: 1, pageSize: 12, recycleStatus: 'RECYCLED' }, mockAdminUser);

    expect(prisma.procurementRound.count).toHaveBeenCalledWith({
      where: { isRecycled: true },
    });
    expect(prisma.procurementRound.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isRecycled: true } }),
    );
  });

  it('moves a procurement round into the database recycle bin', async () => {
    const { prisma, service } = makeService();
    prisma.procurementRound.findUnique.mockResolvedValue({ id: 'round-01', createdById: 'admin-id' });
    prisma.procurementRound.update.mockResolvedValue({ id: 'round-01', isRecycled: true });

    await expect(service.moveToRecycleBin('round-01', mockAdminUser)).resolves.toMatchObject({
      id: 'round-01',
      isRecycled: true,
    });

    expect(prisma.procurementRound.update).toHaveBeenCalledWith({
      where: { id: 'round-01' },
      data: { isRecycled: true },
    });
  });

  it('restores a procurement round from the database recycle bin', async () => {
    const { prisma, service } = makeService();
    prisma.procurementRound.findUnique.mockResolvedValue({ id: 'round-01', createdById: 'admin-id' });
    prisma.procurementRound.update.mockResolvedValue({ id: 'round-01', isRecycled: false });

    await expect(service.restoreFromRecycleBin('round-01', mockAdminUser)).resolves.toMatchObject({
      id: 'round-01',
      isRecycled: false,
    });

    expect(prisma.procurementRound.update).toHaveBeenCalledWith({
      where: { id: 'round-01' },
      data: { isRecycled: false },
    });
  });
});

/** getStats 节资口径（2026-10-28 收口）：与 dashboard getDashboard/环比同源——
 *  仅 AWARDED 且 budget>0、award>0、budget>=award 参与合计。
 *  原「总预算−总中标」把 PENDING/CANCELLED 轮的预算全部虚增为「节资」
 *  （移动端台账与驾驶舱同 App 同标签「累计节资」两数矛盾）。 */
describe('ProcurementsService.getStats — totalSavings 口径', () => {
  it('仅 AWARDED 且 budget>=award>0 的轮次计入（PENDING 预算/超预算中标/缺金额均不计）', async () => {
    const calls: any = {
      count: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn()
        .mockResolvedValueOnce({ _sum: { budgetAmount: 1_000_000 } })  // budgetSum（含 PENDING 轮）
        .mockResolvedValueOnce({ _sum: { awardAmount: 500_000 } }),      // awardSum
      findMany: jest.fn().mockResolvedValue([
        { budgetAmount: 100, awardAmount: 80 },   // AWARDED 正常 → +20
        { budgetAmount: 100, awardAmount: 120 },  // 超预算中标 → 不计
        { budgetAmount: 100, awardAmount: null }, // 缺中标额 → 不计
        { budgetAmount: 50, awardAmount: 30 },    // AWARDED 正常 → +20
      ]),
    };
    const prisma = { procurementRound: calls };
    const { ProcurementsService } = require('./procurements.service');
    const svc = new (ProcurementsService as any)(prisma);
    const res = await svc.getStats(undefined, undefined, undefined, {});
    expect(res.totalSavings).toBe(40); // 旧口径会是 500,000（1M−0.5M）
  });
});
