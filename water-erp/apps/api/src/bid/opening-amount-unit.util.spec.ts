import { resolveOpeningAmountUnitMap } from './opening-amount-unit.util';

/** 唱标金额单位解析（单一来源）——dual-v2=万元、旧轨=null（裸数字按元语义） */
describe('resolveOpeningAmountUnitMap', () => {
  const prisma: any = {
    bidSupplier: { findMany: jest.fn() },
    supplierBidSubmission: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dual-v2 投递的投标记录 → 万元；旧轨 → null；混合项目互不干扰', async () => {
    prisma.bidSupplier.findMany.mockResolvedValue([
      { id: 'bs-1', supplierId: 'sup-1' },
      { id: 'bs-2', supplierId: 'sup-2' },
      { id: 'bs-3', supplierId: null },
    ]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 'sup-1', envelopeVersion: 'dual-v2' },
      { supplierId: 'sup-2', envelopeVersion: 'legacy' },
    ]);

    const map = await resolveOpeningAmountUnitMap(prisma, 'p1');

    expect(map.get('bs-1')).toBe('万元');
    expect(map.get('bs-2')).toBeNull();
    expect(map.get('bs-3')).toBeNull();
  });

  it('无投标记录 → 空表，不查投递表', async () => {
    prisma.bidSupplier.findMany.mockResolvedValue([]);
    const map = await resolveOpeningAmountUnitMap(prisma, 'p1');
    expect(map.size).toBe(0);
    expect(prisma.supplierBidSubmission.findMany).not.toHaveBeenCalled();
  });
});
