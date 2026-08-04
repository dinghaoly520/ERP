import type {
  ProjectDetailAnalysis,
  ProjectManagementAttachment,
  ProjectManagementItem,
  ProjectWorkflowStageKey,
  ProcurementMethod,
  FieldCandidate,
  FieldComparison,
} from '@/lib/types/project-management';

// Use /api proxy by default so LAN clients do not resolve localhost on their own machine.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

export type ProjectAttribution = {
  name: string;
  contractNumber: string | null;
  usageCount: number;
};

export type DemandFields = {
  requesterName?: string;
  requesterDepartment?: string;
  procurementTitle?: string;
  procurementCategory?: string;
  budgetAmount?: number;
  projectReason?: string;
  supplierRequirements?: string;
  demandProject?: string;
  demandContractNumber?: string;
  initiationDate?: string;
  procurementOrganizationForm?: string;
  isAnnualBudget?: boolean;
};

export type InitiationFields = {
  requesterName: string;
  requesterDepartment: string;
  procurementTitle: string;
  procurementMethod: ProcurementMethod;
  procurementCategory: string;
  budgetAmount: number;
  projectReason: string;
  supplierRequirements: string;
  hasProcurementDemand: boolean;
  demandAttachment?: ProjectManagementAttachment;
  initiationAttachment?: ProjectManagementAttachment;
  demandProject?: string;
  demandContractNumber?: string;
  initiationDate?: string;
  procurementOrganizationForm?: string;
  isAnnualBudget?: boolean;
  createdById?: string;
};

function parseErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    const normalized = error.message.trim().toLowerCase();
    if (normalized === 'the string did not match the expected pattern.') {
      return '上传文件失败，请重新选择 PDF 文件后重试。';
    }
    if (normalized === 'internal server error') {
      return '服务处理失败，请稍后重试。';
    }
    return error.message;
  }

  return '请求失败，请稍后重试。';
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallbackMessage = '请求失败，请稍后重试。';
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      try {
        const body = (await response.json()) as { message?: string | string[] };
        const message = Array.isArray(body.message) ? body.message[0] : body.message;
        throw new Error(message || fallbackMessage);
      } catch (error) {
        throw new Error(parseErrorMessage(error) || fallbackMessage);
      }
    }

    const text = (await response.text()).trim();
    if (text === 'Internal Server Error') {
      throw new Error('服务处理失败，请稍后重试。');
    }

    throw new Error(text || fallbackMessage);
  }

  return response.json() as Promise<T>;
}

export function buildProjectManagementCreatePayload(fields: InitiationFields) {
  const { demandProject, demandContractNumber, ...rest } = fields;
  const hasDemandMeta = demandProject != null || demandContractNumber != null;
  return {
    ...rest,
    ...(hasDemandMeta
      ? { demandFields: { demandProject, demandContractNumber } }
      : {}),
  };
}

