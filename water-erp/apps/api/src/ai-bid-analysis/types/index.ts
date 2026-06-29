// apps/api/src/ai-bid-analysis/types/index.ts

export interface BidderDocumentMetadata {
  author?: string;
  creator?: string;
  producer?: string;
  createdAt?: string;
  modifiedAt?: string;
  pageCount?: number;
  raw?: Record<string, unknown>;
}

export interface BidderPriceBreakdown {
  labor?: number | string;
  material?: number | string;
  equipment?: number | string;
  management?: number | string;
  profit?: number | string;
  other?: number | string;
  provisional?: number | string;
  tax?: number | string;
}

export interface BidderKeyInfo {
  bidderName: string;
  legalPerson: string;
  registeredCapital: string;
  establishedDate: string;
  quotePrice: number;
  quotePriceYuan: string;
  priceValidity: number;
  qualificationLevel: string;
  qualificationName: string;
  qualificationStatus: '通过' | '不通过' | '待审查';
  performanceCount: number;
  keyPerformances: Array<{
    projectName: string;
    contractAmount: string;
    completionDate: string;
    keyMetrics: string;
  }>;
  /** @deprecated Use proposedProjectManager instead */
  projectManager: string;
  /** @deprecated Use proposedProjectManagerTitle instead */
  projectManagerTitle: string;
  /** 拟任项目经理（本标投标团队） */
  proposedProjectManager?: string;
  /** 拟任项目经理职称 */
  proposedProjectManagerTitle?: string;
  /** 拟任项目经理执业资格 */
  proposedProjectManagerQualification?: string;
  /** 投标团队总人数 */
  teamSize?: number;
  constructionPeriod: string;
  warrantyPeriod: string;
  contactInfo: {
    phone: string;
    email: string;
    address: string;
  };
  documentMetadata?: BidderDocumentMetadata;
  priceBreakdown?: BidderPriceBreakdown;
  missingItems: string[];
}

export interface DeviationAnalysis {
  positiveDeviations: number;
  negativeDeviations: number;
  neutralResponses: number;
  criticalDeviations: Array<{
    requirementId: string;
    requirement: string;
    isStarred: boolean;
    bidderResponse: string;
    deviationType: 'positive' | 'negative' | 'none';
    severity: 'critical' | 'major' | 'minor';
    impact: string;
    evidenceLocation: string;
  }>;
  deviationScore: number;
  summary: string;
}

export interface TechnicalScore {
  totalScore: number;
  breakdown: {
    feasibility: { score: number; maxScore: 20; analysis: string; strengths: string[]; weaknesses: string[]; };
    equipment: { score: number; maxScore: 10; analysis: string; strengths: string[]; weaknesses: string[]; };
    personnel: { score: number; maxScore: 10; analysis: string; strengths: string[]; weaknesses: string[]; };
    guarantee: { score: number; maxScore: 10; analysis: string; strengths: string[]; weaknesses: string[]; };
  };
  starredResponse: {
    allMet: boolean;
    items: Array<{ requirement: string; response: string; met: boolean; }>;
  };
  overallComment: string;
}

export interface CommercialScore {
  totalScore: number;
  breakdown: {
    qualification: { score: number; maxScore: 10; analysis: string; details: string; };
    performance: { score: number; maxScore: 10; analysis: string; relevantCount: number; qualityAssessment: string; };
    service: { score: number; maxScore: 10; analysis: string; commitments: string[]; };
  };
  overallComment: string;
}

export interface PriceScore {
  totalScore: number;
  price: number;
  priceRatio: string;
  benchmarkPrice: number;
  deviation: string;
  priceBreakdown: {
    labor: { ratio: number; assessment: string; };
    material: { ratio: number; assessment: string; };
    equipment: { ratio: number; assessment: string; };
    management: { ratio: number; assessment: string; };
    profit: { ratio: number; assessment: string; };
  };
  marketComparison: {
    estimatedMarketPrice: number;
    deviationFromMarket: string;
    assessment: string;
  };
  strategyAssessment: {
    type: string;
    confidence: number;
    reasoning: string;
  };
  riskWarning: string;
  analysis: string;
}

/** 价格项 LLM 分析详情（方案2：复用 procurement price.prompt 输出，公式分之外的深度分析） */
export interface PriceAnalysisDetail {
  deviation?: string;
  benchmarkPrice?: number;
  priceBreakdown?: PriceScore['priceBreakdown'];
  marketComparison?: PriceScore['marketComparison'];
  strategyAssessment?: PriceScore['strategyAssessment'];
  riskWarning?: string;
  analysis?: string;
}

export interface QualificationResult {
  status: 'qualified' | 'unqualified';
  items: Array<{
    requirementId: string;
    category: string;
    requirementContent: string;
    bidderResponse: string;
    evidenceFound: boolean;
    evidenceDetail: string;
    result: string;
    issue: string;
  }>;
  summary: string;
  criticalIssues: string[];
}

export interface BidderScores {
  qualification: QualificationResult;
  response: {
    score: number;
    deviationAnalysis: DeviationAnalysis;
    summary: string;
  };
  technical: TechnicalScore;
  commercial: CommercialScore;
  price: PriceScore;
}

