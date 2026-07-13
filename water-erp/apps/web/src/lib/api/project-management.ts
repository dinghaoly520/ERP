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

export type BudgetReferenceResult = {
  hasReference: boolean;
  message: string;
  references: Array<{
    title: string;
    category: string | null;
    amount: number;
    contractAmount: number | null;
    date: string;
    method: string;
    source: string;
  }>;
  suggestedBudget: number | null;
  analysis: string | null;
  confidence: number;
  statistics?: {
    average: number;
    max: number;
    min: number;
    count: number;
  };
};

export async function analyzeBudgetReference(data: {
  procurementTitle: string;
  procurementCategory?: string;
  projectReason?: string;
  supplierRequirements?: string;
}): Promise<BudgetReferenceResult> {
  const response = await fetch(`${API_BASE}/project-management/analyze-budget-reference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });

  return parseJsonResponse<BudgetReferenceResult>(response);
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

export async function completeProjectManagementItem(projectId: string) {
  const response = await fetch(`${API_BASE}/project-management/${projectId}/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmedCompleted: true }),
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
  initiationDate?: string;
  expertInfo?: string;
  biddingUnits?: string;
  awardedSupplier?: string;
  contractAmount?: number;
  contractNumber?: string;
  departmentNumber?: string;
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
): Promise<ComplianceAuditResponse> {
  const params = stageKey ? `?stageKey=${stageKey}` : '';
  const response = await fetch(`${API_BASE}/project-management/${projectId}/audit-compliance${params}`, {
    method: 'POST',
    credentials: 'include',
  });

  return parseJsonResponse<ComplianceAuditResponse>(response);
}

export async function fetchProjectAttributions(): Promise<ProjectAttribution[]> {
  const response = await fetch(`${API_BASE}/project-management/project-attributions`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<ProjectAttribution[]>(response);
}
