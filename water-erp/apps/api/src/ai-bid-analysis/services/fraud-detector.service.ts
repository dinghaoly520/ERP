// apps/api/src/ai-bid-analysis/services/fraud-detector.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { calculatePriceStatistics, detectPricePattern } from '../utils/price-statistics';
import { calculateComprehensiveSimilarity } from '../utils/text-similarity';
import type {
  FraudIndicators,
  FraudIndicator,
  BidderKeyInfo,
  FraudEvidenceItem,
  FraudInvolvedBidder,
  FraudReviewAction,
  FraudRuleCode,
} from '../types';

interface BidderData {
  id: string;
  name: string;
  keyInfo: BidderKeyInfo | null;
  text?: string;
}

interface IndicatorOptions {
  type: FraudIndicator['type'];
  ruleCode: FraudRuleCode;
  severity: FraudIndicator['severity'];
  confidence: number;
  description: string;
  evidence: string;
  evidenceItems: FraudEvidenceItem[];
  involvedBidders: FraudInvolvedBidder[];
  recommendation: string;
  reviewAction: FraudReviewAction;
  similarityScore?: number;
}

const MAX_TEXT_LENGTH = 20000;
const MAX_BIDDERS_FOR_SIMILARITY = 20;

/**
 * 报价离散度检测最少投标单位数。
 * 2-3 家投标时离散度低可能是正常的市场定价趋同，统计意义不足。
 */
const MIN_BIDDERS_FOR_DISPERSION = 3;

@Injectable()
export class FraudDetectorService {
  private readonly logger = new Logger(FraudDetectorService.name);

  async detect(bidders: BidderData[]): Promise<FraudIndicators> {
    this.logger.log(`Detecting fraud for ${bidders.length} bidders...`);
    const indicators: FraudIndicator[] = [];

    this.detectPriceDispersion(bidders, indicators);
    this.detectPricePatterns(bidders, indicators);
    this.detectPriceStructureSimilarity(bidders, indicators);
    this.detectContactOverlap(bidders, indicators);
    this.detectDocumentSimilarity(bidders, indicators);
    this.detectDocumentMetadataConsistency(bidders, indicators);

    const summary = this.generateSummary(indicators);

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (summary.highCount > 0) {
      riskLevel = 'high';
    } else if (summary.mediumCount >= 2) {
      riskLevel = 'medium';
    }

    return {
      riskLevel,
      indicators,
      overallAssessment: this.generateAssessment(riskLevel, indicators),
      summary,
    };
  }

  private detectPriceDispersion(bidders: BidderData[], indicators: FraudIndicator[]): void {
    const prices = bidders
      .filter(b => b.keyInfo?.quotePrice)
      .map(b => ({ id: b.id, name: b.name, price: b.keyInfo!.quotePrice }));

    if (prices.length < MIN_BIDDERS_FOR_DISPERSION) return;

    const stats = calculatePriceStatistics(prices.map(p => p.price));
    if (!stats) return;

    // 根据投标单位数量调整置信度：单位越少，置信度越低
    const countFactor = prices.length <= 3 ? 0.6 : prices.length <= 5 ? 0.8 : 1.0;

    if (stats.dispersionRate < 10) {
      indicators.push(
        this.createIndicator({
          type: 'price_concentration',
          ruleCode: 'PRICE_CONCENTRATION_HIGH',
          severity: 'high',
          confidence: Math.round(0.85 * countFactor * 100) / 100,
          description: `报价离散度过低（${stats.dispersionRate.toFixed(2)}%），需关注`,
          evidence: `平均价: ${stats.mean.toFixed(2)}万元, 标准差: ${stats.stdDev.toFixed(2)}万元, 范围: ${stats.range.toFixed(2)}万元`,
          evidenceItems: [
            {
              type: 'price',
              label: '报价离散度',
              value: `${stats.dispersionRate.toFixed(2)}%`,
              bidders: prices.map(p => p.name),
              explanation: '多家投标人报价离散度低于参考阈值，建议核实报价依据',
            },
          ],
          involvedBidders: prices.map(({ id, name }) => ({ id, name })),
          recommendation: '建议进一步核实报价依据',
          reviewAction: 'verify_pricing_basis',
        }),
      );
    } else if (stats.dispersionRate < 20) {
      indicators.push(
        this.createIndicator({
          type: 'price_concentration',
          ruleCode: 'PRICE_CONCENTRATION_MEDIUM',
          severity: 'medium',
          confidence: Math.round(0.65 * countFactor * 100) / 100,
          description: `报价离散度较低（${stats.dispersionRate.toFixed(2)}%），需关注`,
          evidence: `平均价: ${stats.mean.toFixed(2)}万元, 标准差: ${stats.stdDev.toFixed(2)}万元`,
          evidenceItems: [
            {
              type: 'price',
              label: '报价离散度',
              value: `${stats.dispersionRate.toFixed(2)}%`,
              bidders: prices.map(p => p.name),
              explanation: '报价较为集中，建议结合成本测算资料复核定价依据',
            },
          ],
          involvedBidders: prices.map(({ id, name }) => ({ id, name })),
          recommendation: '建议核实各投标单位报价计算过程',
          reviewAction: 'verify_pricing_basis',
        }),
      );
    }
  }