export type FraudRuleCode =
  | 'PRICE_CONCENTRATION_HIGH'
  | 'PRICE_CONCENTRATION_MEDIUM'
  | 'PRICE_PATTERN_ARITHMETIC'
  | 'PRICE_PATTERN_GEOMETRIC'
  | 'CONTACT_PHONE_OVERLAP'
  | 'CONTACT_EMAIL_OVERLAP'
  | 'CONTACT_ADDRESS_OVERLAP'
  | 'DOCUMENT_SIMILARITY_HIGH'
  | 'DOCUMENT_SIMILARITY_MEDIUM'
  | 'DOCUMENT_METADATA_CONSISTENCY'
  | 'PRICE_STRUCTURE_SIMILARITY'
  | 'PRICE_PROVISIONAL_SUM_MATCH';

export type FraudReviewAction =
  | 'verify_pricing_basis'
  | 'verify_independence'
  | 'compare_source_files'
  | 'manual_review';

export interface FraudEvidenceItem {
  type: 'price' | 'contact' | 'text' | 'format' | 'metadata';
  label: string;
  value: string;
  bidders: string[];
  explanation: string;
}

export interface FraudInvolvedBidder {
  id: string;
  name: string;
}

export interface FraudIndicator {
  type: 'price_concentration' | 'price_pattern' | 'document_similarity' | 'contact_overlap' | 'format_consistency' | 'metadata_consistency' | 'price_structure_similarity';
  ruleCode: FraudRuleCode;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  description: string;
  evidence: string;
  evidenceItems: FraudEvidenceItem[];
  affectedBidders: string[];
  involvedBidders: FraudInvolvedBidder[];
  similarityScore?: number;
  recommendation: string;
  reviewAction: FraudReviewAction;
}

export interface FraudIndicators {
  riskLevel: 'low' | 'medium' | 'high';
  indicators: FraudIndicator[];
  overallAssessment: string;
  summary: {
    highCount: number;
    mediumCount: number;
    lowCount: number;
    totalCount: number;
  };
}

export interface PriceAnalysis {
  lowest: { bidderId: string; name: string; price: number; };
  highest: { bidderId: string; name: string; price: number; };
  average: number;
  spread: number;
  variance: number;
  stdDev: number;
  dispersionRate: number;
}

export interface TenderRequirements {
  projectName: string;
  projectType: string;
  bidDeadline?: string;
  maxPrice?: number;
  estimatedCost?: number;
  qualificationRequirements: Array<{
    id: string;
    category: string;
    content: string;
    isRequired: boolean;
    evidenceType: string;
    threshold?: string;
  }>;
  technicalRequirements: Array<{
    id: string;
    category: string;
    content: string;
    isStarred: boolean;
    weight: number;
    measurable?: boolean;
    acceptanceCriteria?: string;
  }>;
  commercialRequirements: Array<{
    id: string;
    category: string;
    content: string;
    isRequired: boolean;
  }>;
  priceEvaluationMethod: string;
  scoringRules: {
    technicalMax: number;
    commercialMax: number;
    priceMax: number;
    technicalWeights: Record<string, number>;
    commercialWeights: Record<string, number>;
    priceMethod: string;
    notes: string;
  };
}

// ── per-item 版新增类型（Phase 3，方案第三/六/七章）──

/** 系统结构化数据（权威源，方案 2.2 数据优先级）—— 从 ERP 多表聚合 */
export interface SystemData {
  openingAmount?: string | null; // BidOpeningRecord.amount（String）
  submissionPrice?: string | null; // SupplierBidSubmission 表单报价
  openingPeriod?: string | null; // BidOpeningRecord.period（String）
  submissionPeriod?: string | null;
  legalPerson?: string | null; // Supplier.legalPerson
  creditCode?: string | null; // Supplier 统一社会信用代码
  qualifications: Array<{ name?: string | null }>; // SupplierQualification（无 level，从 name 正则）
  contacts: Array<{ phone?: string | null; email?: string | null }>; // SupplierContact（email 可空）
}

/** 单字段一致性检查结果 */
export interface FieldCheck {
  field: string;
  label: string;
  systemValue: unknown;
  docValue: unknown;
  status: 'consistent' | 'minor_diff' | 'conflict' | 'insufficient_data';
  severity: 'low' | 'medium' | 'high';
  note?: string;
}

/** 双源一致性总结果（存 AiConcordanceResult.checkedFields） */
export interface ConcordanceResult {
  overallStatus: 'consistent' | 'minor_diff' | 'conflict' | 'insufficient_data';
  conflictCount: number;
  warningCount: number;
  checks: FieldCheck[];
}

/** per-item AI 评分项（存 AiBidderResult.scoreItems，对齐 BidScoreItem） */
export interface AiScoreItem {
  scoreItemId: string; // BidScoreItem.id
  category: string; // ScoreCategory: QUALIFICATION|RESPONSIVE|BUSINESS|TECHNICAL|PRICE
  name: string;
  score: number;
  maxScore: number;
  reason?: string;
  evidence?: string;
  confidence?: number;
  /** 符合性审查项（maxScore=0）用：通过/不通过 */
  pass?: boolean;
  /** 正向事实（须引用投标文件原文，复用 procurement 深度评分内核） */
  strengths?: string[];
  /** 需关注项（须引用投标文件原文） */
  weaknesses?: string[];
  /** 价格项 LLM 分析详情（仅 PRICE 项，方案2） */
  priceAnalysis?: PriceAnalysisDetail;
}