export async function fetchProjectManagementList(status?: 'ACTIVE' | 'ARCHIVED' | 'RECYCLED') {
  const query = status ? `?status=${status}` : '';
  const response = await fetch(`${API_BASE}/project-management${query}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<ProjectManagementItem[]>(response);
}

/** 流标后再次采购：按采购方式在定标后插入新一轮"采购文件→定标"阶段 */
export async function reprocProject(projectId: string) {
  const response = await fetch(`${API_BASE}/project-management/${projectId}/reproc`, {
    method: 'POST',
    credentials: 'include',
  });
  return parseJsonResponse<{ round: number; inserted: number }>(response);
}

/** 从已上传的采购文件重新提取 projectOverview / bidOpeningTime / documentAcquireTime */
export async function extractTenderFields(projectId: string, field?: string) {
  const qs = field ? `?field=${field}` : '';
  const response = await fetch(`${API_BASE}/project-management/${projectId}/extract-tender-fields${qs}`, {
    method: 'POST',
    credentials: 'include',
  });
  return parseJsonResponse<Record<string, string | null>>(response);
}

export async function extractInitiationFields(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/project-management/extract-initiation`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  return parseJsonResponse<{
    fields: Omit<InitiationFields, 'initiationAttachment' | 'hasProcurementDemand' | 'demandAttachment' | 'procurementMethod'>;
    attachment: ProjectManagementAttachment;
    extractedText: string;
  }>(response);
}

export async function extractDemandFields(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/project-management/extract-demand`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  return parseJsonResponse<{
    fields: DemandFields;
    attachment: ProjectManagementAttachment;
    extractedText: string;
  }>(response);
}

export async function aiIdentifyField(fieldName: string, documentText: string, topK?: number) {
  const response = await fetch(`${API_BASE}/project-management/ai-identify-field`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fieldName, documentText, topK }),
  });

  return parseJsonResponse<FieldCandidate[]>(response);
}

export type BudgetReferenceAdjustment = {
  factor: number; // 小数，如 0.05 表示 +5%、-0.03 表示 -3%
  reason: string;
};

// ── 方法 C：置信分层估算新增类型 ──
export type BudgetEstimatedLine = {
  name: string;
  unit: string | null;
  qty: number | null;
  match: 'exact' | 'contained' | 'budget' | 'none';
  catalogName: string | null;
  specification: string | null;
  unitPrice: number | null;
  lineLow: number | null;
  lineHigh: number | null;
  lineTotal: number | null;
  specWarning: string | null;
};

export type BudgetHistoricalBand = { min: number; max: number; median: number; count: number };

export type BudgetReferenceLineInput = {
  name: string;
  specification?: string | null;
  unit?: string | null;
  qty?: number | null;
};

export type BudgetReferenceItem = {
  title: string;
  category: string | null;
  amount: number;
  contractAmount: number | null;
  date: string;
  method: string;
  source: string;
  heuristicScore: number; // 启发式相似度 [0,1]
  aiRelevance: number; // AI 业务相关度 [0,1]
  relevance: number; // 综合相关度 [0,1]
  weight: number; // 归一化权重 = relevance² / Σ
  contribution: number; // 对主锚点的贡献金额
  aiReason: string; // AI 给的打分理由
};

export type BudgetReferencePricing = {
  weightedContractPrice: number | null; // 主锚点：加权合同价（可空）
  weightedBudgetPrice: number; // 辅锚点：加权预算价
  anchor: 'contract' | 'budget';
  anchorPrice: number;
  adjustmentFactor: number; // 最终调整因子（已夹紧到 [0.85,1.20]）
  adjustments: BudgetReferenceAdjustment[];
  clamped: boolean; // 因子是否触达上下限被夹紧
  suggestedBudget: number; // 最终建议价 = anchorPrice × adjustmentFactor
};

export type BudgetReferenceResult = {
  hasReference: boolean;
  message: string;
  references: BudgetReferenceItem[];
  pricing: BudgetReferencePricing | null;
  suggestedBudget: number | null; // 兼容旧 UI；= pricing?.suggestedBudget（仅 Tier 1/2 有值）
  analysis: string | null;
  confidence: number;
  confidenceReason: string;
  statistics?: {
    average: number;
    max: number;
    min: number;
    count: number;
    avgContract?: number | null;
  } | null;
  // ── 方法 C 新增 ──
  tier?: 1 | 2 | 3 | 4;
  tierLabel?: string;
  rangeLow?: number | null;
  rangeHigh?: number | null;
  lines?: BudgetEstimatedLine[];
  historicalBand?: BudgetHistoricalBand | null;
};

export async function analyzeBudgetReference(data: {
  procurementTitle: string;
  procurementCategory?: string;
  procurementType?: string;
  projectReason?: string;
  supplierRequirements?: string;
  lines?: BudgetReferenceLineInput[];
  budgetListId?: string;
}): Promise<BudgetReferenceResult> {
  const response = await fetch(`${API_BASE}/project-management/analyze-budget-reference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });

  return parseJsonResponse<BudgetReferenceResult>(response);
}

