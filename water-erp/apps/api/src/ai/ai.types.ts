import { HardConditions, ConditionCheck } from './supplier-hard-conditions';

export type { HardConditions, ConditionCheck };

export interface ComplianceItem {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

export interface RiskItem {
  level: 'info' | 'warning' | 'success' | 'danger';
  category: string;
  content: string;
  confidence: number;
}

export interface ScoreSuggestion {
  category: string;
  name: string;
  suggestedScore: number;
  minScore: number;
  maxScore: number;
  reason: string;
  confidence: number;
}

export interface OverallScore {
  score: number;
  level: string;
  breakdown: {
    compliance: { weight: number; score: number };
    risk: { weight: number; score: number };
    scoring: { weight: number; score: number };
  };
}

export interface AiAnalysisResult {
  supplierName: string;
  generatedAt: string;
  model: string;
  /** 是否由大模型生成。analyzeBid 为规则预检，须置 false，前端据此如实标注、不得以 AI 口吻呈现。 */
  isAi?: boolean;
  /** 方法论说明，用于向评标专家透明披露结论来源（规则/统计 vs LLM）。 */
  methodology?: string;
  overall: OverallScore;
  complianceCheck: { overall: string; score: number; items: ComplianceItem[] };
  riskAnalysis: RiskItem[];
  scoreSuggestion: ScoreSuggestion[];
  keyPoints: string[];
}

export interface SupplierRecommendation {
  supplierId: string;
  name: string;
  matchScore: number;
  reason: string;
  legalPerson?: string;
  enterpriseType?: string;
  /** 业务标签（取自 Supplier.tags），供前端展示匹配维度 + 提升选取可解释性。 */
  tags?: string[];
  contacts?: { name: string; phone: string; isPrimary: boolean }[];
  /** 前端契约字段为 level（历史即 level；finalGrade 为 DB 列名，勿再错位） */
  evaluation?: { level: string; count: number };
  activeProjects: number;
  // ── 对比面板扩充（2026-09-09）：供应商资料已很丰富，推荐结果一并带回供横向对比 ──
  supplierNo?: string; // 供应商编号
  businessScope?: string; // 经营范围（截断）
  qualifications?: string[]; // 资质证书名称（最多5项）
  registeredCapital?: string; // 注册资本
  region?: string; // 所属行政区域
  industry?: string; // 所属行业
  registeredAddress?: string; // 注册地址（截断）
}

export interface SupplierSelectionResult {
  requirement: string;
  engine: 'deepseek' | 'rules';
  model: string;
  candidatePool: number;
  summary: string;
  recommendations: SupplierRecommendation[];
  /** 硬性条件逐项核验（仅传入 hardConditions 时返回；键=推荐供应商） */
  conditionsCheck?: { supplierId: string; checks: ConditionCheck[] }[];
  /** 被硬性条件剔除的供应商（必须级 FAIL；供人工复核误杀；上限 300 条，总数见 filteredOutTotal） */
  filteredOut?: { supplierId: string; name: string; failedCondition: string }[];
  /** 被硬性条件剔除的供应商总数（filteredOut 截断时 > filteredOut.length） */
  filteredOutTotal?: number;
  generatedAt: string;
}
