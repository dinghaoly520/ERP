// apps/api/src/ai-bid-analysis/utils/archive-ai-usage.spec.ts
import { buildArchiveAiUsage } from './archive-ai-usage';

describe('buildArchiveAiUsage', () => {
  it('无 provenance 且无 bidders → null（项目未跑 AI 分析）', () => {
    expect(buildArchiveAiUsage(null, [])).toBeNull();
    expect(buildArchiveAiUsage(undefined, [])).toBeNull();
  });

  it('有 provenance + bidders → 完整结构', () => {
    const r = buildArchiveAiUsage(
      { model: 'deepseek-v4-pro', ranAt: '2026-07-03T10:00:00Z', promptVersions: { tenderRequirements: 'v1' } },
      [{ totalScore: 88.5, scoreItems: [{}, {}], bidSupplier: { supplierName: '甲公司' } }],
    );
    expect(r).not.toBeNull();
    expect(r!.model).toBe('deepseek-v4-pro');
    expect(r!.ranAt).toBe('2026-07-03T10:00:00Z');
    expect(r!.promptVersions).toEqual({ tenderRequirements: 'v1' });
    expect(r!.suppliers).toHaveLength(1);
    expect(r!.suppliers[0]).toEqual({ name: '甲公司', aiScoredItemsCount: 2, aiSuggestedTotal: 88.5 });
  });

  it('totalScore 为 Decimal/string 时转 number', () => {
    const r = buildArchiveAiUsage(
      { model: 'm' },
      [{ totalScore: '92.10', scoreItems: [{}], bidSupplier: { supplierName: '乙' } }],
    );
    expect(r!.suppliers[0].aiSuggestedTotal).toBe(92.1);
  });

  it('bidder 无 scoreItems → count 0 / total null', () => {
    const r = buildArchiveAiUsage(
      { model: 'm' },
      [{ totalScore: null, scoreItems: undefined, bidSupplier: { supplierName: '丙' } }],
    );
    expect(r!.suppliers[0].aiScoredItemsCount).toBe(0);
    expect(r!.suppliers[0].aiSuggestedTotal).toBeNull();
  });

  it('多个 bidders 都列出', () => {
    const r = buildArchiveAiUsage(
      { model: 'm' },
      [
        { totalScore: 80, scoreItems: [{}], bidSupplier: { supplierName: 'A' } },
        { totalScore: 90, scoreItems: [{}, {}, {}], bidSupplier: { supplierName: 'B' } },
      ],
    );
    expect(r!.suppliers).toHaveLength(2);
    expect(r!.suppliers.map((s: { name: string }) => s.name)).toEqual(['A', 'B']);
    expect(r!.suppliers[1].aiScoredItemsCount).toBe(3);
  });
});
