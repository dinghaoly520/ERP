export const PROJECT_WORKFLOW_STAGES = [
  { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
  { key: 'INITIATION', label: '项目立项' },
  { key: 'TENDER_DOCUMENT', label: '采购文件' },
  { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公示' },
  { key: 'EXPERT_SELECTION', label: '专家抽取' },
  { key: 'BID_EVALUATION', label: '评标过程' },
  { key: 'AWARD_DECISION', label: '定标' },
  { key: 'CONTRACT', label: '合同' },
] as const;

export const LOCKED_STAGES = new Set(
  PROJECT_WORKFLOW_STAGES.filter((s) => (s as { locked?: boolean }).locked).map((s) => s.key),
);

export type ProjectWorkflowStageKey =
  (typeof PROJECT_WORKFLOW_STAGES)[number]['key'];