// AI 优化立项事由 / 供方要求 —— 基于已上传的需求表与立项表原文
export async function polishInitiationField(data: {
  field: 'projectReason' | 'supplierRequirements';
  text: string;
  demandDocText?: string;
  initiationDocText?: string;
  projectContext?: { title?: string; category?: string; method?: string };
}): Promise<{ polished: string }> {
  const response = await fetch(`${API_BASE}/ai/polish-initiation-field`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  return parseJsonResponse<{ polished: string }>(response);
}

export function compareFields(
  demandFields: DemandFields,
  initiationFields: {
    requesterName?: string;
    requesterDepartment?: string;
    procurementTitle?: string;
    procurementCategory?: string;
    budgetAmount?: number;
    projectReason?: string;
    supplierRequirements?: string;
    initiationDate?: string;
    demandProject?: string;
    demandContractNumber?: string;
  },
): FieldComparison[] {
  const comparisons: FieldComparison[] = [];

  const fieldMappings: Array<{ key: string; label: string }> = [
    { key: 'requesterName', label: '需求申请人' },
    { key: 'requesterDepartment', label: '需求部门' },
    { key: 'procurementTitle', label: '采购事项名称' },
    { key: 'procurementCategory', label: '采购类别' },
    { key: 'budgetAmount', label: '预算金额' },
    { key: 'projectReason', label: '立项事由' },
    { key: 'supplierRequirements', label: '对供方的主要要求' },
    { key: 'initiationDate', label: '立项时间' },
    { key: 'demandProject', label: '项目归属' },
  ];

  for (const { key, label } of fieldMappings) {
    const demandValue = String(demandFields[key as keyof DemandFields] ?? '');
    const initiationValue = String(initiationFields[key as keyof typeof initiationFields] ?? '');
    const hasConflict = Boolean(demandValue && initiationValue && demandValue !== initiationValue);

    comparisons.push({
      fieldName: key,
      label,
      demandValue: demandValue || undefined,
      initiationValue: initiationValue || undefined,
      selectedValue: initiationValue || demandValue,
      hasConflict,
    });
  }

  return comparisons;
}

export async function createProjectManagementItem(fields: InitiationFields) {
  const response = await fetch(`${API_BASE}/project-management`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildProjectManagementCreatePayload(fields)),
  });

  return parseJsonResponse<ProjectManagementItem>(response);
}

export async function updateProjectStage(
  projectId: string,
  stageKey: ProjectWorkflowStageKey,
  payload: { status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'; note?: string },
) {
  const response = await fetch(`${API_BASE}/project-management/${projectId}/stages/${stageKey}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse(response);
}

export type ExtractedInfo = {
  initiationDate: string | null;
  expertInfo: string | null;
  biddingUnits: string | null;
  awardedSupplier: string | null;
  contractAmount: number | null;
  contractNumber: string | null;
  projectOverview: string | null;
  bidOpeningTime: string | null;
  documentAcquireTime: string | null;
  invitedSuppliers: string | null;
  paymentPerformance: string | null;
};

export type UploadStageAttachmentResult = ProjectManagementAttachment & {
  extractedInfo: ExtractedInfo | null;
};

export async function uploadProjectStageAttachment(
  projectId: string,
  stageKey: ProjectWorkflowStageKey,
  file: File,
) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/project-management/${projectId}/stages/${stageKey}/attachments`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  return parseJsonResponse<UploadStageAttachmentResult>(response);
}

export async function moveProjectToRecycleBin(projectId: string) {
  const response = await fetch(`${API_BASE}/project-management/${projectId}/recycle`, {
    method: 'POST',
    credentials: 'include',
  });

  return parseJsonResponse<ProjectManagementItem>(response);
}

export async function restoreProjectFromRecycleBin(projectId: string) {
  const response = await fetch(`${API_BASE}/project-management/${projectId}/restore`, {
    method: 'POST',
    credentials: 'include',
  });

  return parseJsonResponse<ProjectManagementItem>(response);
}

export async function deleteProjectPermanently(projectId: string) {
  const response = await fetch(`${API_BASE}/project-management/${projectId}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  return parseJsonResponse<{ success: true }>(response);
}

export async function analyzeProjectManagementItem(
  projectId: string,
  stageKey?: ProjectWorkflowStageKey,
) {
  const search = stageKey ? `?stageKey=${stageKey}` : '';
  const response = await fetch(`${API_BASE}/project-management/${projectId}/analyze${search}`, {
    method: 'POST',
    credentials: 'include',
  });

  return parseJsonResponse<ProjectDetailAnalysis>(response);
}

export async function completeProjectManagementItem(projectId: string, allowIncomplete?: boolean) {
  const response = await fetch(`${API_BASE}/project-management/${projectId}/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmedCompleted: true, allowIncomplete: !!allowIncomplete }),
  });

  return parseJsonResponse<ProjectManagementItem>(response);
}

