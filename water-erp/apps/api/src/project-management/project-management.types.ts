export const PROJECT_WORKFLOW_STAGES = [
  { key: 'PROCUREMENT_DEMAND', label: '采购需求' },
  { key: 'INITIATION', label: '采购立项' },
  { key: 'TENDER_DOCUMENT', label: '采购文件' },
  { key: 'SUPPLIER_INVITATION', label: '供应商邀请' },
  { key: 'PUBLIC_ANNOUNCEMENT', label: '采购公告公示' },
  { key: 'EXPERT_SELECTION', label: '专家抽取' },
  { key: 'BID_EVALUATION', label: '开标评标' },
  { key: 'AWARD_DECISION', label: '定标' },
  { key: 'CONTRACT', label: '合同' },
  // 直接采购专属（09 备案表）：仅直接采购模板包含；放全集只为 StageKey 联合类型覆盖
  { key: 'DIRECT_PURCHASE_FILING', label: '直接采购备案表' },
] as const;

export const LOCKED_STAGES = new Set(
  PROJECT_WORKFLOW_STAGES.filter((s) => (s as { locked?: boolean }).locked).map((s) => s.key),
);

export type ProjectWorkflowStageKey =
  (typeof PROJECT_WORKFLOW_STAGES)[number]['key'];
