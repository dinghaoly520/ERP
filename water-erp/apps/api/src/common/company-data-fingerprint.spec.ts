import { companyDataFingerprint } from './company-data-fingerprint';
import type { PrismaService } from '../prisma/prisma.service';

function mockPrisma() {
  const agg = (iso: string | null) => jest.fn().mockResolvedValue({
    _count: 3,
    _max: { updatedAt: iso ? new Date(iso) : null },
  });
  return {
    procurementRound: { aggregate: agg('2026-11-12T11:11:00.727Z') },
    projectManagementItem: { aggregate: agg('2026-11-12T10:00:00.000Z') },
    supplierCompanyLink: { aggregate: agg('2026-11-10T09:58:50.265Z') },
  } as unknown as PrismaService & Record<string, { aggregate: jest.Mock }>;
}

describe('companyDataFingerprint 变体（2026-11-12 用户裁定：数据库只与台账内容有关）', () => {
  it("full（默认，进度洞察）：三表聚合，含 p/s 段", async () => {
    const p = mockPrisma();
    const fp = await companyDataFingerprint(p, 'co-x');
    expect(fp).toContain('|p3@');
    expect(fp).toContain('|s3@');
    expect((p as Record<string, { aggregate: jest.Mock }>).projectManagementItem.aggregate).toHaveBeenCalled();
  });

  it("ledger（数据库/综合分析）：只查台账表——PMI 与归属链接不进指纹、不被查询", async () => {
    const p = mockPrisma();
    const fp = await companyDataFingerprint(p, 'co-x', 'ledger');
    expect(fp).toMatch(/^r3@2026-11-12T11:11:00\.727Z$/); // 仅 r 段
    expect((p as Record<string, { aggregate: jest.Mock }>).projectManagementItem.aggregate).not.toHaveBeenCalled();
    expect((p as Record<string, { aggregate: jest.Mock }>).supplierCompanyLink.aggregate).not.toHaveBeenCalled();
  });

  it('同数据同指纹；台账 updatedAt 变则变', async () => {
    const p = mockPrisma();
    const a = await companyDataFingerprint(p, 'co-x', 'ledger');
    const b = await companyDataFingerprint(p, 'co-x', 'ledger');
    expect(a).toBe(b);
    (p.procurementRound.aggregate as jest.Mock).mockResolvedValue({
      _count: 4,
      _max: { updatedAt: new Date('2026-11-12T12:00:00.000Z') },
    });
    const c = await companyDataFingerprint(p, 'co-x', 'ledger');
    expect(c).not.toBe(a);
  });
});
