// apps/api/src/ai-bid-analysis/services/comparative-scoring.service.ts
// ★ per-item 横向重写（Phase 2.4）：第二轮 LLM 横向对比多家 bidderResult
//   读 categoryTotals（5 维 {CATEGORY:{score,max}}，非 procurement breakdown）
//   LLM 校准各维度公平性 → update categoryTotals + totalScore
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../local-ai/llm.service';
import { COMPARATIVE_SCORING_PROMPT } from '../prompts/comparative-scoring.prompt';
import { deterministicSeed } from '../utils';

/** categoryTotals 结构（per-item 5 维聚合） */
type CategoryTotals = Record<string, { score: number; max: number }>;

/** LLM 横向返回的单家校准项（按 category 给新分） */
interface ComparativeAdjust {
  bidderName: string;
  technical?: number;
  commercial?: number;
  price?: number;
  reason?: string;
}

@Injectable()
export class ComparativeScoringService {
  private readonly logger = new Logger(ComparativeScoringService.name);

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
  ) {}

  /** 第二轮横向评分：所有 bidderResult COMPLETED 后调用 */
  async score(taskId: string): Promise<void> {
    const bidders = await this.prisma.aiBidderResult.findMany({
      where: { taskId, status: 'COMPLETED' },
      select: {
        id: true,
        keyInfo: true,
        categoryTotals: true,
        totalScore: true,
        bidSupplier: { select: { supplierName: true } },
      },
    });

    if (bidders.length < 2) {
      this.logger.log(
        `Task ${taskId}: only ${bidders.length} completed bidder, skip comparative scoring`,
      );
      return;
    }

    // 构建横向对比摘要（首轮 categoryTotals + 关键信息）
    const summaries = bidders.map((b) => this.buildSummary(b));
    const biddersData = summaries.map((s) => this.formatSummary(s)).join('\n');
    const prompt = COMPARATIVE_SCORING_PROMPT.replace('{{BIDDERS_DATA}}', biddersData);

    this.logger.log(
      `Task ${taskId}: running per-item comparative scoring for ${bidders.length} bidders`,
    );

    let result: { scores: ComparativeAdjust[] };
    try {
      result = await this.llmService.chatJson<{ scores: ComparativeAdjust[] }>(
        '你是一名资深招投标评审专家，基于各家横向对比，对技术/商务/报价三个维度做公平性校准。',
        prompt,
        0,
        undefined,
        deterministicSeed(`${taskId}:comparative`),
      );
    } catch (err) {
      this.logger.warn(
        `Task ${taskId}: comparative scoring LLM failed: ${String(err).slice(0, 200)}`,
      );
      return;
    }

    if (!Array.isArray(result.scores)) {
      this.logger.warn(`Task ${taskId}: comparative scoring invalid format`);
      return;
    }

    for (const adj of result.scores) {
      const bidder = bidders.find(
        (b) => b.bidSupplier.supplierName === adj.bidderName,
      );
      if (!bidder) {
        this.logger.warn(
          `Task ${taskId}: comparative references unknown bidder "${adj.bidderName}"`,
        );
        continue;
      }

      const totals = (bidder.categoryTotals ?? {}) as CategoryTotals;
      const oldTotal = Number(bidder.totalScore ?? 0);

      // 校准各维度（clamp 到 max 内），保留 max 不变
      const newTotals: CategoryTotals = { ...totals };
      if (adj.technical != null && totals.TECHNICAL) {
        newTotals.TECHNICAL = {
          score: this.clamp(adj.technical, 0, totals.TECHNICAL.max),
          max: totals.TECHNICAL.max,
        };
      }
      if (adj.commercial != null && totals.COMMERCIAL) {
        newTotals.COMMERCIAL = {
          score: this.clamp(adj.commercial, 0, totals.COMMERCIAL.max),
          max: totals.COMMERCIAL.max,
        };
      }
      if (adj.price != null && totals.PRICE) {
        newTotals.PRICE = {
          score: this.clamp(adj.price, 0, totals.PRICE.max),
          max: totals.PRICE.max,
        };
      }

      // 重算总分（所有维度 score 之和）
      const newTotal =
        Math.round(
          Object.values(newTotals).reduce((a, c) => a + (c?.score ?? 0), 0) * 10,
        ) / 10;

      await this.prisma.aiBidderResult.update({
        where: { id: bidder.id },
        data: {
          categoryTotals: newTotals as any,
          totalScore: newTotal,
          competitiveAnalysis: {
            comparativeScore: newTotal,
            previousScore: oldTotal,
            reason: adj.reason ?? '横向校准',
          } as any,
        },
      });

      this.logger.log(
        `  ${bidder.bidSupplier.supplierName}: ${oldTotal} → ${newTotal}（横向校准）`,
      );
    }
  }

  /** 构建 per-item 摘要：categoryTotals（5 维）+ keyInfo */
  private buildSummary(bidder: {
    id: string;
    keyInfo: any;
    categoryTotals: any;
    totalScore: any;
    bidSupplier: { supplierName: string };
  }) {
    const keyInfo = bidder.keyInfo || {};
    const totals = (bidder.categoryTotals ?? {}) as CategoryTotals;
    const get = (cat: string) => totals[cat]?.score ?? 0;

    return {
      id: bidder.id,
      name: bidder.bidSupplier.supplierName,
      quotePrice: Number(keyInfo.quotePrice) || 0,
      qualificationLevel: keyInfo.qualificationLevel || '未知',
      performanceCount: Number(keyInfo.performanceCount) || 0,
      firstRound: {
        technical: get('TECHNICAL'),
        commercial: get('COMMERCIAL'),
        price: get('PRICE'),
        qualification: get('QUALIFICATION'),
        responsive: get('RESPONSIVE'),
        total: Number(bidder.totalScore ?? 0),
      },
    };
  }

  private formatSummary(s: ReturnType<ComparativeScoringService['buildSummary']>): string {
    return `【${s.name}】
- 报价：${s.quotePrice}万元
- 资质等级：${s.qualificationLevel}
- 业绩数量：${s.performanceCount}个
- 首轮评分：技术${s.firstRound.technical} / 商务${s.firstRound.commercial} / 报价${s.firstRound.price}，总分${s.firstRound.total}`;
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.round(Math.min(max, Math.max(min, v)) * 10) / 10;
  }
}
