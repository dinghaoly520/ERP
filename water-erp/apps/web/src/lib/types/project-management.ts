export const PROCUREMENT_METHODS = [
  '竞争性谈判',
  '内部竞标竞价',
  '单源直接采购',
  '邀请招标',
  '续约谈判',
  '询价采购',
  '直接委托',
  '小额采购',
] as const;

export type ProcurementMethod = (typeof PROCUREMENT_METHODS)[number];

export type StageConfig = {
  key: string;
  label: string;
};

export const PROCUREMENT_METHOD_STAGES: Record<ProcurementMethod, StageConfig[]> = {
  '竞争性谈判': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '评标过程' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '内部竞标竞价': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公示' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '评标过程' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '单源直接采购': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公示' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '评标过程' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '邀请招标': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公示' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '评标过程' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '续约谈判': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '评标过程' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '询价采购': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'TENDER_DOCUMENT', label: '采购文件' },
    { key: 'EXPERT_SELECTION', label: '专家抽取' },
    { key: 'BID_EVALUATION', label: '评标过程' },
    { key: 'AWARD_DECISION', label: '定标' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '直接委托': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'INITIATION', label: '采购立项' },
    { key: 'CONTRACT', label: '合同' },
  ],
  '小额采购': [
    { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
    { key: 'CONTRACT', label: '合同' },
  ],
};

export const PROJECT_WORKFLOW_STAGES_ALL: StageConfig[] = [
  { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
  { key: 'INITIATION', label: '采购立项' },
  { key: 'TENDER_DOCUMENT', label: '采购文件' },
  { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公示' },
  { key: 'EXPERT_SELECTION', label: '专家抽取' },
  { key: 'BID_EVALUATION', label: '评标过程' },
  { key: 'AWARD_DECISION', label: '定标' },
  { key: 'CONTRACT', label: '合同' },
];

export type ProjectWorkflowStageKey = (typeof PROJECT_WORKFLOW_STAGES_ALL)[number]['key'];

// Legacy stages for backward compatibility
export const PROJECT_WORKFLOW_STAGES = [
  { key: 'INITIATION', label: '项目立项' },
  { key: 'TENDER_DOCUMENT', label: '采购文件' },
  { key: 'EXPERT_SELECTION', label: '专家抽取' },
  { key: 'BID_EVALUATION', label: '评标过程' },
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
  status: ProjectManagementItemStatus;
  archivedProcurementRoundId?: string | null;
  // 需求表独有字段
  demandProject?: string | null;
  demandContractNumber?: string | null;
  contractNumber?: string | null;
  departmentNumber?: string | null;
  // 提取的关键信息
  initiationDate?: string | null;
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
export function needsInitiationStage(method: ProcurementMethod): boolean {
  return method !== '小额采购';
}

export function needsPublicAnnouncementStage(method: ProcurementMethod): boolean {
  return ['内部竞标竞价', '单源直接采购', '邀请招标'].includes(method);
}

export function getStagesForMethod(method: ProcurementMethod): StageConfig[] {
  return PROCUREMENT_METHOD_STAGES[method] || PROCUREMENT_METHOD_STAGES['竞争性谈判'];
}
