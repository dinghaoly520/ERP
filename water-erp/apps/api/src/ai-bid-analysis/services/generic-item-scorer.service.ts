// apps/api/src/ai-bid-analysis/services/generic-item-scorer.service.ts
// per-item 评分器（方案 6.3）：取代 procurement 3 个固定评分器
// 按 BidScoreItem 逐项评分；价格项公式分离（不走 LLM）；非价格项 LLM 评分
import { Injectable, Logger } from '@nestjs/common';
import type { BidScoreItem } from '@prisma/client';
import { LlmService } from '../../local-ai/llm.service';
import { ITEM_SCORING_PROMPT } from '../prompts/item-scoring.prompt';
import { deterministicSeed } from '../utils';
import type { AiScoreItem, TenderRequirements } from '../types';

export interface ItemScoreResult {
  scoreItems: AiScoreItem[];
  categoryTotals: Record<string, { score: number; max: number }>;
  totalScore: number;
  overallComment: string;
}

@Injectable()
export class GenericItemScorerService {
  private readonly logger = new Logger(GenericItemScorerService.name);

  constructor(private llm: LlmService) {}

  /**
   * per-item 评分
   * @param scoreItems BidScoreItem 列表（含 scoringCriteria/evidenceHint）
   * @param extractedInfo 标书 LLM 提取结果
   * @param requirements 招标要求（含 scoringRules）
   * @param taskId / bidSupplierId 用于 deterministicSeed
   * @param allBidderPrices 所有投标单位报价（价格公式基准）
   */
  async score(
    scoreItems: BidScoreItem[],
    extractedInfo: any,
    requirements: TenderRequirements | null,
    taskId: string,
    bidSupplierId: string,
    allBidderPrices: number[] = [],
  ): Promise<ItemScoreResult> {
    // ★ 价格项分离：公式计算，不走 LLM
    const priceItems = scoreItems.filter((si) => si.category === 'PRICE');
    const llmItems = scoreItems.filter((si) => si.category !== 'PRICE');

    // LLM 评分非价格项
    let llmResults: AiScoreItem[] = [];
    let overallComment = '';
    if (llmItems.length > 0) {
      const llmResult = await this.llm.chatJson<{
        items: Array<{
          scoreItemId: string;
          score: number;
          pass?: boolean;
          reason?: string;
          evidence?: string;
          confidence?: number;
        }>;
        overallComment?: string;
      }>(
        '你是评标专家。按评分标准对每个评分项独立评分。',
        ITEM_SCORING_PROMPT.replace(
          '{{SCORE_ITEMS}}',
          JSON.stringify(
            llmItems.map((si) => ({
              id: si.id,
              category: si.category,
              name: si.name,
              maxScore: Number(si.maxScore),
              scoringCriteria: si.scoringCriteria,
              evidenceHint: si.evidenceHint,
            })),
          ),
        )
          .replace('{{BIDDER_INFO}}', JSON.stringify(extractedInfo ?? {}))
          .replace('{{REQUIREMENTS}}', JSON.stringify(requirements ?? {})),
        0,
        undefined,
        deterministicSeed(`${taskId}:${bidSupplierId}:score`),
      );

      overallComment = llmResult.overallComment ?? '';

      // 合并 LLM 结果回 BidScoreItem 元信息（name/category/maxScore）
      llmResults = llmItems.map((si) => {
        const r = llmResult.items.find((x) => x.scoreItemId === si.id);
        const maxScore = Number(si.maxScore);
        const rawScore = r?.score ?? 0;
        return {
          scoreItemId: si.id,
          category: si.category,
          name: si.name,
          score: Math.min(Math.max(0, rawScore), maxScore), // clamp [0, maxScore]
          maxScore,
          reason: r?.reason,
          evidence: r?.evidence,
          confidence: r?.confidence,
          pass: r?.pass,
        };
      });
    }

    // 价格项公式计算
    const priceResults = priceItems.map((si) =>
      this.scorePriceByFormula(si, extractedInfo, allBidderPrices),
    );

    return this.mergeAndAggregate(
      [...llmResults, ...priceResults],
      overallComment,
    );
  }

  /**
   * 价格项公式评分（基准价法，方案 6.3：requirements.scoringRules.priceMethod）
   * 简化实现：基准 = 所有报价平均值；偏离越小分越高
   * TODO: 按 priceMethod（基准价法/最低价法）细化，含复合基准（A+B 加权）
   */
  private scorePriceByFormula(
    si: BidScoreItem,
    extractedInfo: any,
    allPrices: number[],
  ): AiScoreItem {
    const maxScore = Number(si.maxScore);
    const price = extractedInfo?.quotePrice;

    if (price == null || allPrices.length === 0) {
      return {
        scoreItemId: si.id,
        category: si.category,
        name: si.name,
        score: 0,
        maxScore,
        reason: '报价数据不足，无法公式计算',
        confidence: 0,
      };
    }

    const benchmark =
      allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
    const deviation = (price - benchmark) / benchmark; // 偏离率
    // 偏离 ±0% 满分，偏离越大扣分（每 1% 扣 2 分比例，封顶 maxScore）
    const ratio = Math.max(0, 1 - Math.abs(deviation) * 2);
    const score = Math.round(maxScore * ratio * 10) / 10;

    return {
      scoreItemId: si.id,
      category: si.category,
      name: si.name,
      score,
      maxScore,
      reason: `报价 ${price}，基准价 ${benchmark.toFixed(2)}，偏离 ${(deviation * 100).toFixed(1)}%`,
      evidence: '公式计算（基准价法）',
      confidence: 0.9,
    };
  }

  /** 合并 per-item 结果 + 按 category 聚合（供雷达图）+ 总分 */
  private mergeAndAggregate(
    items: AiScoreItem[],
    overallComment: string,
  ): ItemScoreResult {
    const categoryTotals: Record<string, { score: number; max: number }> = {};
    let totalScore = 0;
    let totalMax = 0;

    for (const item of items) {
      const cat = item.category;
      if (!categoryTotals[cat]) categoryTotals[cat] = { score: 0, max: 0 };
      categoryTotals[cat].score = Math.round((categoryTotals[cat].score + item.score) * 10) / 10;
      categoryTotals[cat].max += item.maxScore;
      totalScore += item.score;
      totalMax += item.maxScore;
    }
    totalScore = Math.round(totalScore * 10) / 10;

    return {
      scoreItems: items,
      categoryTotals,
      totalScore,
      overallComment: overallComment || `总分 ${totalScore.toFixed(1)}/${totalMax}`,
    };
  }
}
