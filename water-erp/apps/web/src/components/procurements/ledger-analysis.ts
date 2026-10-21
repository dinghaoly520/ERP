// 采购台账 AI 分析·共享汇总口径（2026-10-21 分析界面重设计时抽取）。
// 此前「选择分析对象」弹窗、「综合分析报告」弹窗与页面 confirmAnalysis 三处各自
// reduce 同一份数据——口径漂移即同屏打架（2026-09-28 审计曾抓同页三处两套小数位），
// 统一收口到本模块，金额解析与 lib/format 的 formatWan 同口径（剥千分位逗号）。

import type { ProcurementRoundItem, ResultStatusKey } from '@/lib/types/procurement';

/** AI 综合分析返回结构（/ai/procurement-analysis） */
export type AiAnalysisResult = {
  overview: string;
  highlights: string[];
  concerns: string[];
  suggestions: string[];
};

/** 异常态集合（与台账 hero「异常」计数同口径） */
export const ABNORMAL_STATUSES: readonly ResultStatusKey[] = [
  'FAILED_REVIEW',
  'FILE_REVISION_REQUIRED',
  'INVALID_RESPONSE',
] as const;

/** 状态四分组：已成交 / 待处理 / 异常 / 其他（已取消·已终止） */
export type LedgerStatusGroup = 'awarded' | 'pending' | 'abnormal' | 'other';

export function statusGroupOf(status: ResultStatusKey): LedgerStatusGroup {
  if (status === 'AWARDED') return 'awarded';
  if (status === 'PENDING') return 'pending';
  if ((ABNORMAL_STATUSES as readonly string[]).includes(status)) return 'abnormal';
  return 'other';
}

export const LEDGER_GROUP_LABEL: Record<LedgerStatusGroup, string> = {
  awarded: '已成交',
  pending: '待处理',
  abnormal: '异常',
  other: '其他',
};

export const LEDGER_GROUP_COLOR: Record<LedgerStatusGroup, string> = {
  awarded: 'rgba(92,181,150,1)',
  pending: 'rgba(234,188,110,1)',
  abnormal: 'rgba(230,129,102,1)',
  other: 'rgba(140,140,140,1)',
};

export const LEDGER_GROUP_BG: Record<LedgerStatusGroup, string> = {
  awarded: 'rgba(92,181,150,0.12)',
  pending: 'rgba(234,188,110,0.14)',
  abnormal: 'rgba(230,129,102,0.10)',
  other: 'rgba(140,140,140,0.12)',
};

/** 金额列兼容 number/string（含千分位逗号），非法值归 0 */
export function toAmountNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v;
  return Number.isFinite(n) ? n : 0;
}

export type LedgerAnalysisSummary = {
  totalCount: number;
  totalBudget: number;
  totalAward: number;
  savings: number;
  /** toFixed(1) 字符串，与 /ai/procurement-analysis summary 契约一致 */
  savingsRate: string;
  awardedCount: number;
  pendingCount: number;
  abnormalCount: number;
  otherCount: number;
  methodCounts: Record<string, number>;
  deptCounts: Record<string, number>;
  /** 采购日期区间（yyyy-MM-dd，按字符串排序取首尾；null=无日期） */
  periodStart: string | null;
  periodEnd: string | null;
};

export function buildLedgerAnalysisSummary(items: ProcurementRoundItem[]): LedgerAnalysisSummary {
  let totalBudget = 0;
  let totalAward = 0;
  let awardedCount = 0;
  let pendingCount = 0;
  let abnormalCount = 0;
  let otherCount = 0;
  const methodCounts: Record<string, number> = {};
  const deptCounts: Record<string, number> = {};
  const dates: string[] = [];

  for (const i of items) {
    totalBudget += toAmountNumber(i.controlAmount ?? i.budgetAmount);
    totalAward += toAmountNumber(i.awardAmount);
    const g = statusGroupOf(i.resultStatus);
    if (g === 'awarded') awardedCount++;
    else if (g === 'pending') pendingCount++;
    else if (g === 'abnormal') abnormalCount++;
    else otherCount++;
    methodCounts[i.procurementMethod] = (methodCounts[i.procurementMethod] ?? 0) + 1;
    deptCounts[i.departmentName] = (deptCounts[i.departmentName] ?? 0) + 1;
    if (i.procurementDate) dates.push(i.procurementDate.slice(0, 10));
  }

  const savings = totalBudget - totalAward;
  dates.sort();

  return {
    totalCount: items.length,
    totalBudget,
    totalAward,
    savings,
    savingsRate: totalBudget > 0 ? ((savings / totalBudget) * 100).toFixed(1) : '0',
    awardedCount,
    pendingCount,
    abnormalCount,
    otherCount,
    methodCounts,
    deptCounts,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
  };
}
