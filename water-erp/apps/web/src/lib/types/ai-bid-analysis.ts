// apps/web/src/lib/types/ai-bid-analysis.ts

/**
 * AI投标分析任务状态
 * 与后端 Prisma schema 中的 AiBidTaskStatus enum 保持一致
 */
export type AiBidTaskStatus =
  | 'CREATED'
  | 'TENDER_UPLOADING'
  | 'TENDER_PROCESSING'
  | 'TENDER_READY'
  | 'RULES_PREVIEW'
  | 'BIDDERS_UPLOADING'
  | 'BIDDERS_PROCESSING'
  | 'ANALYZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * 投标单位处理状态
 * 与后端 Prisma schema 中的 AiBidderStatus enum 保持一致
 */
export type AiBidderStatus =
  | 'PENDING'
  | 'OCR_PROCESSING'
  | 'OCR_COMPLETED'
  | 'EXTRACTING'
  | 'EXTRACTED'
  | 'SCORING'
  | 'SCORED'
  | 'DEVIATION_ANALYZING'
  | 'COMPLETED'
  | 'FAILED';

/**
 * 任务状态标签（中文）
 */
export const AI_BID_TASK_STATUS_LABELS: Record<AiBidTaskStatus, string> = {
  CREATED: '已创建',
  TENDER_UPLOADING: '招标文件上传中',
  TENDER_PROCESSING: '招标文件处理中',
  TENDER_READY: '招标文件就绪',
  RULES_PREVIEW: '规则预览',
  BIDDERS_UPLOADING: '投标文件上传中',
  BIDDERS_PROCESSING: '投标文件处理中',
  ANALYZING: '分析中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

/**
 * 任务状态颜色类名
 */
export const AI_BID_TASK_STATUS_COLORS: Record<AiBidTaskStatus, string> = {
  CREATED: 'bg-gray-100 text-gray-700',
  TENDER_UPLOADING: 'bg-blue-100 text-blue-700',
  TENDER_PROCESSING: 'bg-blue-100 text-blue-700',
  TENDER_READY: 'bg-indigo-100 text-indigo-700',
  RULES_PREVIEW: 'bg-purple-100 text-purple-700',
  BIDDERS_UPLOADING: 'bg-purple-100 text-purple-700',
  BIDDERS_PROCESSING: 'bg-purple-100 text-purple-700',
  ANALYZING: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

/**
 * 投标单位状态标签（中文）
 */
export const AI_BIDDER_STATUS_LABELS: Record<AiBidderStatus, string> = {
  PENDING: '待处理',
  OCR_PROCESSING: 'OCR识别中',
  OCR_COMPLETED: 'OCR完成',
  EXTRACTING: '信息提取中',
  EXTRACTED: '提取完成',
  SCORING: '评分中',
  SCORED: '评分完成',
  DEVIATION_ANALYZING: '偏差分析中',
  COMPLETED: '已完成',
  FAILED: '失败',
};

/**
 * 投标单位状态颜色类名
 */
export const AI_BIDDER_STATUS_COLORS: Record<AiBidderStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  OCR_PROCESSING: 'bg-blue-100 text-blue-700',
  OCR_COMPLETED: 'bg-cyan-100 text-cyan-700',
  EXTRACTING: 'bg-indigo-100 text-indigo-700',
  EXTRACTED: 'bg-purple-100 text-purple-700',
  SCORING: 'bg-yellow-100 text-yellow-700',
  SCORED: 'bg-orange-100 text-orange-700',
  DEVIATION_ANALYZING: 'bg-pink-100 text-pink-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

/**
 * 投标单位进度百分比映射
 */
export const BIDDER_PROGRESS_MAP: Record<AiBidderStatus, number> = {
  PENDING: 0,
  OCR_PROCESSING: 20,
  OCR_COMPLETED: 25,
  EXTRACTING: 40,
  EXTRACTED: 45,
  SCORING: 60,
  SCORED: 80,
  DEVIATION_ANALYZING: 90,
  COMPLETED: 100,
  FAILED: 0,
};

export interface AiTenderFile {
  id: string;
  taskId: string;
  fileId: string;
  fileName: string;
  text: string | null;
  pages: unknown[] | null;
  isMain: boolean;
  order: number;
  createdAt: string;
}

export interface AiBidAnalysisTask {
  id: string;
  name: string;
  projectName: string | null;
  status: AiBidTaskStatus;
  tenderFileId: string | null;
  tenderFileName: string | null;
  tenderFiles?: AiTenderFile[];
  requirements: TenderRequirements | null;
  bidders: AiBidder[];
  report: AiBidReport | null;
  createdAt: string;
  completedAt: string | null;
}

export interface StrengthOrWeakness {
  dimension: 'qualification' | 'technical' | 'commercial' | 'price' | 'risk';
  title: string;
  detail: string;
  evidence?: string;
  impact?: string;
}

export interface CompetitiveAnalysisResult {
  strengths: StrengthOrWeakness[];
  weaknesses: StrengthOrWeakness[];
  overallComment: string;
  keyObservations: string[];
}

export interface AiBidder {
  id: string;
  taskId: string;
  name: string;
  fileId: string | null;
  fileName: string | null;
  status: AiBidderStatus;
  keyInfo: BidderKeyInfo | null;
  extractedInfo: Record<string, unknown> | null;
  scores: BidderScores | null;
  totalScore: number | null;
  qualificationStatus: string | null;
  riskLevel: string | null;
  riskAnalysis: RiskAnalysis | null;
  strengths: string[] | null;
  weaknesses: string[] | null;
  overallComment: string | null;
  deviationAnalysis: DeviationAnalysis | null;
  competitiveAnalysis: CompetitiveAnalysisResult | null;
  createdAt: string;
  processedAt: string | null;
}

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
  projectManager: string;
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

export interface TenderRequirements {
  projectName: string;
  projectType: string;
  bidDeadline: string | null;
  maxPrice: number | null;
  estimatedCost: number | null;
  qualificationRequirements: Array<{
    id: string;
    category: string;
    content: string;
    isRequired: boolean;
    evidenceType: string;
    threshold: string;
  }>;
  technicalRequirements: Array<{
    id: string;
    category: string;
    content: string;
    isStarred: boolean;
    weight: number;
    measurable: boolean;
    acceptanceCriteria: string;
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
  keyDates: {
    bidDeadline: string;
    validityPeriod: string;
    completionDeadline: string;
  };
}

export interface BidderScores {
  technical: TechnicalScore;
  commercial: CommercialScore;
  price: PriceScore;
}

export interface TechnicalScore {
  totalScore: number;
  maxScore: number;
  breakdown?: {
    feasibility: { score: number; maxScore: number; analysis: string; strengths: string[]; weaknesses: string[]; };
    equipment: { score: number; maxScore: number; analysis: string; strengths: string[]; weaknesses: string[]; };
    personnel: { score: number; maxScore: number; analysis: string; strengths: string[]; weaknesses: string[]; };
    guarantee: { score: number; maxScore: number; analysis: string; strengths: string[]; weaknesses: string[]; };
  };
  overallComment?: string;
}

export interface CommercialScore {
  totalScore: number;
  maxScore: number;
  breakdown?: {
    qualification: { score: number; maxScore: number; analysis: string; details: string; };
    performance: { score: number; maxScore: number; analysis: string; relevantCount: number; qualityAssessment: string; };
    service: { score: number; maxScore: number; analysis: string; commitments: string[]; };
  };
  overallComment?: string;
}

export interface PriceScore {
  totalScore: number;
  maxScore: number;
  price?: number;
  priceRatio?: string;
  benchmarkPrice?: number;
  deviation?: string;
  priceBreakdown?: {
    labor: { ratio: number; assessment: string; };
    material: { ratio: number; assessment: string; };
    equipment: { ratio: number; assessment: string; };
    management: { ratio: number; assessment: string; };
    profit: { ratio: number; assessment: string; };
  };
  marketComparison?: {
    estimatedMarketPrice: number;
    deviationFromMarket: string;
    assessment: string;
  };
  strategyAssessment?: {
    type: string;
    confidence: number;
    reasoning: string;
  };
  riskLevel?: 'low' | 'medium' | 'high';
  riskWarning?: string;
  analysis?: string;
}

export interface DeviationAnalysis {
  technicalDeviations: Array<{
    requirement: string;
    bidderResponse: string;
    deviation: string;
    impact: string;
  }>;
  commercialDeviations: Array<{
    requirement: string;
    bidderResponse: string;
    deviation: string;
    impact: string;
  }>;
}

export interface RiskAnalysis {
  overallRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskFactors: Array<{
    category: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | string;
  }>;
  summary?: string;
  overallRisk?: string;
  risks?: Array<{
    category?: string;
    type?: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | string;
  }>;
}

export interface AiBidReport {
  id?: string;
  taskId?: string;
  generatedAt: string;
  summary?: Record<string, unknown>;
  ranking?: unknown[];
  keyInfoComparison?: unknown[];
  priceAnalysis?: Record<string, unknown> | null;
  strengthsWeaknesses?: unknown[];
  riskStats?: Record<string, unknown>;
  highRiskDetails?: unknown[];
  reviewSuggestions?: string | Record<string, unknown>;
  fraudIndicators?: FraudIndicators | null;
  conclusion?: string;
  recommendation?: unknown;
}

export interface CreateTaskDto {
  name: string;
  projectName?: string;
}

export interface AddBidderDto {
  name: string;
}

export interface TaskProgress {
  taskStatus: AiBidTaskStatus;
  bidderProgress: Array<{
    id: string;
    name: string;
    status: AiBidderStatus;
    progress: number;
  }>;
  totalBidders: number;
  completedBidders: number;
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


/**
 * 任务工作区标签页类型
 */
export type TabKey = 'upload' | 'key-info' | 'analysis' | 'fraud' | 'report';

/**
 * 连续工作台阶段标识
 */
export type AiWorkspaceStageKey = 'upload' | 'key-info' | 'analysis' | 'fraud' | 'report';

/**
 * 连续工作台阶段项
 */
export interface AiWorkspaceStageItem {
  key: AiWorkspaceStageKey;
  label: string;
  enabled: boolean;
  completed: boolean;
  active: boolean;
}

/**
 * 连续工作台摘要统计
 */
export interface AiWorkspaceSummaryStats {
  bidderCount: number;
  uploadedBidderCount: number;
  completedBidderCount: number;
  failedBidderCount: number;
  biddersWithKeyInfoCount: number;
  missingTenderFile: boolean;
  canStartAnalysis: boolean;
  canViewScoring: boolean;
}

/**
 * 连续工作台视图模型
 */
export interface AiWorkspaceViewModel {
  activeStage: AiWorkspaceStageKey;
  stages: AiWorkspaceStageItem[];
  summary: AiWorkspaceSummaryStats;
  showUploadStage: boolean;
  showKeyInfoStage: boolean;
  showAnalysisStage: boolean;
  showFraudStage: boolean;
  showReportStage: boolean;
}

/**
 * AI投标分析健康检查状态
 * 与后端 /api/ai-bid-analysis/health 端点返回格式一致
 */
export interface HealthStatus {
  ready: boolean;
  ocr: boolean;
  redis: boolean;
}
