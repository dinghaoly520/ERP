import { BadRequestException, ConflictException } from '@nestjs/common';
import { ScoreCategory } from '@prisma/client';
import { ScoreStandardValidator } from './score-standard-validator.service';

describe('ScoreStandardValidator', () => {
  let validator: ScoreStandardValidator;
  const prisma: any = {
    bidScoreItem: { findMany: jest.fn() },
    bidScorePoint: { aggregate: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // 2026-09-28 配满口径：assertScoreStandardComplete 要求 ΣfullScore = maxScore——
    // 默认 mock 按「最近一次 findMany 结果 + id 匹配」全额配分，使「通过」用例免逐项覆写
    prisma.bidScorePoint.aggregate.mockImplementation(async ({ where }: any) => {
      // mockResolvedValue 下 results[].value 是 Promise，须 await 取数组
      const items = (await prisma.bidScoreItem.findMany.mock.results.at(-1)?.value ?? []) as Array<{ id?: string; maxScore: number }>;
      const it = items.find((x) => x.id === where?.scoreItemId);
      return { _sum: { fullScore: it ? Number(it.maxScore) : 0 } };
    });
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
    const tx: any = { bidScorePoint: { aggregate: jest.fn() }, $queryRaw: jest.fn().mockResolvedValue([]) };
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
    it('打分类 Σ=100 + 全打分类项配满 + 通过性项无点 → 通过', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'q1', category: 'QUALIFICATION', maxScore: 0, name: '资格', _count: { points: 0 } },
        { id: 'r1', category: 'RESPONSIVE', maxScore: 0, name: '响应', _count: { points: 0 } },
        { id: 'b1', category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { id: 't1', category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 5 } },
        { id: 'p1', category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
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

    it('P2：ΣmaxScore 浮点容差（33.3+33.3+33.4≈100 通过；Σpoints=各项满分亦浮点配满）', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'i1', category: 'BUSINESS', maxScore: 33.3, name: 'a', _count: { points: 1 } },
        { id: 'i2', category: 'TECHNICAL', maxScore: 33.3, name: 'b', _count: { points: 1 } },
        { id: 'i3', category: 'PRICE', maxScore: 33.4, name: 'c', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).resolves.toBeUndefined();
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
        { id: 'q1', category: 'QUALIFICATION', maxScore: 0, name: '资格', _count: { points: 0 } },
        { id: 'b1', category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { id: 't1', category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 5 } },
        { id: 'p1', category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).resolves.toBeUndefined();
    });

    it('P0-A：打分类项 Σ得分点满分 > 该项满分 → 409 POINTS_SUM_EXCEEDS_MAX', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'i1', category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { id: 'i2', category: 'TECHNICAL', maxScore: 30, name: '技术', _count: { points: 2 } },
        { id: 'i3', category: 'PRICE', maxScore: 50, name: '价格', _count: { points: 1 } },
      ]);
      // 技术项满分已被降到 30，但其得分点合计仍为 50 → 不变量被破坏（其余项保持配满，
      // 避免被 2026-09-28 新增的下界检查抢先报错）
      prisma.bidScorePoint.aggregate.mockImplementation(async ({ where }: any) =>
        where.scoreItemId === 'i2' ? { _sum: { fullScore: 50 } } : { _sum: { fullScore: where.scoreItemId === 'i1' ? 20 : 50 } },
      );
      await expect(validator.assertScoreStandardComplete('p1')).rejects.toMatchObject({
        response: { code: 'POINTS_SUM_EXCEEDS_MAX' },
      });
    });

    it('2026-09-28：Σ得分点满分 < 该项满分（差额未分配）→ 409 POINTS_SUM_BELOW_MAX', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'i1', category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { id: 'i2', category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 14 } },
        { id: 'i3', category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      // 实测案例：技术 14 个得分点合计 49，差额 1 未分配 → 有效满分 99 ≠ 100，校验直报
      prisma.bidScorePoint.aggregate.mockImplementation(async ({ where }: any) =>
        where.scoreItemId === 'i2' ? { _sum: { fullScore: 49 } } : { _sum: { fullScore: where.scoreItemId === 'i1' ? 20 : 30 } },
      );
      await expect(validator.assertScoreStandardComplete('p1')).rejects.toMatchObject({
        response: { code: 'POINTS_SUM_BELOW_MAX' },
      });
    });

    it('2026-09-28：Σpoints 浮点容差内（50-0.04=49.96）→ 通过', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'i1', category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { id: 'i2', category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 3 } },
        { id: 'i3', category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      prisma.bidScorePoint.aggregate.mockImplementation(async ({ where }: any) =>
        where.scoreItemId === 'i2' ? { _sum: { fullScore: 49.96 } } : { _sum: { fullScore: where.scoreItemId === 'i1' ? 20 : 30 } },
      );
      await expect(validator.assertScoreStandardComplete('p1')).resolves.toBeUndefined();
    });

    it('N10：打分类评分项满分为 0 → SCORE_ITEM_ZERO_MAX（「法」式空项拦截，先于 Σ=100 检查）', async () => {
      // 英雄项目复现：Σ=20≠100，但空项拦截必须先于 Σ 检查报出更准确的错误
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'i1', name: '商务评分', category: 'BUSINESS', maxScore: 20, _count: { points: 2 } },
        { id: 'i2', name: '法', category: 'TECHNICAL', maxScore: 0, _count: { points: 0 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).rejects.toMatchObject({
        response: { code: 'SCORE_ITEM_ZERO_MAX' },
      });
    });
    it('N10：打分类评分项满分为负数 → 同样 SCORE_ITEM_ZERO_MAX（<=0 浮点判定）', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'i1', name: '商务', category: 'BUSINESS', maxScore: 20, _count: { points: 2 } },
        { id: 'i2', name: '技术', category: 'TECHNICAL', maxScore: 50, _count: { points: 2 } },
        { id: 'i3', name: '价格', category: 'PRICE', maxScore: 30, _count: { points: 1 } },
        { id: 'i4', name: '怪项', category: 'TECHNICAL', maxScore: -5, _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).rejects.toMatchObject({
        response: { code: 'SCORE_ITEM_ZERO_MAX' },
      });
    });
    it('N10：通过性项（QUALIFICATION/RESPONSIVE）满分 0 合法，不拦截', async () => {
      prisma.bidScoreItem.findMany.mockResolvedValue([
        { id: 'q1', category: 'QUALIFICATION', maxScore: 0, name: '资格', _count: { points: 0 } },
        { id: 'r1', category: 'RESPONSIVE', maxScore: 0, name: '响应', _count: { points: 0 } },
        { id: 'b1', category: 'BUSINESS', maxScore: 20, name: '商务', _count: { points: 2 } },
        { id: 't1', category: 'TECHNICAL', maxScore: 50, name: '技术', _count: { points: 5 } },
        { id: 'p1', category: 'PRICE', maxScore: 30, name: '价格', _count: { points: 1 } },
      ]);
      await expect(validator.assertScoreStandardComplete('p1')).resolves.toBeUndefined();
    });
  });
});
