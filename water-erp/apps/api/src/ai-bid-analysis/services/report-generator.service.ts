// apps/api/src/ai-bid-analysis/services/report-generator.service.ts
import { Injectable, Logger } from '@nestjs/common';
import type { AiBidAnalysisTask, AiBidder, AiBidReport } from '@prisma/client';
import type { FraudIndicators, BidderKeyInfo } from '../types';

@Injectable()
export class ReportGeneratorService {
  private readonly logger = new Logger(ReportGeneratorService.name);

  async generate(
    task: AiBidAnalysisTask,
    bidders: AiBidder[],
    fraudIndicators: FraudIndicators | null,
  ): Promise<Partial<AiBidReport>> {
    this.logger.log('Generating report...');

    // 1. 分析概述
    const summary = this.generateSummary(task, bidders);

    // 2. 评分排名
    const ranking = this.generateRanking(bidders);

    // 3. 关键信息对比
    const keyInfoComparison = this.generateKeyInfoComparison(bidders);

    // 4. 报价分析
    const priceAnalysis = this.generatePriceAnalysis(bidders);

    // 5. 正向依据与需关注事项
    const strengthsWeaknesses = this.generateStrengthsWeaknesses(bidders);

    // 6. 风险统计
    const riskStats = this.generateRiskStats(bidders, fraudIndicators);

    // 7. 综合结论
    const conclusion = this.generateConclusion(task, bidders, fraudIndicators);

    return {
      summary,
      ranking,
      keyInfoComparison,
      priceAnalysis,
      strengthsWeaknesses,
      riskStats,
      fraudIndicators: fraudIndicators ? JSON.parse(JSON.stringify(fraudIndicators)) : null,
      conclusion,
      generatedAt: new Date(),
    };
  }

  private generateSummary(task: AiBidAnalysisTask, bidders: AiBidder[]) {
    const completed = bidders.filter(b => b.status === 'COMPLETED');
    return {
      taskName: task.name,
      projectName: task.projectName,
      tenderFileName: task.tenderFileName,
      totalBidders: bidders.length,
      completedBidders: completed.length,
      analysisDate: new Date().toISOString(),
      scoringMethod: '综合评分法（技术50分 + 商务30分 + 报价20分）',
    };
  }

  private generateRanking(bidders: AiBidder[]) {
    const completed = bidders
      .filter(b => b.status === 'COMPLETED' && b.totalScore !== null)
      .sort((a, b) => Number(b.totalScore) - Number(a.totalScore));

    return completed.map((b, index) => ({
      rank: index + 1,
      bidderId: b.id,
      bidderName: b.name,
      totalScore: Number(b.totalScore).toFixed(2),
      technicalScore: b.scores ? (b.scores as any).technical?.totalScore : null,
      commercialScore: b.scores ? (b.scores as any).commercial?.totalScore : null,
      priceScore: b.scores ? (b.scores as any).price?.totalScore : null,
      qualificationStatus: b.qualificationStatus,
      riskLevel: b.riskLevel,
    }));
  }

  private generateKeyInfoComparison(bidders: AiBidder[]) {
    return bidders
      .filter(b => b.keyInfo)
      .map(b => {
        const keyInfo = b.keyInfo as unknown as BidderKeyInfo;
        return {
          bidderId: b.id,
          bidderName: b.name,
          quotePrice: keyInfo.quotePrice,
          quotePriceYuan: keyInfo.quotePriceYuan,
          legalPerson: keyInfo.legalPerson,
          registeredCapital: keyInfo.registeredCapital,
          qualificationLevel: keyInfo.qualificationLevel,
          qualificationName: keyInfo.qualificationName,
          performanceCount: keyInfo.performanceCount,
          projectManager: keyInfo.projectManager,
          constructionPeriod: keyInfo.constructionPeriod,
          warrantyPeriod: keyInfo.warrantyPeriod,
        };
      });
  }

