// apps/api/src/ai-bid-analysis/services/docx-generator.service.spec.ts
// 方案4：验证含 scoreItemsDetail 的 report 能完整渲染 DOCX（per-item 明细 + PRICE priceAnalysis）
import { DocxGeneratorService } from './docx-generator.service';

describe('DocxGeneratorService — 方案4 逐项评分明细渲染', () => {
  let service: DocxGeneratorService;

  beforeEach(() => {
    service = new DocxGeneratorService();
  });

  it('含 scoreItemsDetail 的 report 正常生成 DOCX（per-item 明细 + PRICE priceAnalysis 不崩）', async () => {
    const report: any = {
      summary: { taskName: 'T', projectName: 'P', totalBidders: 1, completedBidders: 1 },
      ranking: [
        {
          rank: 1,
          bidderName: 'A公司',
          totalScore: '80.00',
          technicalScore: 40,
          commercialScore: 20,
          priceScore: 20,
          qualificationStatus: '通过',
          riskLevel: 'low',
        },
      ],
      scoreItemsDetail: [
        {
          bidderId: 'br-1',
          bidderName: 'A公司',
          totalScore: 80,
          starredResponse: { allMet: false, unmet: ['★号条款：安全生产许可证'] },
          categoryGroups: [
            {
              category: 'TECHNICAL',
              categoryName: '技术',
              score: 40,
              maxScore: 50,
              items: [
                {
                  name: '技术方案',
                  score: 16,
                  maxScore: 20,
                  reason: '方案引用施工工艺',
                  evidence: '第3章',
                  strengths: ['专项施工方案'],
                  weaknesses: ['应急预案不足'],
                  confidence: 0.85,
                },
                { name: '符合性项', score: 0, maxScore: 0, pass: true, reason: '满足' },
              ],
            },
            {
              category: 'PRICE',
              categoryName: '报价',
              score: 20,
              maxScore: 20,
              items: [
                {
                  name: '报价',
                  score: 20,
                  maxScore: 20,
                  reason: '报价合理，分项构成规范',
                  evidence: '策略：合理报价',
                  priceAnalysis: {
                    deviation: '+0%',
                    strategyAssessment: { type: '合理报价', confidence: 0.85 },
                    riskWarning: '无明显价格风险',
                  },
                },
              ],
            },
          ],
        },
      ],
      conclusion: '测试结论',
    };

    const buffer = await service.generate(report);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('scoreItemsDetail 缺失时走"暂无"分支也能生成', async () => {
    const buffer = await service.generate({ conclusion: '无明细' } as any);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
