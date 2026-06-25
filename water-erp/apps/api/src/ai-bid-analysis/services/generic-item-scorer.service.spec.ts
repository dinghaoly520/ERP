// apps/api/src/ai-bid-analysis/services/generic-item-scorer.service.spec.ts
// C13 (7.3): per-item 评分测试 — score + scorePriceByFormula + mergeAndAggregate
import { Test, TestingModule } from '@nestjs/testing';
import { GenericItemScorerService } from './generic-item-scorer.service';
import { LlmService } from '../../local-ai/llm.service';
import type { BidScoreItem } from '@prisma/client';
import type { AiScoreItem, TenderRequirements } from '../types';

describe('GenericItemScorerService — per-item 评分测试 (C13)', () => {
  let service: GenericItemScorerService;
  let mockLlm: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenericItemScorerService,
        { provide: LlmService, useValue: mockLlm },
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
  });
});
