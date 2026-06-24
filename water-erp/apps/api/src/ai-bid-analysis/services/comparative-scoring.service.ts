// apps/api/src/ai-bid-analysis/services/comparative-scoring.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../local-ai/llm.service';
import { COMPARATIVE_SCORING_PROMPT } from '../prompts/comparative-scoring.prompt';
import { deterministicSeed } from '../utils';

interface BidderSummary {
  id: string;
  name: string;
  quotePrice: number;
  qualificationLevel: string;
  performanceCount: number;
  keyPerformances: Array<{ projectName: string; contractAmount: string; keyMetrics: string }>;
  teamSummary: string;
  equipmentSummary: string;
  methodologySummary: string;
  serviceCommitment: string;
  warranty: string;
  firstRoundScores: {
    technical: number;
    commercial: number;
    price: number;
    total: number;
  };
}

interface ComparativeScoreItem {
  bidderName: string;
  technical: {
    totalScore: number;
    breakdown: Record<string, { score: number; maxScore: number; reason: string }>;
  };
  commercial: {
    totalScore: number;
    breakdown: Record<string, { score: number; maxScore: number; reason: string }>;
  };
  price: {
    totalScore: number;
    maxScore: number;
    reason: string;
  };
}

@Injectable()
export class ComparativeScoringService {
  private readonly logger = new Logger(ComparativeScoringService.name);

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
  ) {}

  async score(taskId: string): Promise<void> {
    const bidders = await this.prisma.aiBidderResult.findMany({
      where: { taskId, status: 'COMPLETED' },
      select: {
        id: true,
        keyInfo: true,
        extractedInfo: true,
        categoryTotals: true,
        totalScore: true,
        bidSupplier: { select: { supplierName: true } },
      },
    });

    if (bidders.length < 2) {
      this.logger.log(`Task ${taskId}: only ${bidders.length} completed bidder, skip comparative scoring`);
      return;
    }

    const summaries = bidders.map(b => this.buildSummary(b as any));

    this.logger.log(`Task ${taskId}: running comparative scoring for ${bidders.length} bidders`);

    const biddersData = summaries.map(s => this.formatBidderSummary(s)).join('\n');
    const prompt = COMPARATIVE_SCORING_PROMPT.replace('{{BIDDERS_DATA}}', biddersData);

    let result: { scores: ComparativeScoreItem[] };
    try {
      result = await this.llmService.chatJson<{ scores: ComparativeScoreItem[] }>(
        '你是一名资深招投标评审专家，擅长对比多家投标单位进行公正评分。',
        prompt,
        0,
        undefined,
        deterministicSeed(taskId + ':comparative'),
      );
    } catch (err) {
      this.logger.warn(`Task ${taskId}: comparative scoring LLM call failed: ${String(err).slice(0, 200)}`);
      return;
    }

    if (!Array.isArray(result.scores)) {
      this.logger.warn(`Task ${taskId}: comparative scoring returned invalid format`);
      return;
    }

    for (const item of result.scores) {
      const bidder = bidders.find((b) => b.bidSupplier.supplierName === item.bidderName);
      if (!bidder) {
        this.logger.warn(`Task ${taskId}: comparative scoring references unknown bidder "${item.bidderName}"`);
        continue;
      }

      const oldScores = (bidder.categoryTotals ?? null) as Record<string, any> | null;
      const oldTechnical = Number(oldScores?.technical?.totalScore ?? 0);
      const oldCommercial = Number(oldScores?.commercial?.totalScore ?? 0);
      const oldPrice = Number(oldScores?.price?.totalScore ?? 0);
      const oldTotal = Number(bidder.totalScore ?? 0);

      const newTechnical = this.clamp(item.technical?.totalScore, 0, 50);
      const newCommercial = this.clamp(item.commercial?.totalScore, 0, 30);
      const newPrice = this.clamp(item.price?.totalScore, 0, 20);
      const newTotal = Math.round((newTechnical + newCommercial + newPrice) * 10) / 10;

      // Merge comparative scores into existing scores (preserve breakdown details)
      const mergedScores = { ...(oldScores || {}) };

      if (mergedScores.technical && item.technical?.breakdown) {
        mergedScores.technical = {
          ...mergedScores.technical,
          totalScore: newTechnical,
          breakdown: {
            ...mergedScores.technical.breakdown,
            ...Object.fromEntries(
              Object.entries(item.technical.breakdown).map(([key, val]) => [
                key,
                { ...(mergedScores.technical.breakdown?.[key] || {}), score: val.score, reason: val.reason },
              ]),
            ),
          },
        };
      } else if (item.technical) {
        mergedScores.technical = { totalScore: newTechnical, maxScore: 50, breakdown: item.technical.breakdown };
      }

      if (mergedScores.commercial && item.commercial?.breakdown) {
        mergedScores.commercial = {
          ...mergedScores.commercial,
          totalScore: newCommercial,
          breakdown: {
            ...mergedScores.commercial.breakdown,
            ...Object.fromEntries(
              Object.entries(item.commercial.breakdown).map(([key, val]) => [
                key,
                { ...(mergedScores.commercial.breakdown?.[key] || {}), score: val.score, reason: val.reason },
              ]),
            ),
          },
        };
      } else if (item.commercial) {
        mergedScores.commercial = { totalScore: newCommercial, maxScore: 30, breakdown: item.commercial.breakdown };
      }

      if (mergedScores.price) {
        mergedScores.price = { ...mergedScores.price, totalScore: newPrice };
      } else if (item.price) {
        mergedScores.price = { totalScore: newPrice, maxScore: 20 };
      }

      await this.prisma.aiBidderResult.update({
        where: { id: bidder.id },
        data: {
          categoryTotals: mergedScores as any,
          totalScore: newTotal,
        },
      });

      this.logger.log(
        `  ${bidder.bidSupplier.supplierName}: ${oldTechnical}+${oldCommercial}+${oldPrice}=${oldTotal} → ${newTechnical}+${newCommercial}+${newPrice}=${newTotal}`,
      );
    }
  }

  private buildSummary(bidder: any): BidderSummary {
    const keyInfo = bidder.keyInfo || {};
    const extractedInfo = bidder.extractedInfo || {};
    const scores = bidder.scores || {};

    const team = extractedInfo.team || {};
    const techProposal = extractedInfo.technicalProposal || {};
    const commercial = extractedInfo.commercial || {};

    const pm = team.projectManager || {};
    const teamSummary = `项目经理：${pm.name || '未知'}（${pm.title || '未知职称'}，${pm.qualification || '未知资格'}），团队${team.totalPersonnel || '未知'}人`;
    const equipmentSummary = Array.isArray(techProposal.equipment)
      ? techProposal.equipment.map((e: any) => `${e.name || ''}(${e.model || ''}×${e.quantity || ''})`).join('、') || '未提供'
      : '未提供';
    const methodologySummary = typeof techProposal.methodology === 'string'
      ? techProposal.methodology
      : '未提供';

    return {
      id: bidder.id,
      name: bidder.name,
      quotePrice: Number(keyInfo.quotePrice) || 0,
      qualificationLevel: keyInfo.qualificationLevel || '未知',
      performanceCount: Number(keyInfo.performanceCount) || 0,
      keyPerformances: Array.isArray(keyInfo.keyPerformances) ? keyInfo.keyPerformances : [],
      teamSummary,
      equipmentSummary,
      methodologySummary,
      serviceCommitment: commercial.serviceCommitment || '未提供',
      warranty: commercial.warranty || keyInfo.warrantyPeriod || '未提供',
      firstRoundScores: {
        technical: Number(scores.technical?.totalScore ?? 0),
        commercial: Number(scores.commercial?.totalScore ?? 0),
        price: Number(scores.price?.totalScore ?? 0),
        total: Number(bidder.totalScore ?? 0),
      },
    };
  }

  private formatBidderSummary(s: BidderSummary): string {
    const performances = s.keyPerformances.length > 0
      ? s.keyPerformances.map(p => `  - ${p.projectName}（${p.contractAmount}，${p.keyMetrics || '无指标'}）`).join('\n')
      : '  无业绩数据';

    return `【${s.name}】
- 报价：${s.quotePrice}万元
- 资质等级：${s.qualificationLevel}
- 业绩数量：${s.performanceCount}个
- 主要业绩：
${performances}
- 团队：${s.teamSummary}
- 设备：${s.equipmentSummary}
- 技术方案：${s.methodologySummary}
- 服务承诺：${s.serviceCommitment}
- 质保：${s.warranty}
- 首轮评分：技术${s.firstRoundScores.technical}/商务${s.firstRoundScores.commercial}/报价${s.firstRoundScores.price}，总分${s.firstRoundScores.total}`;
  }

  private clamp(v: number | undefined, min: number, max: number): number {
    if (v == null) return min;
    return Math.round(Math.min(max, Math.max(min, v)) * 10) / 10;
  }
}