  private detectPricePatterns(bidders: BidderData[], indicators: FraudIndicator[]): void {
    const prices = bidders
      .filter(b => b.keyInfo?.quotePrice)
      .map(b => ({ id: b.id, name: b.name, price: b.keyInfo!.quotePrice }));

    // detectPricePattern 内部已要求 >= 4 个报价，这里只做前置过滤
    if (prices.length < 4) return;

    const pattern = detectPricePattern(prices.map(p => p.price));
    if (pattern.hasPattern) {
      const patternLabel = pattern.patternType === 'arithmetic' ? '等差' : '等比';

      // 投标单位数量越少，规律性越可能是巧合，降低置信度和严重度
      const bidderCount = prices.length;
      const severity: FraudIndicator['severity'] = bidderCount >= 6 ? 'high' : 'medium';
      const confidence = bidderCount >= 6 ? 0.75 : bidderCount >= 5 ? 0.65 : 0.55;

      indicators.push(
        this.createIndicator({
          type: 'price_pattern',
          ruleCode: pattern.patternType === 'arithmetic' ? 'PRICE_PATTERN_ARITHMETIC' : 'PRICE_PATTERN_GEOMETRIC',
          severity,
          confidence,
          description: `报价存在${patternLabel}规律性`,
          evidence: `${pattern.details}，报价序列: ${prices.map(p => p.price.toFixed(2)).join(', ')}万元`,
          evidenceItems: [
            {
              type: 'price',
              label: `${patternLabel}报价序列`,
              value: prices.map(p => p.price.toFixed(2)).join(' / '),
              bidders: prices.map(p => p.name),
              explanation: pattern.details ?? '',
            },
          ],
          involvedBidders: prices.map(({ id, name }) => ({ id, name })),
          recommendation: '建议核实报价计算过程',
          reviewAction: 'verify_pricing_basis',
        }),
      );
    }
  }

  private detectContactOverlap(bidders: BidderData[], indicators: FraudIndicator[]): void {
    const phoneMap = new Map<string, FraudInvolvedBidder[]>();
    const emailMap = new Map<string, FraudInvolvedBidder[]>();
    const addressMap = new Map<string, FraudInvolvedBidder[]>();

    for (const bidder of bidders) {
      if (!bidder.keyInfo?.contactInfo) {
        continue;
      }

      const involvedBidder = { id: bidder.id, name: bidder.name };
      const { phone, email, address } = bidder.keyInfo.contactInfo;

      if (phone) {
        this.addContactValue(phoneMap, phone.replace(/[\s-]/g, ''), involvedBidder);
      }
      if (email) {
        this.addContactValue(emailMap, email.toLowerCase(), involvedBidder);
      }
      if (address) {
        this.addContactValue(addressMap, address.replace(/\s/g, ''), involvedBidder);
      }
    }

    this.appendContactIndicators(indicators, phoneMap, {
      ruleCode: 'CONTACT_PHONE_OVERLAP',
      label: '重复电话',
      descriptionPrefix: '多家投标单位使用相同电话',
      explanation: '不同投标人的联系电话归一化后完全一致',
    });
    this.appendContactIndicators(indicators, emailMap, {
      ruleCode: 'CONTACT_EMAIL_OVERLAP',
      label: '重复邮箱',
      descriptionPrefix: '多家投标单位使用相同邮箱',
      explanation: '不同投标人的电子邮箱归一化后完全一致',
    });
    this.appendContactIndicators(indicators, addressMap, {
      ruleCode: 'CONTACT_ADDRESS_OVERLAP',
      label: '重复地址',
      descriptionPrefix: '多家投标单位使用相同地址',
      explanation: '不同投标人的联系地址归一化后完全一致',
    });
  }

