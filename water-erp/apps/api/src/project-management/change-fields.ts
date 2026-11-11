/** 变更体系字段白名单与阶段闸门（2026-11-11 spec §2）。
 *  例外（2026-11-11 用户裁定）：供应商名单（biddingUnits/invitedSuppliers）、专家名单
 *  不纳入变更范畴——AI 识别可能不准需随时人工维护，走既有邀请/抽取流程卡。 */

export type ChangeFieldDef = {
  field: string;
  label: string;
  kind: 'text' | 'number' | 'datetime';
  /** 写入目标表：PMI=ProjectManagementItem；BID=BidProject（当前轮未归档行） */
  target: 'PMI' | 'BID';
};

/** 禁入白名单的字段（点名字段+提示去向；新名单字段加入这里） */
export const FORBIDDEN_FIELDS = ['biddingUnits', 'invitedSuppliers', 'experts'] as const;

export const CHANGE_FIELD_GROUPS = [
  {
    key: 'basic',
    label: '基本信息',
    stageKey: 'INITIATION',
    fields: [
      { field: 'title', label: '项目名称', kind: 'text', target: 'PMI' },
      { field: 'procurementCategory', label: '采购类别', kind: 'text', target: 'PMI' },
      { field: 'budgetAmount', label: '预算金额', kind: 'number', target: 'PMI' },
      { field: 'requesterName', label: '需求人', kind: 'text', target: 'PMI' },
      { field: 'requesterDepartment', label: '需求部门', kind: 'text', target: 'PMI' },
      { field: 'projectOverview', label: '项目概况', kind: 'text', target: 'PMI' },
      { field: 'initiationDate', label: '立项日期', kind: 'text', target: 'PMI' },
      { field: 'evaluationMethod', label: '评审办法', kind: 'text', target: 'PMI' },
      { field: 'demandProject', label: '需求项目', kind: 'text', target: 'PMI' },
    ],
  },
  {
    key: 'document',
    label: '采购文件',
    stageKey: 'TENDER_DOCUMENT',
    fields: [
      { field: 'qualification', label: '资格要求', kind: 'text', target: 'BID' },
      { field: 'scope', label: '供货范围', kind: 'text', target: 'BID' },
      { field: 'qualityRequirement', label: '质量要求', kind: 'text', target: 'BID' },
    ],
  },
  {
    key: 'notice',
    label: '公告与时间',
    stageKey: 'TENDER_DOCUMENT',
    fields: [
      { field: 'bidOpeningTime', label: '开标时间', kind: 'datetime', target: 'PMI' },
      { field: 'documentAcquireTime', label: '文件获取截止', kind: 'text', target: 'PMI' },
    ],
  },
] as const satisfies ReadonlyArray<{
  key: 'basic' | 'document' | 'notice';
  label: string;
  stageKey: string;
  fields: readonly ChangeFieldDef[];
}>;

/** 全阶段序（与 web PROCUREMENT_METHOD_STAGES 共同超集——判定只用相对顺序，方式差异不影响） */
const STAGE_ORDER = [
  'PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT', 'PUBLIC_ANNOUNCEMENT', 'SUPPLIER_INVITATION',
  'EXPERT_SELECTION', 'BID_EVALUATION', 'AWARD_DECISION', 'CONTRACT', 'DIRECT_PURCHASE_FILING',
];

/** 组是否解锁：当前阶段序 ≥ 组锚点序。currentStage 空（项目无阶段指针）视为刚立项——仅 basic 组可改。 */
export function stageReached(allStages: string[], currentStage: string | null, groupStageKey: string): boolean {
  const order = allStages.length ? allStages : STAGE_ORDER;
  const cur = currentStage ? order.indexOf(currentStage) : order.indexOf('INITIATION');
  const need = order.indexOf(groupStageKey);
  return cur >= 0 && need >= 0 && cur >= need;
}

/** 字段 → 所属组（含锚点/标签，供闸门与 diff 记录用）；白名单外返回 undefined */
export function findFieldGroup(field: string) {
  return CHANGE_FIELD_GROUPS.find(g => g.fields.some(f => f.field === field));
}
