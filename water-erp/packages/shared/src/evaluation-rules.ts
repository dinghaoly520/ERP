// packages/shared/src/evaluation-rules.ts
// 生成评标结果「生成规则」口径——供 :3007 评标管理（及任何需陈述评标口径的视图）按
// 项目实际配置渲染规则文案，替代硬编码文案。口径镜像 apps/api 三处实现：
//   - bid/bid-evaluation-results.service.ts（getWinnerCount / 超限价判废 / 谈判排序）
//   - bid/aggregate-supplier-scores.ts（trimOutliers = scoreTrimEnabled ?? true）
//   - bid/price-formula.service.ts（公式类型与 default 分支回退）
// apps 不能跨包 import api，改引擎语义须两侧同步（同 apps/web price-config-card 的镜像约定）。
import { formatBidPrice } from './format-bid';

export type PriceFormulaType = 'lowest_price' | 'benchmark_deviation' | 'ratio';
/** manual = 未配置公式（priceFormulaConfig=null）——价格分由专家手填 */
export type ResolvedPriceFormula = PriceFormulaType | 'manual';

/** 采购方式 → 默认评标办法（镜像 apps/api evaluation-method.config.ts PROCUREMENT_EVALUATION_MAP；
 *  evaluationMethod 为 null 的存量项目按此推导实际生效办法） */
export const PROCUREMENT_EVALUATION_DEFAULT: Record<string, string> = {
  // 2026-09-26 默认改定：竞争性方式默认 manual（专家评审）；谈判/直接采购族为固有属性维持原值
  '邀请招标': 'manual', '询比采购': 'manual', '谈判采购': 'qualified_lowest_price',
  '竞价采购': 'manual', '直接采购': 'none',
  '公开招标': 'manual', '直接委托': 'none', '续约': 'none',
};

export const PRICE_FORMULA_LABELS: Record<PriceFormulaType, string> = {
  lowest_price: '最低评标价法',
  benchmark_deviation: '基准价偏离法',
  ratio: '比例法',
};

/** 实际生效评标办法：显式 evaluationMethod 优先，缺省按采购方式推导（FALLBACK=manual） */
export function deriveEvaluationMethod(
  evaluationMethod: string | null | undefined,
  procurementMethod: string | null | undefined,
): string {
  if (evaluationMethod) return evaluationMethod;
  return PROCUREMENT_EVALUATION_DEFAULT[procurementMethod ?? ''] ?? 'manual';
}

/** 公式类型回显口径=引擎实际行为：config null → manual；formulaType 缺失/非法（含历史 {}）
 *  → lowest_price（price-formula.service default 分支的真实回退） */
export function resolvePriceFormulaType(
  config: Record<string, unknown> | null | undefined,
): ResolvedPriceFormula {
  if (config == null) return 'manual';
  const t = config.formulaType;
  return t === 'lowest_price' || t === 'benchmark_deviation' || t === 'ratio' ? t : 'lowest_price';
}

export interface EvaluationRulesInput {
  /** BidProject.scoreTrimEnabled（null=默认开） */
  scoreTrimEnabled?: boolean | null;
  /** BidProject.priceFormulaConfig（null=专家手填） */
  priceFormulaConfig?: Record<string, unknown> | null;
  evaluationMethod?: string | null;
  procurementMethod?: string | null;
  /** BidProject.ceilingPrice（Prisma Decimal 序列化为 string 亦可） */
  ceilingPrice?: number | string | null;
  /** 项目是否编制了 PRICE 类评分项——引擎激活/价格分行出现的前提 */
  hasPriceScoreItems?: boolean;
}

export interface EvaluationRulesSummary {
  /** ≥5 位实际打分专家去 1 高 1 低（默认）；false=全额均分 */
  trimEnabled: boolean;
  /** 解析后的公式口径（manual=未配置） */
  formulaType: ResolvedPriceFormula;
  /** 引擎实际激活：有 PRICE 项且配置了公式 */
  formulaActive: boolean;
  /** 谈判采购：合格组按最终报价升序（最低价中标） */
  isNegotiation: boolean;
  /** 推荐候选人数：最低价类/不评分 → 1；综合评估/专家评审/未知 → 3 */
  winnerCount: 1 | 3;
  /** 报价超最高限价自动判废（公式激活或谈判采购 + 已设限价） */
  overCeilingDisqualifies: boolean;
  /** 随配置变化的生成规则行；无条件行（纳入范围/通过性废标）由视图固定渲染 */
  ruleLines: string[];
}

const RECOMMEND_TAIL = '；完整归档后自动生成中标公示草稿（在采购管理工作台信息发布中心发布）';

/** 按 :3005 项目配置汇总生成规则（与后端 generateEvaluationResults 同口径）。 */
export function summarizeEvaluationRules(input: EvaluationRulesInput): EvaluationRulesSummary {
  const trimEnabled = input.scoreTrimEnabled ?? true;
  const formulaType = resolvePriceFormulaType(input.priceFormulaConfig);
  const formulaActive = !!input.hasPriceScoreItems && formulaType !== 'manual';
  const isNegotiation = input.procurementMethod === '谈判采购';
  const method = deriveEvaluationMethod(input.evaluationMethod, input.procurementMethod);
  const winnerCount: 1 | 3 =
    method === 'lowest_price' || method === 'qualified_lowest_price' || method === 'none' ? 1 : 3;
  const hasCeiling = input.ceilingPrice != null && Number(input.ceilingPrice) > 0;
  const overCeilingDisqualifies = hasCeiling && (formulaActive || isNegotiation);

  const ruleLines: string[] = [];
  ruleLines.push(trimEnabled
    ? '专家组 ≥5 人时去掉 1 个最高分与 1 个最低分后求均分'
    : '按全部正选专家评分直接求均分（本项目已关闭去极值）');
  if (input.hasPriceScoreItems) {
    ruleLines.push(formulaActive
      ? `价格分按「${PRICE_FORMULA_LABELS[formulaType as PriceFormulaType]}」公式自动计算，不采用专家价格打分`
      : '价格分由专家按评分标准手填，计入总分');
  }
  if (overCeilingDisqualifies) {
    ruleLines.push(`报价超过最高限价（${formatBidPrice(input.ceilingPrice as number | string)}）的供应商按废标处理`);
  }
  if (isNegotiation) {
    ruleLines.push(`合格供应商按最终报价由低到高排序，最低价者第 1 名推荐为中标候选人${RECOMMEND_TAIL}`);
  } else if (winnerCount === 1) {
    ruleLines.push(`第 1 名推荐为中标候选人${RECOMMEND_TAIL}`);
  } else {
    ruleLines.push(`前 3 名推荐为中标候选人（不足 3 家按实际家数）${RECOMMEND_TAIL}`);
  }
  return { trimEnabled, formulaType, formulaActive, isNegotiation, winnerCount, overCeilingDisqualifies, ruleLines };
}