  private detectDocumentSimilarity(bidders: BidderData[], indicators: FraudIndicator[]): void {
    const biddersWithText = bidders
      .filter((b) => b.text && b.text.length > 100)
      .slice(0, MAX_BIDDERS_FOR_SIMILARITY)
      .map((bidder) => ({
        ...bidder,
        text: bidder.text!.slice(0, MAX_TEXT_LENGTH),
      }));

    for (let i = 0; i < biddersWithText.length; i++) {
      for (let j = i + 1; j < biddersWithText.length; j++) {
        const b1 = biddersWithText[i];
        const b2 = biddersWithText[j];
        const similarity = calculateComprehensiveSimilarity(b1.text, b2.text);

        if (similarity.overall > 0.7) {
          const severity: FraudIndicator['severity'] = similarity.overall > 0.9 ? 'high' : 'medium';
          indicators.push(
            this.createIndicator({
              type: 'document_similarity',
              ruleCode: severity === 'high' ? 'DOCUMENT_SIMILARITY_HIGH' : 'DOCUMENT_SIMILARITY_MEDIUM',
              severity,
              confidence: Number(similarity.overall.toFixed(2)),
              description: `投标文件相似度较高 (${(similarity.overall * 100).toFixed(1)}%)`,
              evidence: `${b1.name} 与 ${b2.name} 的投标文件存在较多相似内容（LCS相似度: ${(similarity.lcs * 100).toFixed(1)}%）`,
              evidenceItems: [
                {
                  type: 'text',
                  label: '文本综合相似度',
                  value: `${(similarity.overall * 100).toFixed(1)}%`,
                  bidders: [b1.name, b2.name],
                  explanation: '投标文件文本内容存在一定重合，建议比对原始文件来源',
                },
              ],
              involvedBidders: [
                { id: b1.id, name: b1.name },
                { id: b2.id, name: b2.name },
              ],
              similarityScore: similarity.overall,
              recommendation: '建议核实文件编制过程',
              reviewAction: 'compare_source_files',
            }),
          );
        }
      }
    }
  }

  private appendContactIndicators(
    indicators: FraudIndicator[],
    contactMap: Map<string, FraudInvolvedBidder[]>,
    config: {
      ruleCode: FraudRuleCode;
      label: string;
      descriptionPrefix: string;
      explanation: string;
    },
  ): void {
    for (const [value, involvedBidders] of contactMap) {
      if (involvedBidders.length < 2) {
        continue;
      }

      indicators.push(
        this.createIndicator({
          type: 'contact_overlap',
          ruleCode: config.ruleCode,
          severity: 'high',
          confidence: 0.95,
          description: `${config.descriptionPrefix}: ${value}`,
          evidence: `${config.label}: ${value}；涉及单位: ${involvedBidders.map(bidder => bidder.name).join(', ')}`,
          evidenceItems: [
            {
              type: 'contact',
              label: config.label,
              value,
              bidders: involvedBidders.map(bidder => bidder.name),
              explanation: config.explanation,
            },
          ],
          involvedBidders,
          recommendation: '建议核实投标单位独立性',
          reviewAction: 'verify_independence',
        }),
      );
    }
  }

  private addContactValue(
    contactMap: Map<string, FraudInvolvedBidder[]>,
    normalizedValue: string,
    bidder: FraudInvolvedBidder,
  ): void {
    contactMap.set(normalizedValue, [...(contactMap.get(normalizedValue) || []), bidder]);
  }

