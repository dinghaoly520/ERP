// apps/api/src/ai-bid-analysis/services/competitive-analysis.service.spec.ts
// PRICE 维度 weakness 应被过滤（价格由 priceAnalysis 专项处理，避免首轮 PRICE=0 误判）
import { Test } from '@nestjs/testing';
import { CompetitiveAnalysisService } from './competitive-analysis.service';
import { LlmService } from '../../local-ai/llm.service';

describe('CompetitiveAnalysisService — PRICE 维度过滤', () => {
  let service: CompetitiveAnalysisService;
  let mockLlm: any;

  beforeEach(async () => {
    mockLlm = { chatJson: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        CompetitiveAnalysisService,
        { provide: LlmService, useValue: mockLlm },
      ],
    }).compile();
    service = module.get(CompetitiveAnalysisService);
  });

  it('PRICE 维度 weakness 被过滤（价格由 priceAnalysis 处理，不基于首轮 PRICE 分数）', async () => {
    mockLlm.chatJson.mockResolvedValue({
      strengths: [{ dimension: 'technical', title: '技术方案完整', detail: '工艺可行' }],
      weaknesses: [
        { dimension: 'price', title: '报价得分为零', detail: 'score 为 0', evidence: 'score=0' },
        { dimension: 'commercial', title: '商务偏低', detail: '业绩不足' },
      ],
      overallComment: '综合评价',
      keyObservations: [],
    });

    const result = await service.analyze('A公司', 70, { technical: { score: 30 } }, {}, 'task-1', 'br-1');

    // price weakness 被过滤（即使 LLM 基于首轮 PRICE=0 生成了）
    expect(result.weaknesses.find((w) => w.dimension === 'price')).toBeUndefined();
    expect(result.weaknesses.find((w) => w.title.includes('报价得分'))).toBeUndefined();
    // commercial weakness 保留
    expect(result.weaknesses).toHaveLength(1);
    expect(result.weaknesses[0].dimension).toBe('commercial');
  });
});