export async function deleteProjectAttachment(
  projectId: string,
  attachmentId: string,
) {
  const response = await fetch(`${API_BASE}/project-management/${projectId}/attachments/${attachmentId}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  return parseJsonResponse<{ success: true }>(response);
}

export type ExtractedInfoPayload = {
  title?: string;
  initiationDate?: string;
  evaluationMethod?: string;
  expertInfo?: string;
  biddingUnits?: string;
  awardedSupplier?: string;
  contractAmount?: number;
  demandProject?: string;
  demandContractNumber?: string;
  contractNumber?: string;
  departmentNumber?: string;
  projectOverview?: string;
  bidOpeningTime?: string;
  documentAcquireTime?: string;
  invitedSuppliers?: string;
  paymentPerformance?: string;
  requesterName?: string;
  requesterDepartment?: string;
  procurementMethod?: string;
  procurementCategory?: string;
  budgetAmount?: number;
  projectReason?: string;
  supplierRequirements?: string;
};

export async function updateProjectExtractedInfo(
  projectId: string,
  payload: ExtractedInfoPayload,
) {
  const response = await fetch(`${API_BASE}/project-management/${projectId}/extracted-info`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse<ProjectManagementItem>(response);
}

export async function refreshProjectSummary(projectId: string) {
  const response = await fetch(`${API_BASE}/project-management/${projectId}/refresh-summary`, {
    method: 'POST',
    credentials: 'include',
  });

  return parseJsonResponse<{ summary: string }>(response);
}

export type ComplianceAuditResult = {
  checkpoint: string;
  dimension: string;
  verdict: '通过' | '警告' | '违规';
  evidence: string;
  suggestion: string;
  regulationRef: string;
};

export type ComplianceAuditResponse = {
  results: ComplianceAuditResult[];
  summary: string;
};

export async function auditStageCompliance(
  projectId: string,
  stageKey?: string,
  force?: boolean,
): Promise<ComplianceAuditResponse> {
  const params = new URLSearchParams();
  if (stageKey) params.set('stageKey', stageKey);
  if (force) params.set('force', 'true');
  const qs = params.toString();
  const response = await fetch(`${API_BASE}/project-management/${projectId}/audit-compliance${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    credentials: 'include',
  });

  return parseJsonResponse<ComplianceAuditResponse>(response);
}

/** AI 提取并优化"申请立项事由 / 对供方的主要要求"，仅返回优化文本，不写库（由调用方填编辑态、用户确认后保存）。 */
export async function optimizeInitiationFields(
  projectId: string,
): Promise<{ projectReason: string; supplierRequirements: string }> {
  const response = await fetch(`${API_BASE}/project-management/${projectId}/optimize-initiation`, {
    method: 'POST',
    credentials: 'include',
  });

  return parseJsonResponse<{ projectReason: string; supplierRequirements: string }>(response);
}

export async function fetchProjectAttributions(): Promise<ProjectAttribution[]> {
  const response = await fetch(`${API_BASE}/project-management/project-attributions`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<ProjectAttribution[]>(response);
}

/** 根据项目管理项 ID 获取对应的开评标项目（用于专家抽取等场景直接锁定项目） */
export async function getPmBidProject(
  pmId: string,
  round?: number,
): Promise<{ id: string; projectCode: string; name: string; stage: string }> {
  const params = round != null ? `?round=${round}` : '';
  const response = await fetch(`${API_BASE}/project-management/${pmId}/bid-project${params}`, {
    credentials: 'include',
  });
  return parseJsonResponse(response);
}
