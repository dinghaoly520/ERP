// apps/api/src/ai-bid-analysis/services/report-generator.service.spec.ts
// 修复 BUSINESS/COMMERCIAL 命名 bug：categoryTotals key 是 BUSINESS（schema:78），不是 COMMERCIAL
import { ReportGeneratorService } from './report-generator.service';

describe('ReportGeneratorService — categoryTotals key（BUSINESS 非 COMMERCIAL）', () => {
  let service: ReportGeneratorService;

  beforeEach(() => {
    service = new ReportGeneratorService();
  });

  it('generateRanking 从 categoryTotals.BUSINESS 读出商务分', () => {
    const bidders: any[] = [
      {
        id: 'br-1',
        status: 'COMPLETED',
        totalScore: 80,
        categoryTotals: {
          TECHNICAL: { score: 40, max: 50 },
          BUSINESS: { score: 20, max: 30 },
          PRICE: { score: 20, max: 20 },
        },
        qualificationStatus: '通过',
        riskLevel: 'low',
        bidSupplier: { supplierName: 'A公司' },
      },
    ];

    const ranking = (service as any).generateRanking(bidders);

    expect(ranking).toHaveLength(1);
    expect(ranking[0].commercialScore).toBe(20); // bug: 曾因 totals.COMMERCIAL 恒 null
    expect(ranking[0].technicalScore).toBe(40);
    expect(ranking[0].priceScore).toBe(20);
  });
});

describe('ReportGeneratorService — generateScoreItemsDetail（方案4：per-item 明细展平）', () => {
  let service: ReportGeneratorService;
  beforeEach(() => {
    service = new ReportGeneratorService();
  });

  it('把 bidder.scoreItems 按 category 分组，含 reason/strengths/weaknesses/priceAnalysis', () => {
    const bidders: any[] = [
      {
        id: 'br-1',
        status: 'COMPLETED',
        totalScore: 56,
        bidSupplier: { supplierName: 'A公司' },
        scoreItems: [
          { scoreItemId: 'si-1', category: 'TECHNICAL', name: '技术方案', score: 16, maxScore: 20, reason: '方案引用施工工艺', evidence: '第3章', strengths: ['专项方案'], weaknesses: ['应急不足'], confidence: 0.85 },
          { scoreItemId: 'si-2', category: 'TECHNICAL', name: '人员配置', score: 8, maxScore: 10, reason: '项目经理资质强', strengths: ['高级工程师'], weaknesses: [] },
          { scoreItemId: 'si-p', category: 'PRICE', name: '报价', score: 20, maxScore: 20, reason: '报价与基准持平', evidence: '策略：合理报价', priceAnalysis: { deviation: '+0%', strategyAssessment: { type: '合理报价', confidence: 0.85 } } },
        ],
        categoryTotals: { TECHNICAL: { score: 24, max: 30 }, PRICE: { score: 20, max: 20 } },
        starredResponse: { allMet: false, unmet: ['★号条款：安全生产许可证'] },
      },
    ];

    const detail = (service as any).generateScoreItemsDetail(bidders);

    expect(detail).toHaveLength(1);
    expect(detail[0].bidderName).toBe('A公司');
    expect(detail[0].totalScore).toBe(56);
    expect(detail[0].starredResponse).toEqual({ allMet: false, unmet: ['★号条款：安全生产许可证'] });

    const tech = detail[0].categoryGroups.find((g: any) => g.category === 'TECHNICAL');
    expect(tech.categoryName).toBe('技术');
    expect(tech.score).toBe(24);
    expect(tech.maxScore).toBe(30);
    expect(tech.items).toHaveLength(2);
    expect(tech.items[0].strengths).toEqual(['专项方案']);
    expect(tech.items[0].weaknesses).toEqual(['应急不足']);
    expect(tech.items[0].reason).toBe('方案引用施工工艺');

    const price = detail[0].categoryGroups.find((g: any) => g.category === 'PRICE');
    expect(price.categoryName).toBe('报价');
    expect(price.items[0].priceAnalysis?.strategyAssessment?.type).toBe('合理报价');
  });

  it('跳过非 COMPLETED 的 bidder', () => {
    const bidders: any[] = [
      { id: 'br-1', status: 'FAILED', totalScore: null, bidSupplier: { supplierName: 'X' }, scoreItems: [], categoryTotals: {} },
      { id: 'br-2', status: 'COMPLETED', totalScore: 50, bidSupplier: { supplierName: 'A' }, scoreItems: [{ scoreItemId: 'si', category: 'TECHNICAL', name: 't', score: 10, maxScore: 10 }], categoryTotals: { TECHNICAL: { score: 10, max: 10 } } },
    ];
    const detail = (service as any).generateScoreItemsDetail(bidders);
    expect(detail).toHaveLength(1);
    expect(detail[0].bidderName).toBe('A');
  });
});
