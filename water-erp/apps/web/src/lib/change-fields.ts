import { PROCUREMENT_CATEGORY_OPTIONS } from '@/lib/types/project-management';
/**
 * 变更字段白名单（前端镜像）——与 apps/api/src/project-management/change-fields.ts 同源，
 * 改动必须两端同步（后端为权威闸，前端仅作表单分组/禁用展示）。
 * 2026-11-11 变更体系 spec §2：基本信息全部纳入；供应商/专家名单例外走流程卡维护。
 */

export type ChangeFieldDef = {
  field: string;
  label: string;
  kind: 'text' | 'number' | 'datetime';
  target: 'PMI' | 'BID';
  /** 下拉选项（2026-11-11 用户裁定：采购类别用下拉）——仅前端表单渲染用，后端闸不感知 */
  options?: string[];
}

export type ChangeFieldGroup = {
  key: 'basic' | 'document' | 'notice';
  label: string;
  stageKey: string;
  stageLabel: string;
  fields: ChangeFieldDef[];
};

export const CHANGE_FIELD_GROUPS: ChangeFieldGroup[] = [
  {
    key: 'basic',
    label: '基本信息',
    stageKey: 'INITIATION',
    stageLabel: '采购立项',
    fields: [
      { field: 'title', label: '项目名称', kind: 'text', target: 'PMI' },
      { field: 'procurementCategory', label: '采购类别', kind: 'text', target: 'PMI', options: PROCUREMENT_CATEGORY_OPTIONS },
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
    stageLabel: '采购文件',
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
    stageLabel: '采购文件',
    fields: [
      { field: 'bidOpeningTime', label: '开标时间', kind: 'datetime', target: 'PMI' },
      { field: 'documentAcquireTime', label: '文件获取截止', kind: 'text', target: 'PMI' },
    ],
  },
];

const STAGE_ORDER = [
  'PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT', 'PUBLIC_ANNOUNCEMENT', 'SUPPLIER_INVITATION',
  'EXPERT_SELECTION', 'BID_EVALUATION', 'AWARD_DECISION', 'CONTRACT', 'DIRECT_PURCHASE_FILING',
];

/** 组解锁判定（与后端同口径：无阶段指针视为刚立项） */
export function stageReached(currentStage: string | null | undefined, groupStageKey: string): boolean {
  const cur = currentStage ? STAGE_ORDER.indexOf(currentStage) : STAGE_ORDER.indexOf('INITIATION');
  const need = STAGE_ORDER.indexOf(groupStageKey);
  return cur >= 0 && need >= 0 && cur >= need;
}
