export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  role: string;
  isActive: boolean;
}

export * from './types/supplier';

export interface BidProject {
  id: string;
  projectCode: string;
  name: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  stage: string;
  riskNote?: string;
  _count?: { suppliers: number };
}

export interface BidSupplier {
  id: string;
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
  avoidanceConfirmed: boolean;
  progress: number;
  totalScore: number;
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
  question: string;
  issuer: string;
  supplierName: string;
  status: string;
  reply?: string;
}

export interface BidProjectDetail extends BidProject {
  suppliers: BidSupplier[];
  openingSession?: { host: string; supervisor: string; status: string; decryptWindowStart: string; decryptWindowEnd: string; remainingSeconds: number };
  openingRecords: { supplierName: string; amount: string; period: string; qualityTarget: string; bondStatus: string; decryptResult: string; confirmStatus: string }[];
  experts: BidExpert[];
  scoreItems: BidScoreItem[];
  clarifications: BidClarification[];
  supervisionLogs: BidSupervisionLog[];
  archiveItems: BidArchiveItem[];
}

/* ── 专家端类型 ── */

export interface ExpertStatistics {
  totalProjects: number;
  completedProjects: number;
  signedInProjects: number;
  pendingProjects: number;
  averageScore: number;
  recentActivity: { id: string; time: string; role: string; target: string; action: string; result: string; riskFlag: string }[];
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
  scoreRecords: { id: string; scoreItemId: string; score: number; reason?: string; scoreItem: BidScoreItem }[];
}

export interface ExpertProjectDetail extends BidProjectDetail {
  myExpertRecord: BidExpert & { id: string };
  myScores: { id: string; expertId: string; scoreItemId: string; score: number; reason?: string; scoreItem: BidScoreItem }[];
}

export interface DecryptedDocuments {
  supplier: { id: string; name: string; decryptStatus: string };
  documents: { name: string; type: string; size: string; status: string }[];
  canView: boolean;
}

export interface AssistData {
  supplierName: string;
  complianceCheck: {
    overall: string;
    items: { name: string; status: string; detail: string }[];
  };
  riskAnalysis: { level: string; category: string; content: string }[];
  scoreSuggestion: { category: string; name: string; suggestedScore: number; reason: string }[];
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
    completed: boolean;
    categoryScores: Record<string, { total: number; max: number; items: { name: string; score: number; maxScore: number; reason?: string }[] }>;
  }[];
  scoreItems: BidScoreItem[];
  canConfirm: boolean;
}
