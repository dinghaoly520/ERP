import { BadRequestException, ConflictException } from '@nestjs/common';
import { ScoreCategory } from '@prisma/client';
import { ScoreStandardValidator } from './score-standard-validator.service';

describe('ScoreStandardValidator', () => {
  let validator: ScoreStandardValidator;
  const prisma: any = {
    bidScoreItem: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    validator = new ScoreStandardValidator(prisma);
  });

  describe('assertPassFailMaxScore', () => {
    it('QUALIFICATION + 0 通过', () => {
      expect(() => validator.assertPassFailMaxScore(ScoreCategory.QUALIFICATION, 0)).not.toThrow();
    });
    it('QUALIFICATION + 5 → 400 PASS_FAIL_MUST_BE_ZERO', () => {
      try {
        validator.assertPassFailMaxScore(ScoreCategory.QUALIFICATION, 5);
        fail('应抛 BadRequestException');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'PASS_FAIL_MUST_BE_ZERO' });
      }
    });
    it('TECHNICAL + 50 通过', () => {
      expect(() => validator.assertPassFailMaxScore(ScoreCategory.TECHNICAL, 50)).not.toThrow();
    });
  });

  describe('assertPointsSumWithinMax', () => {
    const tx: any = { bidScorePoint: { aggregate: jest.fn() } };
    beforeEach(() => jest.clearAllMocks());

    it('现有 30 + delta 15 ≤ 50 通过', async () => {
      tx.bidScorePoint.aggregate.mockResolvedValue({ _sum: { fullScore: 30 } });
      await expect(validator.assertPointsSumWithinMax(tx, 'item1', 50, 15)).resolves.toBeUndefined();
    });
    it('现有 30 + delta 25 > 50 → 409', async () => {
      tx.bidScorePoint.aggregate.mockResolvedValue({ _sum: { fullScore: 30 } });
      await expect(validator.assertPointsSumWithinMax(tx, 'item1', 50, 25)).rejects.toBeInstanceOf(ConflictException);
    });
    it('delta 为负(删点)通过', async () => {
      tx.bidScorePoint.aggregate.mockResolvedValue({ _sum: { fullScore: 40 } });
      await expect(validator.assertPointsSumWithinMax(tx, 'item1', 50, -10)).resolves.toBeUndefined();
    });
  });

  describe('assertScoreStandardComplete', () => {
    it('打分类 Σ=100 + 全打分类项有点 + 通过性项无点 → 通过', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { category: 'QUALIFICATION', maxScore: 0, name: '资格', _count: { points: 0 } },
        { category: 'RESPONSIVE', maxScore: 0, name: '响应', _count: { points: 0 } },
        { category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 5 } },
        { category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).resolves.toBeUndefined();
    });
    it('Σ=55 → 409 MAX_SCORE_SUM_NOT_100', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { category: 'TECHNICAL', maxScore: 5, name: '技术', _count: { points: 1 } },
        { category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).rejects.toMatchObject({
        response: { code: 'MAX_SCORE_SUM_NOT_100' },
      });
    });
    it('打分类项无点 → 409 SCORE_ITEM_HAS_NO_POINTS', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 0 } },
        { category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 5 } },
        { category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).rejects.toMatchObject({
        response: { code: 'SCORE_ITEM_HAS_NO_POINTS' },
      });
    });
    it('通过性项无点(走 passed 裁定)→ 通过', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { category: 'QUALIFICATION', maxScore: 0, name: '资格', _count: { points: 0 } },
        { category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 5 } },
        { category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).resolves.toBeUndefined();
    });
  });
});
