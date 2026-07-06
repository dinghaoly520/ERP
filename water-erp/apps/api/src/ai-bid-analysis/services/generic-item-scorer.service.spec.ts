// apps/api/src/ai-bid-analysis/services/generic-item-scorer.service.spec.ts
// C13 (7.3): per-item 评分测试 — score + scorePriceByFormula + mergeAndAggregate
import { Test, TestingModule } from '@nestjs/testing';
import { GenericItemScorerService } from './generic-item-scorer.service';
import { LlmService } from '../../local-ai/llm.service';
import { PriceAnalyzerService } from './price-analyzer.service';
import type { BidScoreItem } from '@prisma/client';
import type { AiScoreItem, TenderRequirements } from '../types';

describe('GenericItemScorerService — per-item 评分测试 (C13)', () => {
  let service: GenericItemScorerService;
  let mockLlm: any;
  let mockPriceAnalyzer: any;

  const makeScoreItem = (over: any): any =>
    ({
      id: 'si-1',
      projectId: 'p-1',
      category: 'TECHNICAL',
      name: '技术方案',
      maxScore: 20,
      scoringCriteria: null,
      evidenceHint: null,
      sortOrder: 0,
      passFailOnly: false,
      ...over,
    });

  const makePriceItem = (over: any = {}): any =>
    makeScoreItem({ id: 'si-price', category: 'PRICE', name: '报价', maxScore: 30, ...over });

  beforeEach(async () => {
    mockLlm = { chatJson: jest.fn() };
    // 默认空 PriceScore，使现有 PRICE 测试走 fallback 不受影响；新测试用 mockResolvedValueOnce 覆盖
    mockPriceAnalyzer = {
      analyze: jest.fn().mockResolvedValue({
        totalScore: 0, price: 0, priceRatio: '', benchmarkPrice: 0, deviation: '',
        priceBreakdown: {
          labor: { ratio: 0, assessment: '' }, material: { ratio: 0, assessment: '' },
          equipment: { ratio: 0, assessment: '' }, management: { ratio: 0, assessment: '' },
          profit: { ratio: 0, assessment: '' },
        },
        marketComparison: { estimatedMarketPrice: 0, deviationFromMarket: '', assessment: '' },
        strategyAssessment: { type: '', confidence: 0, reasoning: '' },
        riskWarning: '', analysis: '',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenericItemScorerService,
        { provide: LlmService, useValue: mockLlm },
        { provide: PriceAnalyzerService, useValue: mockPriceAnalyzer },
      ],
    }).compile();

    service = module.get(GenericItemScorerService);
  });

  // ── mergeAndAggregate ──────────────────────────────────────────────

  describe('mergeAndAggregate', () => {
    it('按 category 聚合分数 + 计算总分', () => {
      const items: AiScoreItem[] = [
        { scoreItemId: 'si-1', category: 'TECHNICAL', name: '方案', score: 15, maxScore: 20, confidence: 0.8 },
        { scoreItemId: 'si-2', category: 'TECHNICAL', name: '人员', score: 8, maxScore: 10, confidence: 0.7 },
        { scoreItemId: 'si-3', category: 'BUSINESS', name: '业绩', score: 12, maxScore: 15, confidence: 0.9 },
      ];

      const result = (service as any).mergeAndAggregate(items, '测试评语');

      expect(result.totalScore).toBe(35);
      expect(result.categoryTotals['TECHNICAL']).toEqual({ score: 23, max: 30 });
      expect(result.categoryTotals['BUSINESS']).toEqual({ score: 12, max: 15 });
      expect(result.overallComment).toBe('测试评语');
      expect(result.scoreItems).toHaveLength(3);
    });

    it('空列表返回 0 分 + 空 categoryTotals', () => {
      const result = (service as any).mergeAndAggregate([], '');

      expect(result.totalScore).toBe(0);
      expect(result.categoryTotals).toEqual({});
      expect(result.overallComment).toContain('0.0');
    });
  });

  // ── scorePriceByFormula ────────────────────────────────────────────

  describe('scorePriceByFormula（基准价法）', () => {
    it('报价等于基准价 → 满分', () => {
      const item = makePriceItem({ maxScore: 30 });
      const info = { quotePrice: 100 };
      const prices = [90, 100, 110]; // benchmark = 100

      const result = (service as any).scorePriceByFormula(item, info, prices);

      expect(result.score).toBe(30); // deviation = 0%
      expect(result.maxScore).toBe(30);
      expect(result.category).toBe('PRICE');
    });

    it('报价偏离基准价 → 按比例扣分', () => {
      const item = makePriceItem({ maxScore: 30 });
      const info = { quotePrice: 110 };
      const prices = [100, 100, 100]; // benchmark = 100, deviation = +10%

      const result = (service as any).scorePriceByFormula(item, info, prices);

      // ratio = 1 - 0.1*2 = 0.8, score = round(30*0.8*10)/10 = 24
      expect(result.score).toBe(24);
    });

    it('报价数据缺失 → 0 分', () => {
      const item = makePriceItem({ maxScore: 30 });
      const result1 = (service as any).scorePriceByFormula(item, {}, [100]);
      expect(result1.score).toBe(0);
      expect(result1.reason).toContain('数据不足');

      const result2 = (service as any).scorePriceByFormula(item, { quotePrice: 100 }, []);
      expect(result2.score).toBe(0);
      expect(result2.reason).toContain('数据不足');
    });

    it('偏离 >50% → 分数封底 0', () => {
      const item = makePriceItem({ maxScore: 30 });
      const info = { quotePrice: 200 };
      const prices = [100]; // benchmark = 100, deviation = +100%, ratio = 1-2 = -1

      const result = (service as any).scorePriceByFormula(item, info, prices);

      // ratio = max(0, 1 - 1*2) = 0, score = round(30*0*10)/10 = 0
      expect(result.score).toBe(0);
    });
  });

  // ── score（编排） ──────────────────────────────────────────────────

  describe('score（完整编排）', () => {
    it('纯 LLM 评分项（无价格项）', async () => {
      mockLlm.chatJson.mockResolvedValue({
        items: [
          { scoreItemId: 'si-1', score: 16, reason: '方案合理', confidence: 0.85 },
          { scoreItemId: 'si-2', score: 9, reason: '人员配置强', confidence: 0.8 },
        ],
        overallComment: '整体良好',
      });

      const items = [
        makeScoreItem({ id: 'si-1', name: '方案', maxScore: 20 }),
        makeScoreItem({ id: 'si-2', name: '人员', maxScore: 10 }),
      ];

      const result = await service.score(items, {}, null, 'task-1', 'bs-1', []);

      expect(result.totalScore).toBe(25);
      expect(result.scoreItems).toHaveLength(2);
      expect(result.overallComment).toBe('整体良好');
      expect(mockLlm.chatJson).toHaveBeenCalledTimes(1);
    });

    it('混合 LLM + 价格项', async () => {
      mockLlm.chatJson.mockResolvedValue({
        items: [{ scoreItemId: 'si-tech', score: 16, confidence: 0.85 }],
        overallComment: 'OK',
      });

      const items = [
        makeScoreItem({ id: 'si-tech', category: 'TECHNICAL', name: '技术', maxScore: 20 }),
        makePriceItem({ id: 'si-price', maxScore: 30 }),
      ];

      const result = await service.score(
        items,
        { quotePrice: 100 },
        null,
        'task-1',
        'bs-1',
        [100, 100, 100], // benchmark = 100
      );

      // 技术 16 + 价格 30（偏离 0%） = 46
      expect(result.totalScore).toBe(46);
      expect(result.scoreItems).toHaveLength(2);
      expect(result.categoryTotals['PRICE']).toEqual({ score: 30, max: 30 });
    });

    it('LLM 返回分数超出范围时 clamp 到 [0, maxScore]', async () => {
      mockLlm.chatJson.mockResolvedValue({
        items: [{ scoreItemId: 'si-1', score: 99 }], // 超 maxScore
        overallComment: '',
      });

      const items = [makeScoreItem({ id: 'si-1', maxScore: 10 })];
      const result = await service.score(items, {}, null, 'task-1', 'bs-1', []);

      expect(result.totalScore).toBe(10); // clamped
    });

    it('无 LLM 评分项（仅价格）也不调用 LLM', async () => {
      const items = [makePriceItem({ id: 'si-price', maxScore: 30 })];

      const result = await service.score(
        items,
        { quotePrice: 100 },
        null,
        'task-1',
        'bs-1',
        [100],
      );

      expect(mockLlm.chatJson).not.toHaveBeenCalled();
      expect(result.totalScore).toBe(30);
    });

    // ── 方案1：深度评分内核透传（strengths / weaknesses / starredResponse）──
    it('透传每项 strengths/weaknesses 与顶层 starredResponse（复用 procurement 深度评分内核）', async () => {
      mockLlm.chatJson.mockResolvedValue({
        items: [
          {
            scoreItemId: 'si-1',
            score: 16,
            reason: '方案引用了具体施工工艺与设备配置',
            evidence: '技术方案第3章',
            confidence: 0.85,
            strengths: ['文件列明针对复杂地质条件的专项施工方案'],
            weaknesses: ['对极端地质条件的应急预案不够详细'],
          },
        ],
        starredResponse: { allMet: false, unmet: ['★号条款：安全生产许可证'] },
        overallComment: '技术方案整体响应较好，应急预案需补充。',
      });

      const items = [makeScoreItem({ id: 'si-1', maxScore: 20 })];
      const result = await service.score(items, {}, null, 'task-1', 'bs-1', []);

      // 每项透传「正向事实 / 需关注项」
      expect(result.scoreItems[0].strengths).toEqual([
        '文件列明针对复杂地质条件的专项施工方案',
      ]);
      expect(result.scoreItems[0].weaknesses).toEqual([
        '对极端地质条件的应急预案不够详细',
      ]);
      // 顶层透传「★号实质性条款响应核查」
      expect(result.starredResponse).toEqual({
        allMet: false,
        unmet: ['★号条款：安全生产许可证'],
      });
    });
  });

  // ── 方案2：价格 LLM 分析层（公式分 + procurement price.prompt 分析）──
  describe('scorePriceWithAnalysis（方案2：公式分 + LLM 分析层）', () => {
    const fakeAnalysis = {
      totalScore: 18,
      price: 100,
      priceRatio: '100/100',
      benchmarkPrice: 100,
      deviation: '+0%',
      priceBreakdown: {
        labor: { ratio: 30, assessment: '人工费占比合理' },
        material: { ratio: 25, assessment: '材料费占比合理' },
        equipment: { ratio: 20, assessment: '设备费占比合理' },
        management: { ratio: 15, assessment: '管理费合理' },
        profit: { ratio: 10, assessment: '利润率合理' },
      },
      marketComparison: {
        estimatedMarketPrice: 0,
        deviationFromMarket: '未提供市场价依据',
        assessment: '未提供市场价依据',
      },
      strategyAssessment: { type: '合理报价', confidence: 0.85, reasoning: '报价与基准价持平，分项构成合理' },
      riskWarning: '无明显价格风险',
      analysis: '报价 100 万元与基准价持平，分项构成合理，策略为合理报价。',
    };

    it('PRICE 项叠加 LLM 分析：reason=综合分析，priceAnalysis 含分项/策略/风险', async () => {
      mockPriceAnalyzer.analyze.mockResolvedValueOnce(fakeAnalysis);

      const item = makePriceItem({ id: 'si-price', maxScore: 30 });
      const result = await (service as any).scorePriceWithAnalysis(
        item,
        { quotePrice: 100 },
        null,
        [100, 100, 100],
        'task-1',
        'bs-1',
      );

      expect(result.score).toBe(30); // 公式客观分（偏离 0%）不变
      expect(result.reason).toBe(fakeAnalysis.analysis); // LLM 综合分析替换公式 reason
      expect(result.evidence).toContain('合理报价'); // 策略写入 evidence
      expect(result.priceAnalysis?.strategyAssessment?.type).toBe('合理报价');
      expect(result.priceAnalysis?.priceBreakdown?.labor.ratio).toBe(30);
      expect(result.priceAnalysis?.riskWarning).toBe('无明显价格风险');
      expect(mockPriceAnalyzer.analyze).toHaveBeenCalledWith(
        { quotePrice: 100 },
        null,
        'task-1',
        'bs-1',
      );
    });

    it('LLM 分析失败 → fallback 公式 reason，不阻塞评分', async () => {
      mockPriceAnalyzer.analyze.mockRejectedValueOnce(new Error('LLM down'));

      const item = makePriceItem({ id: 'si-price', maxScore: 30 });
      const result = await (service as any).scorePriceWithAnalysis(
        item,
        { quotePrice: 100 },
        null,
        [100, 100, 100],
        'task-1',
        'bs-1',
      );

      expect(result.score).toBe(30); // 公式分仍正确
      expect(result.reason).toContain('基准价'); // fallback 公式 reason
      expect(result.priceAnalysis).toBeUndefined(); // 无 LLM 详情
    });
  });

  // ── A2 self-consistency ───────────────────────────────────────────
  describe('rescoreUnstable（A2 self-consistency）', () => {
    it('全高置信 → 不触发复跑（chatJson 仅首轮 1 次）', async () => {
      mockLlm.chatJson.mockResolvedValue({
        items: [{ scoreItemId: 'si-1', score: 16, confidence: 0.85 }],
        overallComment: 'OK',
      });
      const items = [makeScoreItem({ id: 'si-1', maxScore: 20 })];
      await service.score(items, {}, null, 'task-1', 'bs-1', []);
      expect(mockLlm.chatJson).toHaveBeenCalledTimes(1);
    });

    it('低置信触发复跑 → 取中位数 + 标 unstable（差值大）', async () => {
      mockLlm.chatJson
        .mockResolvedValueOnce({ items: [{ scoreItemId: 'si-1', score: 10, confidence: 0.4 }], overallComment: '' })
        .mockResolvedValueOnce({ items: [{ scoreItemId: 'si-1', score: 5, confidence: 0.4 }] })
        .mockResolvedValueOnce({ items: [{ scoreItemId: 'si-1', score: 8, confidence: 0.4 }] });
      const items = [makeScoreItem({ id: 'si-1', maxScore: 10 })];
      const result = await service.score(items, {}, null, 'task-1', 'bs-1', []);
      expect(mockLlm.chatJson).toHaveBeenCalledTimes(3); // 首轮 + 2 复跑
      expect(result.scoreItems[0].score).toBe(8); // median([10,5,8])
      expect(result.scoreItems[0].unstable).toBe(true); // 差 5 > 10×0.2
    });

    it('低置信但复跑一致 → stable', async () => {
      mockLlm.chatJson
        .mockResolvedValueOnce({ items: [{ scoreItemId: 'si-1', score: 8, confidence: 0.4 }], overallComment: '' })
        .mockResolvedValueOnce({ items: [{ scoreItemId: 'si-1', score: 8 }] })
        .mockResolvedValueOnce({ items: [{ scoreItemId: 'si-1', score: 8 }] });
      const items = [makeScoreItem({ id: 'si-1', maxScore: 20 })];
      const result = await service.score(items, {}, null, 'task-1', 'bs-1', []);
      expect(result.scoreItems[0].score).toBe(8);
      expect(result.scoreItems[0].unstable).toBe(false);
    });

    it('复跑抛错 → 保留首轮，不阻塞', async () => {
      mockLlm.chatJson
        .mockResolvedValueOnce({ items: [{ scoreItemId: 'si-1', score: 10, confidence: 0.4 }], overallComment: '' })
        .mockRejectedValueOnce(new Error('LLM down'))
        .mockRejectedValueOnce(new Error('LLM down'));
      const items = [makeScoreItem({ id: 'si-1', maxScore: 20 })];
      const result = await service.score(items, {}, null, 'task-1', 'bs-1', []);
      expect(result.scoreItems[0].score).toBe(10); // 保留首轮
      expect(result.scoreItems[0].unstable).toBeUndefined();
    });
  });
});
