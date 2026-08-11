/**
 * P2: 采购方式 → 评标办法 映射配置。
 * 选了采购方式就自动带出默认评标框架,逐项目可微调。
 */

export type EvaluationMethod = 'comprehensive' | 'lowest_price' | 'qualified_lowest_price' | 'none';

export interface ProcurementEvaluationDefault {
  evaluationMethod: EvaluationMethod;
  /** 价格分公式类型(对应 PriceFormulaService) */
  formulaType: 'lowest_price' | 'benchmark_deviation' | 'ratio' | null;
  /** 报价轮数: 1=单轮, 0=多轮(Phase 2c) */
  rounds: number;
}

/** 5 种标准内置采购方式 + legacy 值映射 */
export const PROCUREMENT_EVALUATION_MAP: Record<string, ProcurementEvaluationDefault> = {
  // ── 5 种标准方式 ──
  '邀请招标':  { evaluationMethod: 'comprehensive', formulaType: 'benchmark_deviation', rounds: 1 },
  '询比采购':  { evaluationMethod: 'lowest_price',  formulaType: 'lowest_price',        rounds: 1 },
  '谈判采购':  { evaluationMethod: 'qualified_lowest_price', formulaType: null,           rounds: 0 },
  '竞价采购':  { evaluationMethod: 'lowest_price',  formulaType: 'lowest_price',        rounds: 0 },
  '直接采购':  { evaluationMethod: 'none',          formulaType: null,                   rounds: 0 },
  // ── legacy / 别名映射 ──
  '公开招标':  { evaluationMethod: 'comprehensive', formulaType: 'benchmark_deviation', rounds: 1 },
  '直接委托':  { evaluationMethod: 'none',          formulaType: null,                   rounds: 0 },
  '续约':      { evaluationMethod: 'none',          formulaType: null,                   rounds: 0 },
};

/** 默认 fallback(未知采购方式) */
const FALLBACK: ProcurementEvaluationDefault = {
  evaluationMethod: 'comprehensive',
  formulaType: 'benchmark_deviation',
  rounds: 1,
};

/** 按采购方式获取默认评标配置 */
export function getEvaluationDefault(procurementMethod: string | null | undefined): ProcurementEvaluationDefault {
  if (!procurementMethod) return FALLBACK;
  return PROCUREMENT_EVALUATION_MAP[procurementMethod] ?? FALLBACK;
}

/** 评分标准模板:按评标办法生成不同分值结构 */
export function getScoreTemplate(evalMethod: EvaluationMethod): Array<{ category: string; name: string; maxScore: number }> {
  switch (evalMethod) {
    case 'lowest_price':
      // 询比/竞价: 资格 + 响应性 + 价格(100) — 价格为主
      return [
        { category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 },
        { category: 'RESPONSIVE', name: '符合性审查', maxScore: 0 },
        { category: 'PRICE', name: '价格评分', maxScore: 100 },
      ];
    case 'none':
      // 直接采购: 无竞争性评分
      return [];
    case 'qualified_lowest_price':
      // 谈判采购: 资格 + 响应性(通过性) + 商务(30) + 技术(70), 无价格分
      // 价格不作为评分项,而是通过多轮报价确定,最终以合格中最低价中标
      return [
        { category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 },
        { category: 'RESPONSIVE', name: '符合性审查', maxScore: 0 },
        { category: 'BUSINESS', name: '商务评分', maxScore: 30 },
        { category: 'TECHNICAL', name: '技术评分', maxScore: 70 },
      ];
    case 'comprehensive':
    default:
      // 综合评估法: 资格 + 响应性 + 商务 + 技术 + 价格 [现有标准模板]
      return [
        { category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 },
        { category: 'RESPONSIVE', name: '符合性审查', maxScore: 0 },
        { category: 'BUSINESS', name: '商务评分', maxScore: 20 },
        { category: 'TECHNICAL', name: '技术评分', maxScore: 50 },
        { category: 'PRICE', name: '价格评分', maxScore: 30 },
      ];
  }
}
