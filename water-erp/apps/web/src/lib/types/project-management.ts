export const PROCUREMENT_METHODS = [
  '谈判采购',
  '竞价采购',
  '直接采购',
  '邀请招标',
  '询比采购',
] as const;

export type ProcurementMethod = (typeof PROCUREMENT_METHODS)[number];

export const PROCUREMENT_CATEGORY_OPTIONS: string[] = [
  '生产技术类采购',
  'EPC项目采购',
  'EPC管理采购',
  '公用集中采购',
  '科技研发类采购',
  '信息化采购',
  '其他',
];

export type StageConfig = {
  key: string;
  label: string;
};

export const PROCUREMENT_METHOD_STAGES: Record<ProcurementMethod, StageConfig[]> = {
  '谈判采购': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'SUPPLIER_INVITATION', label: '供应商邀请' },
    { key: 'EXPERT_SELECTION', label: '专家选取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '竞价采购': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '直接采购': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示(供应商邀请)' },
    { key: 'EXPERT_SELECTION', label: '专家选取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '邀请招标': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '招标文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '询比采购': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
    { key: 'EXPERT_SELECTION', label: '专家选取' },
    { key: 'BID_EVALUATION', label: '开标评标' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
};

export const PROJECT_WORKFLOW_STAGES_ALL: StageConfig[] = [
  { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
  { key: 'INITIATION', label: '采购立项' },
  { key: 'TENDER_DOCUMENT', label: '采购文件' },
  { key: 'SUPPLIER_INVITATION', label: '供应商邀请' },
  { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
  { key: 'EXPERT_SELECTION', label: '专家抽取' },
  { key: 'BID_EVALUATION', label: '开标评标' },
  { key: 'AWARD_DECISION', label: '定标' },
  { key: 'CONTRACT', label: '合同' },
];

export type ProjectWorkflowStageKey = (typeof PROJECT_WORKFLOW_STAGES_ALL)[number]['key'];

// Legacy stages for backward compatibility
export const PROJECT_WORKFLOW_STAGES = [
  { key: 'INITIATION', label: '采购立项' },
  { key: 'TENDER_DOCUMENT', label: '采购文件' },
  { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
  { key: 'SUPPLIER_INVITATION', label: '供应商邀请' },
  { key: 'EXPERT_SELECTION', label: '专家抽取' },
  { key: 'BID_EVALUATION', label: '开标评标' },
  { key: 'AWARD_DECISION', label: '定标' },
  { key: 'CONTRACT', label: '合同' },
] as const;

export type ProjectStageStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export const PROJECT_STAGE_STATUS_LABELS: Record<ProjectStageStatus, string> = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
};

export type ProjectManagementAttachment = {
  id?: string;
  fileName: string;
  objectKey: string;
  mimeType: string;
  fileSize: number;
  uploadedById?: string;
  createdAt?: string;
};

export type ProjectManagementStage = {
  id: string;
  stageKey: ProjectWorkflowStageKey;
  stageName: string;
  stageOrder: number;
  round?: number | null;
  status: ProjectStageStatus;
  note?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  attachments: ProjectManagementAttachment[];
};

export type ProjectManagementItemStatus = 'ACTIVE' | 'ARCHIVED' | 'RECYCLED';

export const PROJECT_MANAGEMENT_STATUS_LABELS: Record<ProjectManagementItemStatus, string> = {
  ACTIVE: '进行中',
  ARCHIVED: '已归档',
  RECYCLED: '已移除',
};

export type ProjectFileAnalysis = {
  objectKey: string;
  fileName: string;
  stageMatch: string;
  contentSummary: string;
};

export type ProjectDetailAnalysis = {
  summary: {
    stageMatch: string;
    contentSummary: string;
  };
  fileAnalyses: ProjectFileAnalysis[];
};

export type ProjectManagementItem = {
  id: string;
  title: string;
  requesterName: string;
  requesterDepartment: string;
  procurementMethod: ProcurementMethod;
  procurementCategory: string;
  budgetAmount: number;
  projectReason: string;
  supplierRequirements: string;
  currentStage: ProjectWorkflowStageKey;
  currentRound?: number | null;
  status: ProjectManagementItemStatus;
  archivedProcurementRoundId?: string | null;
  // 需求表独有字段
  demandProject?: string | null;
  demandContractNumber?: string | null;
  contractNumber?: string | null;
  departmentNumber?: string | null;
  projectCode?: string | null;
  // 提取的关键信息（分步骤展示）
  initiationDate?: string | null;
  projectOverview?: string | null;
  bidOpeningTime?: string | null;
  invitedSuppliers?: string | null;
  paymentPerformance?: string | null;
  expertInfo?: string | null;
  biddingUnits?: string | null;
  awardedSupplier?: string | null;
  contractAmount?: number | null;
  archivedAt?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  stages: ProjectManagementStage[];
};

// Field comparison types
export type FieldComparison = {
  fieldName: string;
  label: string;
  initiationValue?: string;
  demandValue?: string;
  selectedValue?: string;
  hasConflict: boolean;
};

// AI identify field types
export type FieldCandidate = {
  value: string;
  confidence: number;
  location: string;
};

// Helper functions
export function needsInitiationStage(_method: ProcurementMethod): boolean {
  return true; // 所有采购方式均需要立项
}

export function needsPublicAnnouncementStage(method: ProcurementMethod): boolean {
  return ['竞价采购', '直接采购', '邀请招标', '询比采购'].includes(method);
}

export function getStagesForMethod(method: ProcurementMethod): StageConfig[] {
  return PROCUREMENT_METHOD_STAGES[method] || PROCUREMENT_METHOD_STAGES['谈判采购'];
}
