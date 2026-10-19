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

/** 投标侧收口闸的阶段集（2026-10-19）：开标评标及其后（定标/合同/直接采购备案表）——
 *  这些阶段完成前，同轮关联 BidProject 必须已终局（ARCHIVED/ABORTED）；
 *  正门=「开标确认」面板完整归档（archiveAll→syncPmStage 自动置 COMPLETED 并解锁定标）。 */
export const BID_TAIL_STAGE_KEYS = new Set(
  PROJECT_WORKFLOW_STAGES
    .slice(PROJECT_WORKFLOW_STAGES.findIndex((s) => s.key === 'BID_EVALUATION'))
    .map((s) => s.key),
);

export type ProjectWorkflowStageKey =
  (typeof PROJECT_WORKFLOW_STAGES)[number]['key'];
