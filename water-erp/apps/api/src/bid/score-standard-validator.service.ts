import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ScoreCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PASS_FAIL_CATEGORIES = new Set<ScoreCategory>([ScoreCategory.QUALIFICATION, ScoreCategory.RESPONSIVE]);
const SCORING_CATEGORIES = new Set<ScoreCategory>([ScoreCategory.BUSINESS, ScoreCategory.TECHNICAL, ScoreCategory.PRICE]);

@Injectable()
export class ScoreStandardValidator {
  constructor(private readonly prisma: PrismaService) {}

  /** 通过性审查类别(QUALIFICATION/RESPONSIVE)满分必须为 0。 */
  assertPassFailMaxScore(category: ScoreCategory, maxScore: number): void {
    if (PASS_FAIL_CATEGORIES.has(category) && Number(maxScore) !== 0) {
      throw new BadRequestException({
        error: '通过性审查类别满分必须为 0',
        code: 'PASS_FAIL_MUST_BE_ZERO',
      });
    }
  }

  /** 某评分项的得分点 ΣfullScore + 增量 ≤ item.maxScore。事务内调用,复用 tx。 */
  async assertPointsSumWithinMax(
    tx: Prisma.TransactionClient,
    itemId: string,
    itemMaxScore: number,
    delta: number,
  ): Promise<void> {
    // P2：行锁评分项，消除并发新增/修改得分点致 ΣfullScore>maxScore 的竞态
    await tx.$queryRaw`SELECT id FROM "BidScoreItem" WHERE id = ${itemId} FOR UPDATE`;
    const agg = await tx.bidScorePoint.aggregate({
      where: { scoreItemId: itemId },
      _sum: { fullScore: true },
    });
    const sum = Number(agg._sum.fullScore ?? 0) + Number(delta);
    // P2：浮点容差（Decimal 十分位求和在二进制浮点下不精确，0.1+0.1+0.1≠0.3）
    if (sum - Number(itemMaxScore) > 0.05) {
      throw new ConflictException({
        error: `得分点满分合计 ${sum} 超过大类满分 ${itemMaxScore}`,
        code: 'POINTS_SUM_EXCEEDS_MAX',
      });
    }
  }

  /** 评分标准整体完整:打分类 ΣmaxScore === 100;每个打分类项 ≥1 得分点(通过性项豁免)。 */
  async assertScoreStandardComplete(projectId: string): Promise<void> {
    const items = await this.prisma.bidScoreItem.findMany({
      where: { projectId },
      include: { _count: { select: { points: true } } },
    });
    // N10：打分类项满分须 >0——0 分「空项」曾随标准发布并永久锁定（英雄项目「法」）
    for (const item of items) {
      if (!PASS_FAIL_CATEGORIES.has(item.category) && Number(item.maxScore) <= 0) {
        throw new BadRequestException({
          error: `评分项「${item.name}」为打分类但满分为 0，请删除或设置满分`,
          code: 'SCORE_ITEM_ZERO_MAX',
        });
      }
    }
    const sumMax = items
      .filter((i) => SCORING_CATEGORIES.has(i.category))
      .reduce((s, i) => s + Number(i.maxScore), 0);
    // P2：浮点容差（33.3+33.3+33.4 在二进制浮点下 ≠ 100）
    if (Math.abs(sumMax - 100) > 0.05) {
      throw new ConflictException({
        error: `打分类满分合计须为 100,当前为 ${sumMax}`,
        code: 'MAX_SCORE_SUM_NOT_100',
      });
    }
    const noPoints = items.find((i) => SCORING_CATEGORIES.has(i.category) && i._count.points === 0);
    if (noPoints) {
      throw new ConflictException({
        error: `评分项「${noPoints.name}」未设置得分点`,
        code: 'SCORE_ITEM_HAS_NO_POINTS',
      });
    }
    // P0-A：每个打分类项的得分点 ΣfullScore 不得超过该项 maxScore（防止降满分/套模板后总分 >100）
    for (const i of items.filter((x) => SCORING_CATEGORIES.has(x.category))) {
      const agg = await this.prisma.bidScorePoint.aggregate({
        where: { scoreItemId: i.id },
        _sum: { fullScore: true },
      });
      const sum = Number(agg._sum.fullScore ?? 0);
      if (sum - Number(i.maxScore) > 0.05) { // P2：浮点容差
        throw new ConflictException({
          error: `评分项「${i.name}」得分点满分合计 ${sum} 超过其满分 ${i.maxScore}`,
          code: 'POINTS_SUM_EXCEEDS_MAX',
        });
      }
    }
  }
}
