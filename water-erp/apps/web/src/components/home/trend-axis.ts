/**
 * 采购执行趋势底部时间栏的标签抽稀规则（纯函数，node:test 覆盖见 trend-axis.test.ts）。
 *
 * 时间轴是类目轴（桶 = 有事件的日子，按索引等距排布），选长日期区间时桶距会小于
 * 一个日期标签的宽度，直接全显会互相叠字。规则：桶距不足 TREND_LABEL_MIN_SLOT_PX
 * 时按步长抽稀；首桶落在 0 格点天然显示，末桶强制显示兜住右边界。
 * （悬停桶是否强制显示属交互层，由 TrendChartPanel 自行叠加。）
 */
export const TREND_LABEL_MIN_SLOT_PX = 46;

export function trendLabelStep(bucketCount: number, availableWidth: number): number {
  if (bucketCount <= 0 || availableWidth <= 0) return 1;
  const slot = availableWidth / bucketCount;
  return Math.max(1, Math.ceil(TREND_LABEL_MIN_SLOT_PX / slot));
}

export function isTrendLabelShown(index: number, bucketCount: number, step: number): boolean {
  if (bucketCount <= 0 || index < 0 || index >= bucketCount) return false;
  return index % step === 0 || index === bucketCount - 1;
}
