/* ============================================================================
   共享类型定义 — 所有门户应用的唯一类型来源
   ============================================================================ */

/* ── 用户 & 认证 ── */

export type AppRole = 'admin' | 'bid_host' | 'bid_expert' | 'supplier' | 'procurement_staff' | 'mall';
export type SupplierStatus = 'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'DISABLED' | 'BLACKLIST';
export type ChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type BidStage = 'DOWNLOAD' | 'SUBMIT' | 'OPENING' | 'EVALUATING' | 'ARCHIVED';

/* ── AI 辅助评标 per-item（Phase 6）── */

export interface AiScoreItem {
  scoreItemId: string;
  category: string;
  name: string;
  score: number;
  maxScore: number;
  reason?: string;
  evidence?: string;
  confidence?: number;
  pass?: boolean;
}
export type AnnouncementType = 'BID_NOTICE' | 'WIN_NOTICE' | 'POLICY' | 'PLATFORM';
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type DecryptStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'DANGER';
export type ConfirmStatus = 'PENDING' | 'CONFIRMED' | 'EXCEPTION';

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  role: string;
  isActive: boolean;
}

/* ── 投标项目 ── */

export interface BidProject {
  id: string;
  projectCode: string;
  name: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  stage: string;
  riskNote?: string;
  budget?: number;
  scope?: string;
  qualification?: string;
  contact?: string;
  _count?: { suppliers: number };
}

export interface BidSupplier {
  id: string;
  supplierId?: string;
  supplierName: string;
  downloadStatus: string;
  submitStatus: string;
  encryptStatus: string;
  receiptNo?: string;
  decryptStatus: string;
  confirmStatus: string;
}

export interface BidExpert {
  id: string;
  expertName: string;
  major: string;
  signedIn: boolean;
  phoneVerified?: boolean;
  phoneMasked?: string | null;
  avoidanceConfirmed: boolean;
  progress: number;
  totalScore: number;
  reportConfirmed?: boolean;
  conflictedSupplierIds?: string[];
  reportConfirmedAt?: string | null;
}

export interface BidScoreItem {
  id: string;
  category: string;
  name: string;
  maxScore: number;
}

export interface BidSupervisionLog {
  id: string;
  time: string;
  role: string;
  target: string;
  action: string;
  result: string;
  riskFlag: string;
}