  private detectPriceStructureSimilarity(bidders: BidderData[], indicators: FraudIndicator[]): void {
    const biddersWithBreakdown = bidders
      .map((bidder) => ({
        id: bidder.id,
        name: bidder.name,
        price: bidder.keyInfo?.quotePrice,
        originalBreakdown: bidder.keyInfo?.priceBreakdown,
        breakdown: this.normalizeBreakdownVector(bidder.keyInfo?.priceBreakdown),
      }))
      .filter((bidder) => bidder.price && bidder.breakdown.length >= 3);

    for (let i = 0; i < biddersWithBreakdown.length; i++) {
      for (let j = i + 1; j < biddersWithBreakdown.length; j++) {
        const first = biddersWithBreakdown[i];
        const second = biddersWithBreakdown[j];
        const firstProvisional = this.toNumber((first.originalBreakdown as Record<string, unknown> | undefined)?.provisional);
        const secondProvisional = this.toNumber((second.originalBreakdown as Record<string, unknown> | undefined)?.provisional);
        if (firstProvisional !== null && secondProvisional !== null && firstProvisional === secondProvisional && firstProvisional > 0) {
          indicators.push(
            this.createIndicator({
              type: 'price_structure_similarity',
              ruleCode: 'PRICE_PROVISIONAL_SUM_MATCH',
              severity: 'low',
              confidence: 0.58,
              description: `${first.name} 与 ${second.name} 暂估价金额完全一致`,
              evidence: `暂估价均为 ${firstProvisional}`,
              evidenceItems: [
                {
                  type: 'price',
                  label: '暂估价一致',
                  value: String(firstProvisional),
                  bidders: [first.name, second.name],
                  explanation: '暂估价完全一致本身不构成异常，但可作为报价结构复核线索',
                },
              ],
              involvedBidders: [
                { id: first.id, name: first.name },
                { id: second.id, name: second.name },
              ],
              recommendation: '建议结合招标清单确认暂估价是否由采购文件统一给定',
              reviewAction: 'verify_pricing_basis',
            }),
          );
        }

        const similarity = this.calculateBreakdownSimilarity(first.breakdown, second.breakdown);
        if (similarity < 0.98) continue;

        indicators.push(
          this.createIndicator({
            type: 'price_structure_similarity',
            ruleCode: 'PRICE_STRUCTURE_SIMILARITY',
            severity: 'medium',
            confidence: 0.78,
            description: `${first.name} 与 ${second.name} 的报价分项结构高度相似`,
            evidence: `报价结构余弦相似度 ${(similarity * 100).toFixed(1)}%`,
            evidenceItems: [
              {
                type: 'price',
                label: '报价结构比例相似',
                value: `${(similarity * 100).toFixed(1)}%`,
                bidders: [first.name, second.name],
                explanation: '人工、材料、设备、管理费、利润等分项比例高度一致，建议核实报价编制独立性',
              },
            ],
            involvedBidders: [
              { id: first.id, name: first.name },
              { id: second.id, name: second.name },
            ],
            recommendation: '建议核实报价清单编制依据和分项测算过程',
            reviewAction: 'verify_pricing_basis',
          }),
        );
      }
    }
  }

