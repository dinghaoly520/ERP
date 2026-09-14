import { formatAmountWithUnit, resolveOpeningAmountUnitMap } from './opening-amount-unit.util';

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

describe('formatAmountWithUnit（证据/纸面渲染）', () => {
  it('万元裸数字补单位后缀；带单位/自由文本/空值原文直出', () => {
    expect(formatAmountWithUnit('153.95', '万元')).toBe('153.95 万元');
    expect(formatAmountWithUnit('1,260.5', '万元')).toBe('1,260.5 万元');
    // 文本自带单位 / 不可解析 → 原文（不双拼「万元 万元」）
    expect(formatAmountWithUnit('1150万元', '万元')).toBe('1150万元');
    expect(formatAmountWithUnit('面议', '万元')).toBe('面议');
    // 旧轨（无单位标记）与空值 → 原文/空串
    expect(formatAmountWithUnit('3980000', null)).toBe('3980000');
    expect(formatAmountWithUnit('1080万元', null)).toBe('1080万元');
    expect(formatAmountWithUnit(null, '万元')).toBe('');
    expect(formatAmountWithUnit(undefined, null)).toBe('');
  });
});
