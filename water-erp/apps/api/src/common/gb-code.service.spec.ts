import { GbCodeService } from './gb-code.service';

/**
 * backfillProcureCodeFor（2026-10-20 缺码事故防线）：为无码 BidProject 现场补齐 21 位采购编码。
 * 发布闸自愈（announcement.assertGbCodeIfLinked）与 ensureBidProject 存量治愈共用。
 * 真实 GbCodeService + mock prisma（systemConfig 缺省 → DEFAULTS 511/51/0000）。
 */
describe('GbCodeService — backfillProcureCodeFor（运行时补码）', () => {
  const mk = (over: Record<string, any> = {}) => {
    const prisma: any = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue(over.hostPmi ?? null), count: jest.fn().mockResolvedValue(over.pmiCount ?? 0) },
      bidProject: { count: jest.fn().mockResolvedValue(over.bidCount ?? 0), update: jest.fn().mockResolvedValue({}) },
      ...over.prisma,
    };
    return { gb: new GbCodeService(prisma), prisma };
  };

  it('有 PMI 宿主基码 → 复用 18 位基码派生 21 位采购码并落库', async () => {
    const { gb, prisma } = mk({ hostPmi: { gbProjectCode: '511510000261020004' } });
    const r = await gb.backfillProcureCodeFor({ id: 'bp-1', projectManagementItemId: 'pmi-1' });
    expect(r.gbProcureCode).toBe('511510000261020004001'); // 宿主基码 + 流水 001（21 位）
    expect(r.gbSectionCode).toBe('511510000261020004001001'); // 采购码 + 标段序 001
    expect(prisma.bidProject.update).toHaveBeenCalledWith({
      where: { id: 'bp-1' },
      data: { gbProcureCode: '511510000261020004001', gbSectionCode: '511510000261020004001001' },
    });
  });

  it('无宿主（无 PMI 挂靠）→ 自立基码（18 位含当日日期段）而非抛错', async () => {
    const { gb } = mk();
    const r = await gb.backfillProcureCodeFor({ id: 'bp-2' });
    expect(r.gbProcureCode).toMatch(/^511510000\d{6}\d{3}\d{3}$/); // 9 前缀 + yymmdd + 3 流水 + 3 采购流水
    expect(r.gbSectionCode).toMatch(/^\d{24}$/);
  });

  it('同基码并发序列：计数含既有码 → 流水递增不覆盖', async () => {
    const { gb } = mk({ hostPmi: { gbProjectCode: '511510000261020004' }, bidCount: 2 });
    const r = await gb.backfillProcureCodeFor({ id: 'bp-3', projectManagementItemId: 'pmi-1' });
    expect(r.gbProcureCode).toBe('511510000261020004003'); // count=2 → seq 3
  });
});
