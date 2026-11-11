/** 变更体系字段白名单与阶段闸门（2026-11-11 spec §2）。
 *  例外（2026-11-11 用户裁定）：供应商名单（biddingUnits/invitedSuppliers）、专家名单
 *  不纳入变更范畴——AI 识别可能不准需随时人工维护，走既有邀请/抽取流程卡。 */

export type ChangeFieldDef = {
  field: string;
  label: string;
  kind: 'text' | 'number' | 'datetime';
  /** 写入目标：PMI=ProjectManagementItem（2026-11-11 用户裁定：变更范围=项目基本信息，采购文件域字段不入白名单） */
  target: 'PMI';
};

/** 禁入白名单的字段（点名字段+提示去向；新名单字段加入这里） */
export const FORBIDDEN_FIELDS = ['biddingUnits', 'invitedSuppliers', 'experts'] as const;

export const CHANGE_FIELD_GROUPS = [
  {
    key: 'basic',
    zone: 'pre',
    label: '基本信息',
    // 2026-11-12 用户裁定：基本信息自建档（需求阶段）即存在且可改——锚点放宽到
    // PROCUREMENT_DEMAND，任何阶段指针下均解锁（标前分区闸仍兜底开标后锁死）
    stageKey: 'PROCUREMENT_DEMAND',
    fields: [
      { field: 'title', label: '项目名称', kind: 'text', target: 'PMI' },
      { field: 'procurementCategory', label: '采购类别', kind: 'text', target: 'PMI' },
      { field: 'procurementMethod', label: '采购方式', kind: 'text', target: 'PMI' },
      { field: 'budgetAmount', label: '预算金额', kind: 'number', target: 'PMI' },
      { field: 'requesterName', label: '需求人', kind: 'text', target: 'PMI' },
      { field: 'requesterDepartment', label: '需求部门', kind: 'text', target: 'PMI' },
      { field: 'projectOverview', label: '项目概况', kind: 'text', target: 'PMI' },
      { field: 'initiationDate', label: '立项日期', kind: 'text', target: 'PMI' },
      { field: 'demandProject', label: '归属项目', kind: 'text', target: 'PMI' },
      { field: 'projectReason', label: '申请立项事由', kind: 'text', target: 'PMI' },
      { field: 'supplierRequirements', label: '对供方的主要要求', kind: 'text', target: 'PMI' },
    ],
  },
  {
    key: 'notice',
    zone: 'pre',
    label: '采购文件',
    stageKey: 'TENDER_DOCUMENT',
    fields: [
      { field: 'bidOpeningTime', label: '开标时间', kind: 'datetime', target: 'PMI' },
      { field: 'documentAcquireTime', label: '文件获取截止', kind: 'text', target: 'PMI' },
    ],
  },
  {
    key: 'award',
    zone: 'post',
    label: '定标',
    stageKey: 'AWARD_DECISION',
    fields: [
      { field: 'awardedSupplier', label: '中标供应商', kind: 'text', target: 'PMI' },
    ],
  },
  {
    key: 'contract',
    zone: 'post',
    label: '合同',
    stageKey: 'CONTRACT',
    fields: [
      { field: 'contractNumber', label: '合同编号', kind: 'text', target: 'PMI' },
      { field: 'contractAmount', label: '合同金额', kind: 'number', target: 'PMI' },
      { field: 'paymentPerformance', label: '履约情况', kind: 'text', target: 'PMI' },
    ],
  },
] as const satisfies ReadonlyArray<{
  key: 'basic' | 'award' | 'contract' | 'notice';
  /** 标段分区（2026-11-12 用户裁定）：pre=标前（开标确认后锁死）；post=标后（开标确认前锁死） */
  zone: 'pre' | 'post';
  label: string;
  stageKey: string;
  fields: readonly ChangeFieldDef[];
}>;

/** 全阶段序（与 web PROCUREMENT_METHOD_STAGES 共同超集——判定只用相对顺序，方式差异不影响） */
const STAGE_ORDER = [
  'PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT', 'PUBLIC_ANNOUNCEMENT', 'SUPPLIER_INVITATION',
  'EXPERT_SELECTION', 'BID_EVALUATION', 'AWARD_DECISION', 'CONTRACT', 'DIRECT_PURCHASE_FILING',
];

/** 组是否解锁：当前阶段序 ≥ 组锚点序。currentStage 空（项目无阶段指针）视为刚立项——仅 basic 组可改。
 *  恒按 STAGE_ORDER 超集算相对序（与 web 侧同口径），不按项目自身阶段链——链会因
 *  ①include 未排序（DB 返回字母序，2026-11-12 SWHI-JJ-2026102302 实录：EXPERT_SELECTION
 *  被判在 TENDER_DOCUMENT 之前）②存量方式链缺锚点键（旧版直接采购链无 TENDER_DOCUMENT，
 *  indexOf 得 -1 恒锁）而失真。 */
export function stageReached(currentStage: string | null, groupStageKey: string): boolean {
  const cur = currentStage ? STAGE_ORDER.indexOf(currentStage) : STAGE_ORDER.indexOf('INITIATION');
  const need = STAGE_ORDER.indexOf(groupStageKey);
  return cur >= 0 && need >= 0 && cur >= need;
}

/** 字段 → 所属组（含锚点/标签，供闸门与 diff 记录用）；白名单外返回 undefined */
export function findFieldGroup(field: string) {
  return CHANGE_FIELD_GROUPS.find(g => g.fields.some(f => f.field === field));
}