export interface BidSupervisionAnnotation {
  id: string;
  projectId: string;
  supplierId: string;
  status: 'flagged' | 'escalated' | 'cleared';
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BidArchiveItem {
  id: string;
  name: string;
  ownerRole: string;
  status: string;
  hashDigest?: string;
  archivedAt?: string;
}

export interface BidClarification {
  id: string;
  type: string;
  question: string;
  issuer: string;
  supplierName: string;
  supplierId?: string;
  status: string;
  reply?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BidProjectDetail extends BidProject {
  suppliers: BidSupplier[];
  openingSession?: { host: string; supervisor: string; status: string; decryptWindowStart: string; decryptWindowEnd: string; remainingSeconds: number };
  openingRecords: {
    id: string; supplierName: string; amount: string; period: string; qualityTarget: string;
    bondStatus: string; decryptResult: string; confirmStatus: string;
    bidSupplierId?: string | null; objectionReason?: string | null;
    confirmedAt?: string | null; handledAt?: string | null; handledBy?: string | null; handleResult?: string | null;
  }[];
  experts: BidExpert[];
  scoreItems: BidScoreItem[];
  clarifications: BidClarification[];
  supervisionLogs: BidSupervisionLog[];
  archiveItems: BidArchiveItem[];
  supervisionAnnotations?: BidSupervisionAnnotation[];
}

/* ── 专家端 ── */

export interface ExpertStatistics {
  totalProjects: number;
  completedProjects: number;
  signedInProjects: number;
  pendingProjects: number;
  averageScore: number;
  recentActivity: BidSupervisionLog[];
}

export interface ExpertProject {
  id: string;
  expertName: string;
  major: string;
  signedIn: boolean;
  avoidanceConfirmed: boolean;
  progress: number;
  totalScore: number;
  createdAt: string;
  project: {
    id: string;
    projectCode: string;
    name: string;
    stage: string;
    openTime: string;
    suppliers: BidSupplier[];
    scoreItems: BidScoreItem[];
    _count: { clarifications: number };
  };
  scoreRecords: { id: string; expertId: string; supplierId: string; scoreItemId: string; score: number; passed?: boolean | null; reason?: string; scoreItem: BidScoreItem }[];
}

export interface ExpertProjectDetail extends BidProjectDetail {
  myExpertRecord: BidExpert & { id: string };
  myScores: { id: string; expertId: string; supplierId: string; scoreItemId: string; score: number; passed?: boolean | null; reason?: string; scoreItem: BidScoreItem }[];
  /** 招标文件元信息（仅 OPENING/EVALUATING active 项目附带，否则 null）；供专家独立核对原文 */
  tenderDocument?: { title: string; fileName: string; fileSize: number; downloadUrl: string } | null;
}

export interface DecryptedDocuments {
  supplier: { id: string; name: string; decryptStatus: string };
  documents: {
    name: string;
    originalName: string;
    type: string;
    size: number;
    status: string;
    downloadUrl?: string;
    sha256?: string;
  }[];
  canView: boolean;
}

export interface AssistData {
  source?: 'ai_bidder_result' | 'rules_fallback';
  supplierName: string;
  generatedAt?: string;
  model?: string;
  // ── ai_bidder_result（per-item，Phase 6 新增）──
  totalScore?: number;
  scoreItems?: AiScoreItem[];
  categoryTotals?: Record<string, { score: number; max: number }>;
  keyInfo?: Record<string, unknown>;
  concordance?: any;
  concordanceStatus?: string;
  strengths?: any;
  weaknesses?: any;
  overallComment?: string;
  qualificationStatus?: string;
  riskLevel?: string;
  // ── rules_fallback（旧规则引擎结构，降级时用）──
  overall?: { score: number; level: string; breakdown: { compliance: { weight: number; score: number }; risk: { weight: number; score: number }; scoring: { weight: number; score: number } } };
  complianceCheck: { overall: string; score?: number; items: { name: string; status: string; detail: string }[] };
  riskAnalysis: { level: string; category: string; content: string; confidence?: number }[];
  scoreSuggestion: { category: string; name: string; suggestedScore: number; minScore?: number; maxScore: number; reason: string; confidence?: number }[];
  keyPoints: string[];
}

export interface EvaluationReport {
  projectName: string;
  projectCode: string;
  expertName: string;
  expertProgress: number;
  signedIn: boolean;
  avoidanceConfirmed: boolean;
  supplierScores: {
    supplierName: string;
    totalScore: number;
    perSupplierComplete: boolean;
    categoryScores: Record<string, { total: number; max: number; items: { name: string; score: number; maxScore: number; passed?: boolean; reason?: string }[] }>;
  }[];
  scoreItems: BidScoreItem[];
  canConfirm: boolean;
  overallComplete: boolean;
}

/* ── 供应商端 ── */

export interface Supplier {
  id: string;
  userId: string;
  name: string;
  creditCode: string | null;
  enterpriseType: string;
  legalPerson: string;
  registeredAddress: string;
  businessScope: string;
  status: SupplierStatus;
  classificationId?: string;
  rejectReason?: string;
  returnReason?: string;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; username: string; displayName: string; email?: string; role: string; isActive: boolean };
  classification?: SupplierClassification;
  contacts?: SupplierContact[];
  qualifications?: SupplierQualification[];
  _count?: { evaluations: number };
}

export interface SupplierContact {
  id: string;
  supplierId: string;
  name: string;
  phone: string;
  email?: string;
  isPrimary: boolean;
}

export interface SupplierQualification {
  id: string;
  supplierId: string;
  type: string;
  name: string;
  fileUrl: string;
  validFrom?: string;
  validTo?: string;
  status: string;
}

export interface SupplierClassification {
  id: string;
  name: string;
  code: string;
  description?: string;
  _count?: { suppliers: number };
}

export interface SupplierEvaluation {
  id: string;
  supplierId: string;
  projectId?: string;
  evaluatorId: string;
  score: number;
  level: string;
  completenessScore: number;
  responsivenessScore: number;
  cooperationScore: number;
  complianceScore: number;
  overallScore: number;
  comment?: string;
  createdAt: string;
  evaluator?: { id: string; displayName: string };
}

export interface SupplierChangeRecord {
  id: string;
  supplierId: string;
  fieldName: string;
  fieldLabel: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  status: ChangeStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectReason?: string;
  createdAt: string;
}

export interface SupplierListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Supplier[];
}

/* ── 公告 & 通知 ── */

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: AnnouncementType;
  status: AnnouncementStatus;
  summary?: string;
  publishDate?: string;
  isTop: boolean;
  viewCount: number;
  relatedProjectCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  link?: string;
  createdAt: string;
}

/* ── 文件资产 ── */

export interface FileAsset {
  id: string;
  key: string;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
  category: string;
  sha256: string;
  createdAt: string;
}

/* ── 驾驶舱统计 ── */

export interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  totalSuppliers: number;
  approvedSuppliers: number;
  totalExperts: number;
  totalAnnouncements: number;
  stageDistribution: Record<string, number>;
  recentActivity: BidSupervisionLog[];
}

export interface BidEvaluationResultView {
  supplierId: string;
  supplierName: string;
  totalScore: number;
  averageScore: number;
  rank: number;
  recommended: boolean;
  disqualified?: boolean;
  generatedAt: string;
}
