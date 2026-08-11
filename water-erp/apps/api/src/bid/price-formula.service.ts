import { Injectable, Logger } from '@nestjs/common';

/**
 * P1: 价格分公式引擎 — 三种内置公式,替代专家手填价格分。
 * 公式进入权威路径(generateEvaluationResults),非建议。
 */

export type PriceFormulaType = 'lowest_price' | 'benchmark_deviation' | 'ratio';

export interface PriceFormulaConfig {
  formulaType: PriceFormulaType;
  /** 基准价偏离法的折扣系数 K(benchmark = ceilingPrice × K),默认 0.97 */
  K?: number;
  /** 每 1% 偏离扣分比例(基准价偏离法),默认 2(即每 1% 偏离扣 2% 满分) */
  penaltyRate?: number;
  /** 无惩罚区间百分比(如 ±5% 内不扣分),默认 0 */
  noPenaltyRange?: number;
}

export interface PriceFormulaOption {
  value: PriceFormulaType;
  label: string;
  description: string;
  requiredParams: string[];
}

/** 供前端下拉渲染 */
export const PRICE_FORMULA_OPTIONS: PriceFormulaOption[] = [
  {
    value: 'lowest_price',
    label: '最低评标价法',
    description: '最低有效报价 = 满分,其余按最低报价 ÷ 该报价 × 满分折算',
    requiredParams: [],
  },
  {
    value: 'benchmark_deviation',
    label: '基准价偏离法',
    description: '基准价 = 控制价 × K,双向偏离线性扣分(防高价也防恶意低价)',
    requiredParams: ['K', 'penaltyRate'],
  },
  {
    value: 'ratio',
    label: '比例法',
    description: '控制价 ÷ 报价 × 满分,报价越低分越高(不惩罚异常低价)',
    requiredParams: [],
  },
];

@Injectable()
export class PriceFormulaService {
  private readonly logger = new Logger(PriceFormulaService.name);

  /**
   * 按公式计算各供应商的价格分。
   * @param config 公式配置
   * @param bidPrices supplierId → 报价(已解封,来自 BidOpeningRecord)
   * @param ceilingPrice 最高限价(可能为 null)
   * @param maxScore 价格类评分项满分合计
   * @returns supplierId → 价格分
   */
  calculate(
    config: PriceFormulaConfig,
    bidPrices: Map<string, number>,
    ceilingPrice: number | null,
    maxScore: number,
  ): Map<string, number> {
    const result = new Map<string, number>();
    const prices = [...bidPrices.values()].filter(p => p != null && p > 0);

    if (prices.length === 0 || maxScore <= 0) {
      this.logger.warn('价格分公式: 无有效报价或满分 ≤ 0,跳过计算');
      return result;
    }

    const minPrice = Math.min(...prices);

    for (const [supplierId, bidPrice] of bidPrices) {
      if (bidPrice == null || bidPrice <= 0) {
        result.set(supplierId, 0);
        continue;
      }

      let score: number;
      switch (config.formulaType) {
        case 'lowest_price':
          score = this.calcLowestPrice(bidPrice, minPrice, maxScore);
          break;
        case 'benchmark_deviation':
          score = this.calcBenchmarkDeviation(
            bidPrice, ceilingPrice, config.K ?? 0.97,
            config.penaltyRate ?? 2, config.noPenaltyRange ?? 0, maxScore,
          );
          break;
        case 'ratio':
          score = this.calcRatio(bidPrice, ceilingPrice, maxScore);
          break;
        default:
          this.logger.warn(`未知公式类型: ${config.formulaType},回退最低评标价法`);
          score = this.calcLowestPrice(bidPrice, minPrice, maxScore);
      }
      result.set(supplierId, Math.min(Math.round(score * 10) / 10, maxScore)); // 保留 1 位小数，封顶 maxScore
    }

    return result;
  }

  /** 最低评标价法:最低报价满分,其余按比例折算 */
  private calcLowestPrice(bidPrice: number, minPrice: number, maxScore: number): number {
    if (minPrice <= 0) return 0;
    return (minPrice / bidPrice) * maxScore;
  }

  /** 基准价偏离法:benchmark = ceiling × K,双向偏离扣分 */
  private calcBenchmarkDeviation(
    bidPrice: number,
    ceilingPrice: number | null,
    K: number,
    penaltyRate: number,
    noPenaltyRange: number,
    maxScore: number,
  ): number {
    if (!ceilingPrice || ceilingPrice <= 0) {
      // 无控制价时无法计算基准价偏离——返回 0 并告警（非满分，避免静默失效）
      this.logger.warn('benchmark_deviation 公式缺少 ceilingPrice，价格分置 0');
      return 0;
    }
    const benchmark = ceilingPrice * K;
    const deviation = Math.abs(bidPrice - benchmark) / benchmark; // 偏离率
    // 无惩罚区间内不扣分
    if (noPenaltyRange > 0 && deviation * 100 <= noPenaltyRange) {
      return maxScore;
    }
    // 每偏离 1% 扣 penaltyRate% 满分;deduction 为扣分比例(如偏离 10% × penaltyRate 2 = 扣 20%)
    const deduction = (deviation * 100 - noPenaltyRange) * (penaltyRate / 100);
    return Math.max(0, maxScore * (1 - deduction));
  }

  /** 比例法:控制价 ÷ 报价 × 满分(报价越低越高,不惩罚异常低价) */
  private calcRatio(bidPrice: number, ceilingPrice: number | null, maxScore: number): number {
    if (!ceilingPrice || ceilingPrice <= 0 || bidPrice <= 0) return 0;
    return (ceilingPrice / bidPrice) * maxScore;
  }

  /** 获取超限价的供应商列表 */
  getOverCeilingSuppliers(
    bidPrices: Map<string, number>,
    ceilingPrice: number | null,
  ): string[] {
    if (!ceilingPrice) return [];
    const over: string[] = [];
    for (const [supplierId, price] of bidPrices) {
      if (price != null && price > ceilingPrice) over.push(supplierId);
    }
    return over;
  }
}