  private generatePriceAnalysis(bidders: AiBidder[]) {
    const prices = bidders
      .filter(b => b.keyInfo)
      .map(b => ({
        bidderId: b.id,
        bidderName: b.name,
        price: (b.keyInfo as unknown as BidderKeyInfo).quotePrice,
      }))
      .filter(p => p.price !== null && p.price !== undefined);

    if (prices.length === 0) return null;

    const priceValues = prices.map(p => p.price);
    const sum = priceValues.reduce((a, b) => a + b, 0);
    const avg = sum / priceValues.length;
    const sorted = [...priceValues].sort((a, b) => a - b);

    return {
      lowest: prices.find(p => p.price === sorted[0]),
      highest: prices.find(p => p.price === sorted[sorted.length - 1]),
      average: avg.toFixed(2),
      median: sorted[Math.floor(sorted.length / 2)].toFixed(2),
      range: (sorted[sorted.length - 1] - sorted[0]).toFixed(2),
      dispersionRate: ((Math.sqrt(priceValues.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / priceValues.length) / avg) * 100).toFixed(2),
    };
  }

  private generateStrengthsWeaknesses(bidders: AiBidder[]) {
    return bidders
      .filter(b => b.status === 'COMPLETED')
      .map(b => ({
        bidderId: b.id,
        bidderName: b.name,
        strengths: b.strengths || [],
        weaknesses: b.weaknesses || [],
        overallComment: b.overallComment,
        competitiveAnalysis: b.competitiveAnalysis,
      }));
  }

  private generateRiskStats(bidders: AiBidder[], fraudIndicators: FraudIndicators | null) {
    const riskLevels = bidders.map(b => b.riskLevel || 'low');
    return {
      lowCount: riskLevels.filter(r => r === 'low').length,
      mediumCount: riskLevels.filter(r => r === 'medium').length,
      highCount: riskLevels.filter(r => r === 'high').length,
      fraudRiskLevel: fraudIndicators?.riskLevel || 'low',
      fraudIndicatorCount: fraudIndicators?.indicators?.length || 0,
    };
  }

  private generateConclusion(
    task: AiBidAnalysisTask,
    bidders: AiBidder[],
    fraudIndicators: FraudIndicators | null,
  ): string {
    const completed = bidders.filter(b => b.status === 'COMPLETED');
    if (completed.length === 0) {
      return '暂无完成分析的投标单位，无法生成综合结论。';
    }

    const sorted = [...completed].sort((a, b) => Number(b.totalScore) - Number(a.totalScore));
    const top = sorted[0];

    let conclusion = `本次分析共 ${completed.length} 家投标单位。`;
    conclusion += `综合评分最高的是 ${top.name}，得分 ${Number(top.totalScore).toFixed(1)} 分`;

    if (sorted.length > 1) {
      const second = sorted[1];
      conclusion += `，高于第二名 ${second.name} ${(Number(top.totalScore) - Number(second.totalScore)).toFixed(1)} 分`;
    }
    conclusion += '。';

    // 添加风险提示
    if (fraudIndicators && fraudIndicators.riskLevel !== 'low') {
      const highRisk = fraudIndicators.indicators.filter(i => i.severity === 'high');
      if (highRisk.length > 0) {
        conclusion += `\n\n风险提示：检测到 ${highRisk.length} 个高风险指标，${highRisk[0].description}。建议进一步调查核实。`;
      }
    }

    const qualificationPassed = top.qualificationStatus === '通过' || top.qualificationStatus === 'qualified';
    if (qualificationPassed && top.riskLevel === 'low') {
      conclusion += `\n\n排序说明：${top.name} 当前综合评分最高，资格状态为通过，风险等级为低。该结果为系统辅助分析，不构成中标建议，需结合评审委员会复核结果确定。`;
    } else if (!qualificationPassed) {
      conclusion += `\n\n复核提示：${top.name} 当前资格状态为${top.qualificationStatus || '待审查'}，需核实资格材料后再进行后续评审判断。`;
    }

    return conclusion;
  }
}