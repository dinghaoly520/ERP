import { BadRequestException } from '@nestjs/common';
import { assertNoCrossUnitEntry, formatAmountWithUnit, resolveOpeningAmountUnitMap } from './opening-amount-unit.util';

/** 唱标金额单位解析（单一来源）——dual-v2=万元、旧轨=null（裸数字按元语义） */
describe('resolveOpeningAmountUnitMap', () => {
  const prisma: any = {
    bidSupplier: { findMany: jest.fn() },
    supplierBidSubmission: { findMany: jest.fn() },
    bidOpeningRecord: { findMany: jest.fn().mockResolvedValue([]) }, // 单位戳列（2026-09-14）
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

  it('无投标记录 → 空表', async () => {
    prisma.bidSupplier.findMany.mockResolvedValue([]);
    prisma.bidOpeningRecord.findMany.mockResolvedValue([]);
    const map = await resolveOpeningAmountUnitMap(prisma, 'p1');
    expect(map.size).toBe(0);
  });

  it('单位戳优先（amountUnit 列）——无戳回退轨道推导（2026-09-14 自描述列）', async () => {
    prisma.bidSupplier.findMany.mockResolvedValue([
      { id: 'bs-1', supplierId: 'sup-1' }, // dual-v2 且有戳
      { id: 'bs-2', supplierId: 'sup-2' }, // dual-v2 无戳 → 推导回填
      { id: 'bs-3', supplierId: 'sup-3' }, // 旧轨但被标万元（数据修复痕迹）→ 戳优先
    ]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([
      { supplierId: 'sup-1', envelopeVersion: 'dual-v2' },
      { supplierId: 'sup-2', envelopeVersion: 'dual-v2' },
      { supplierId: 'sup-3', envelopeVersion: 'legacy' },
    ]);
    prisma.bidOpeningRecord.findMany.mockResolvedValue([
      { bidSupplierId: 'bs-1', amountUnit: '万元' },
      { bidSupplierId: 'bs-2', amountUnit: null },
      { bidSupplierId: 'bs-3', amountUnit: '万元' },
    ]);

    const map = await resolveOpeningAmountUnitMap(prisma, 'p1');

    expect(map.get('bs-1')).toBe('万元');
    expect(map.get('bs-2')).toBe('万元'); // 无戳回退推导
    expect(map.get('bs-3')).toBe('万元'); // 戳覆盖推导（legacy 推导本是 null）
  });
});

describe('assertNoCrossUnitEntry（dual-v2 录入单位闸）', () => {
  it('×10000 形态硬拦 400 PRICE_UNIT_SUSPECT', () => {
    // 密封 153.95（万元），主持人换算成元录入
    expect(() => assertNoCrossUnitEntry('153.95', '1539500')).toThrow(BadRequestException);
    try { assertNoCrossUnitEntry('153.95', '1539500'); } catch (e: any) {
      expect((e.getResponse() as any).code).toBe('PRICE_UNIT_SUSPECT');
      expect((e.getResponse() as any).error).toContain('万元');
    }
  });

  it('同单位正常值 / 真实不一致值 / 带单位文本 / 千分位不拦', () => {
    expect(() => assertNoCrossUnitEntry('153.95', '153.95')).not.toThrow();
    expect(() => assertNoCrossUnitEntry('153.95', '148.5')).not.toThrow();     // 真不一致走 P1-4 正常 409
    expect(() => assertNoCrossUnitEntry('153.95', '153.95万元')).not.toThrow(); // 自描述文本
    expect(() => assertNoCrossUnitEntry('153.95', '1,539,500.0')).toThrow();    // 千分位仍识别为×10000
    // ÷10000 方向不拦（供应商把元打进万元表单的合法歧义，交 P1-4 比对）
    expect(() => assertNoCrossUnitEntry('1,539,500', '153.95')).not.toThrow();
  });

  it('不可解析/缺值不拦（与 P1-4 语义对齐）', () => {
    expect(() => assertNoCrossUnitEntry(null, '153.95')).not.toThrow();
    expect(() => assertNoCrossUnitEntry('153.95', '')).not.toThrow();
    expect(() => assertNoCrossUnitEntry('面议', '1539500')).not.toThrow();
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
