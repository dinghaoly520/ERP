export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { files: number; rules: number };
  files?: KnowledgeFile[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeFile {
  id: string;
  knowledgeBaseId: string;
  fileName: string;
  objectKey: string;
  mimeType: string;
  fileSize: number;
  content: string | null;
  chunkCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceRule {
  id: string;
  knowledgeBaseId: string;
  source: string;
  name: string;
  ruleType: 'numeric_compare' | 'existence_check' | 'semantic';
  checkTarget: string;
  logicExpression: Record<string, unknown>;
  severity: 'critical' | 'warning' | 'info';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewTask {
  id: string;
  documentName: string;
  objectKey: string;
  documentContent: string | null;
  modifiedDocumentContent: string | null;
  knowledgeBaseId: string;
  userId?: string;
  reviewMode: 'strict' | 'general';
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalChecks: number;
  passedCount: number;
  failedCount: number;
  warningCount: number;
  results: ReviewReport | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ReviewReport {
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  criticalIssues: RuleResult[];
  warnings: RuleResult[];
  passedChecks: RuleResult[];
  generalResults?: GeneralReviewResult[];
  llmFreeIssues?: LlmFreeIssue[];
}

export interface DocumentLocation {
  clauseNumber: string;
  sectionName: string;
  excerpt: string;
}

export interface KnowledgeBaseReference {
  fileName: string;
  clauseContent: string;
  score: number;
}

export type SuggestionOperation = 'replace' | 'insert' | 'delete' | 'manual';

export interface StructuredSuggestion {
  description: string;
  operation: SuggestionOperation;
  originalText?: string;
  replacementText?: string;
  anchor?: string;
}

export function isStructuredSuggestion(val: unknown): val is StructuredSuggestion {
  if (typeof val === 'object' && val !== null && 'operation' in val) {
    return ['replace', 'insert', 'delete', 'manual'].includes((val as StructuredSuggestion).operation);
  }
  return false;
}

export function getSuggestionDescription(suggestion: unknown): string {
  if (isStructuredSuggestion(suggestion)) return suggestion.description;
  return typeof suggestion === 'string' ? suggestion : '';
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  source: string;
  passed: boolean;
  severity: 'critical' | 'warning' | 'info';
  details: string;
  evidence?: string;
  suggestion?: string | StructuredSuggestion;
  documentExcerpt?: string;
  kbExcerpt?: string;
  documentLocation?: DocumentLocation;
  knowledgeBaseReferences?: KnowledgeBaseReference[];
  status?: 'pending' | 'accepted' | 'rejected';
  editedSuggestion?: string;
  resolvedAt?: string;
  notApplicable?: boolean;
  dataMissing?: boolean;
}

export interface GeneralReviewResult {
  sectionName: string;
  issues: Array<{
    severity: 'critical' | 'warning' | 'info';
    description: string;
    relatedClause: string;
    evidence: string;
    suggestion?: string;
    documentExcerpt?: string;
    kbExcerpt?: string;
    documentLocation?: DocumentLocation;
    knowledgeBaseReferences?: KnowledgeBaseReference[];
    status?: 'pending' | 'accepted' | 'rejected';
    editedSuggestion?: string;
    resolvedAt?: string;
  }>;
}

export interface LlmFreeIssue {
  severity: 'critical' | 'warning' | 'info';
  description: string;
  relatedClause: string;
  evidence: string;
  suggestion?: string;
  documentExcerpt?: string;
  documentLocation?: DocumentLocation;
  status?: 'pending' | 'accepted' | 'rejected';
  editedSuggestion?: string;
  resolvedAt?: string;
  source: 'llm-free';
  sectionName?: string;
}

export interface Issue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  evidence: string;
  suggestion: string | StructuredSuggestion;
  documentExcerpt?: string;
  kbExcerpt?: string;
  documentLocation?: DocumentLocation;
  knowledgeBaseReferences?: KnowledgeBaseReference[];
  ruleType?: string;
  sectionName?: string;
  source?: string;
  status: 'pending' | 'accepted' | 'rejected';
  editedSuggestion?: string;
  resolvedAt?: string;
  passed?: boolean;
  notApplicable?: boolean;
  dataMissing?: boolean;
}

export type RuleType = 'numeric_compare' | 'existence_check' | 'semantic';
export type Severity = 'critical' | 'warning' | 'info';
export type ReviewMode = 'strict' | 'general';

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  numeric_compare: '数值比较',
  existence_check: '存在性检查',
  semantic: '语义判定',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
};

export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'text-red-500 bg-red-500/10',
  warning: 'text-amber-500 bg-amber-500/10',
  info: 'text-blue-400 bg-blue-400/10',
};

export const STATUS_COLORS: Record<string, string> = {
  pending: 'text-gray-400',
  running: 'text-blue-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
};
