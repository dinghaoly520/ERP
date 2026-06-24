// apps/api/src/ai-bid-analysis/utils/price-statistics.ts
export interface PriceStatistics {
  mean: number;
  variance: number;
  stdDev: number;
  dispersionRate: number;
  min: number;
  max: number;
  range: number;
}

/**
 * 计算报价统计指标（均值、方差、标准差、离散度）
 *
 * 注意：使用总体方差（除以 n），因为投标报价本身就是完整数据集而非抽样样本。
 */
export function calculatePriceStatistics(prices: number[]): PriceStatistics | null {
  if (prices.length < 2) return null;

  const n = prices.length;
  const sum = prices.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const dispersionRate = mean > 0 ? (stdDev / mean) * 100 : 0;

  return {
    mean,
    variance,
    stdDev,
    dispersionRate,
    min: Math.min(...prices),
    max: Math.max(...prices),
    range: Math.max(...prices) - Math.min(...prices),
  };
}

export interface PricePattern {
  hasPattern: boolean;
  patternType: 'arithmetic' | 'geometric' | 'none';
  details?: string;
}

/**
 * 检测报价是否存在等差/等比数列规律
 *
 * 核心防护措施：
 * 1. 最少需要 4 个报价点（3 个步长间隔），3 个点的"规律"统计意义不足
 * 2. 使用相对容差（步长差异占平均步长的比例），而非绝对容差 0.01
 * 3. 要求步长相对于均值的占比不低于 MIN_RELATIVE_STEP，过滤掉微小波动的误判
 * 4. 完美匹配时才标为规律（相对容差控制在 1% 以内）
 */
export function detectPricePattern(prices: number[]): PricePattern {
  // 至少需要 4 个报价（3 个步长间隔）才有统计意义
  if (prices.length < 4) return { hasPattern: false, patternType: 'none' };

  const sorted = [...prices].sort((a, b) => a - b);

  // 所有相邻差值
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    diffs.push(sorted[i] - sorted[i - 1]);
  }

  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;

  // 步长相对于均值的占比太低（< 0.5%），说明价格几乎相同，所谓的"规律"只是噪声
  const MIN_RELATIVE_STEP = 0.005;
  if (mean > 0 && avgDiff / mean < MIN_RELATIVE_STEP) {
    return { hasPattern: false, patternType: 'none' };
  }

  // 相对容差：步长差异占平均步长的比例不超过 1%
  const RELATIVE_TOLERANCE = 0.01;

  // 检测等差数列
  const isArithmetic = avgDiff > 0 && diffs.every(
    (d) => Math.abs(d - avgDiff) / avgDiff <= RELATIVE_TOLERANCE,
  );

  if (isArithmetic) {
    return {
      hasPattern: true,
      patternType: 'arithmetic',
      details: `公差为 ${avgDiff.toFixed(2)} 的等差数列（相对容差 ${RELATIVE_TOLERANCE * 100}%）`,
    };
  }

  // 检测等比数列
  const ratios: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1] === 0) return { hasPattern: false, patternType: 'none' };
    ratios.push(sorted[i] / sorted[i - 1]);
  }

  const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;

  // 等比数列同样使用相对容差
  const isGeometric = avgRatio > 1 && ratios.every(
    (r) => avgRatio > 0 && Math.abs(r - avgRatio) / avgRatio <= RELATIVE_TOLERANCE,
  );

  if (isGeometric) {
    return {
      hasPattern: true,
      patternType: 'geometric',
      details: `公比为 ${avgRatio.toFixed(4)} 的等比数列（相对容差 ${RELATIVE_TOLERANCE * 100}%）`,
    };
  }

  return { hasPattern: false, patternType: 'none' };
}

/**
 * 检测报价异常值（基于标准差倍数）
 * 仅在投标单位 >= 4 家时才有参考意义，否则不检测。
 */
export function detectPriceOutliers(prices: number[], threshold = 2): number[] {
  if (prices.length < 4) return [];

  const stats = calculatePriceStatistics(prices);
  if (!stats) return [];

  const { mean, stdDev } = stats;
  if (stdDev === 0) return [];

  return prices.filter(p => Math.abs(p - mean) > threshold * stdDev);
}