  private normalizeBreakdownVector(breakdown: unknown): number[] {
    if (!breakdown || typeof breakdown !== 'object') return [];
    const keys = ['labor', 'material', 'equipment', 'management', 'profit', 'other', 'provisional', 'tax'];
    const values = keys
      .map((key) => this.toNumber((breakdown as Record<string, unknown>)[key]))
      .filter((value): value is number => value !== null && value > 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return [];
    return values.map((value) => value / total);
  }

  private calculateBreakdownSimilarity(first: number[], second: number[]): number {
    const length = Math.min(first.length, second.length);
    if (length < 3) return 0;
    let dot = 0;
    let firstNorm = 0;
    let secondNorm = 0;
    for (let index = 0; index < length; index++) {
      dot += first[index] * second[index];
      firstNorm += first[index] * first[index];
      secondNorm += second[index] * second[index];
    }
    if (firstNorm === 0 || secondNorm === 0) return 0;
    return dot / (Math.sqrt(firstNorm) * Math.sqrt(secondNorm));
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const numberValue = Number.parseFloat(match[0]);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private detectDocumentMetadataConsistency(bidders: BidderData[], indicators: FraudIndicator[]): void {
    const biddersWithMetadata = bidders
      .map((bidder) => ({
        id: bidder.id,
        name: bidder.name,
        metadata: bidder.keyInfo?.documentMetadata,
      }))
      .filter((bidder) => bidder.metadata && Object.keys(bidder.metadata).length > 0);

    for (let i = 0; i < biddersWithMetadata.length; i++) {
      for (let j = i + 1; j < biddersWithMetadata.length; j++) {
        const first = biddersWithMetadata[i];
        const second = biddersWithMetadata[j];
        const evidenceItems: FraudEvidenceItem[] = [];

        if (first.metadata?.author && first.metadata.author === second.metadata?.author) {
          evidenceItems.push({
            type: 'metadata',
            label: '作者一致',
            value: first.metadata.author,
            bidders: [first.name, second.name],
            explanation: '多家投标文件元数据作者字段完全一致',
          });
        }

        if (first.metadata?.creator && first.metadata.creator === second.metadata?.creator) {
          evidenceItems.push({
            type: 'metadata',
            label: '编制软件一致',
            value: first.metadata.creator,
            bidders: [first.name, second.name],
            explanation: '多家投标文件元数据创建软件字段完全一致',
          });
        }

        const createdGapMinutes = this.getMinuteGap(first.metadata?.createdAt, second.metadata?.createdAt);
        if (createdGapMinutes !== null && createdGapMinutes <= 30) {
          evidenceItems.push({
            type: 'metadata',
            label: '创建时间接近',
            value: `${createdGapMinutes}分钟`,
            bidders: [first.name, second.name],
            explanation: '多家投标文件创建时间间隔小于 30 分钟',
          });
        }

        if (evidenceItems.length < 2) continue;

        const confidence = evidenceItems.length >= 3 ? 0.72 : 0.62;
        indicators.push(
          this.createIndicator({
            type: 'metadata_consistency',
            ruleCode: 'DOCUMENT_METADATA_CONSISTENCY',
            severity: evidenceItems.length >= 3 ? 'medium' : 'low',
            confidence,
            description: `${first.name} 与 ${second.name} 的投标文件元数据存在异常一致性`,
            evidence: evidenceItems.map((item) => `${item.label}: ${item.value}`).join('；'),
            evidenceItems,
            involvedBidders: [
              { id: first.id, name: first.name },
              { id: second.id, name: second.name },
            ],
            recommendation: '建议比对原始文件属性、编制过程记录和文件来源',
            reviewAction: 'compare_source_files',
          }),
        );
      }
    }
  }

  private getMinuteGap(firstDate?: string, secondDate?: string): number | null {
    if (!firstDate || !secondDate) return null;
    const firstTime = new Date(firstDate).getTime();
    const secondTime = new Date(secondDate).getTime();
    if (Number.isNaN(firstTime) || Number.isNaN(secondTime)) return null;
    return Math.round(Math.abs(firstTime - secondTime) / 60000);
  }

  private createIndicator(options: IndicatorOptions): FraudIndicator {
    return {
      type: options.type,
      ruleCode: options.ruleCode,
      severity: options.severity,
      confidence: options.confidence,
      description: options.description,
      evidence: options.evidence,
      evidenceItems: options.evidenceItems,
      affectedBidders: options.involvedBidders.map(bidder => bidder.name),
      involvedBidders: options.involvedBidders,
      similarityScore: options.similarityScore,
      recommendation: options.recommendation,
      reviewAction: options.reviewAction,
    };
  }

  private generateSummary(indicators: FraudIndicator[]): FraudIndicators['summary'] {
    const highCount = indicators.filter(i => i.severity === 'high').length;
    const mediumCount = indicators.filter(i => i.severity === 'medium').length;
    const lowCount = indicators.filter(i => i.severity === 'low').length;

    return {
      highCount,
      mediumCount,
      lowCount,
      totalCount: indicators.length,
    };
  }

  private generateAssessment(riskLevel: string, indicators: FraudIndicator[]): string {
    if (riskLevel === 'low') {
      return '当前未识别到结构化异常线索，建议结合人工复核确认。';
    }

    const highRisk = indicators.filter(i => i.severity === 'high');
    const mediumRisk = indicators.filter(i => i.severity === 'medium');

    let assessment = '';
    if (highRisk.length > 0) {
      assessment += `发现 ${highRisk.length} 项需重点关注：${highRisk.map(i => i.description).join('；')}。`;
    }
    if (mediumRisk.length > 0) {
      assessment += `发现 ${mediumRisk.length} 项需进一步核实：${mediumRisk.map(i => i.description).join('；')}。`;
    }
    assessment += '上述情况需进一步复核与确认。';

    return assessment;
  }
}
