import type { ProjectManagementItem } from '@/lib/types/project-management';
import type {
  CompetitiveNegotiationDraft,
  SingleSourceDraft,
  InquiryPurchaseDraft,
  InternalBiddingDraft,
  InvitedBiddingDraft,
  TenderDocumentType,
  ReadyTenderDraft,
  TenderSectionConfig,
} from '@/lib/types/tender-write';
import {
  createEmptyCompetitiveNegotiationDraft,
  createEmptySingleSourceDraft,
  createEmptyInquiryPurchaseDraft,
  createEmptyInternalBiddingDraft,
  createEmptyInvitedBiddingDraft,
  COMPETITIVE_NEGOTIATION_SECTIONS,
  SINGLE_SOURCE_SECTIONS,
  INQUIRY_PURCHASE_SECTIONS,
  INTERNAL_BIDDING_SECTIONS,
  INVITED_BIDDING_SECTIONS,
} from './templates';

/**
 * 从项目数据预填采购文件草稿。
 * 返回一个 partial draft —— 仅包含有对应项目数据的字段。
 */
export function buildPrefillFromProject(
  project: ProjectManagementItem,
  tenderType: TenderDocumentType,
): Partial<ReadyTenderDraft> {
  const budgetStr = project.budgetAmount != null ? String(project.budgetAmount) : '';

  const common: Partial<Record<string, string>> = {
    projectName: project.title || '',
    contactName: project.requesterName || '',
  };

  switch (tenderType) {
    case 'COMPETITIVE_NEGOTIATION': {
      const draft = createEmptyCompetitiveNegotiationDraft();
      return {
        ...draft,
        projectName: project.title || draft.projectName,
        contactName: project.requesterName || draft.contactName,
        maxPrice: budgetStr,
        qualificationRequirements: project.supplierRequirements || '',
      };
    }

    case 'SINGLE_SOURCE': {
      const draft = createEmptySingleSourceDraft();
      return {
        ...draft,
        projectName: project.title || draft.projectName,
        projectBudget: budgetStr,
        supplierName: project.awardedSupplier || '',
        contactName: project.requesterName || draft.contactName,
        // 采购内容/采购要求不再直塞立项原文（2026-09-11 拍板）：保持为空，由 AI 基于立项事由/
        // 供方要求等上下文生成（buildAiGenerationContext 已携带两者作素材）；获取时间 ← 阶段提取值
        documentAcquireTime: project.documentAcquireTime || '',
      };
    }

    case 'INQUIRY_PURCHASE': {
      // 2026-10-29 模板 v2：与竞价同口径（限价→maxPrice、供方要求→特定资质要求）
      const draft = createEmptyInquiryPurchaseDraft();
      return {
        ...draft,
        projectName: project.title || draft.projectName,
        maxPrice: budgetStr,
        qualificationRequirements: project.supplierRequirements || '',
        contactName: project.requesterName || draft.contactName,
      };
    }

    case 'INTERNAL_BIDDING':
    case 'INVITED_BIDDING': {
      const draft = tenderType === 'INTERNAL_BIDDING'
        ? createEmptyInternalBiddingDraft()
        : createEmptyInvitedBiddingDraft();
      return {
        ...draft,
        projectName: project.title || draft.projectName,
        maxPrice: budgetStr,
        qualificationRequirements: project.supplierRequirements || '',
        contactName: project.requesterName || draft.contactName,
      };
    }

    default:
      return common;
  }
}

/** 各采购文件类型对应的编辑器章节配置（aiPrompt 的唯一来源）。 */
const SECTIONS_BY_TYPE: Record<TenderDocumentType, TenderSectionConfig[]> = {
  COMPETITIVE_NEGOTIATION: COMPETITIVE_NEGOTIATION_SECTIONS,
  SINGLE_SOURCE: SINGLE_SOURCE_SECTIONS,
  INQUIRY_PURCHASE: INQUIRY_PURCHASE_SECTIONS,
  INTERNAL_BIDDING: INTERNAL_BIDDING_SECTIONS,
  INVITED_BIDDING: INVITED_BIDDING_SECTIONS,
};

/** 从该类型的编辑器配置中查找字段的 aiPrompt（templates.ts 为唯一来源）。 */
function resolveAiPrompt(tenderType: TenderDocumentType, fieldKey: string): string | undefined {
  const sections = SECTIONS_BY_TYPE[tenderType] ?? [];
  for (const section of sections) {
    const field = section.fields.find((f) => String(f.key) === fieldKey);
    if (field?.aiPrompt) return field.aiPrompt;
  }
  return undefined;
}

/**
 * 返回该类型中适合 AI 生成且没有预填值的字段列表。
 * 每个条目的 aiPrompt 从 templates.ts 章节配置中解析，确保批量自动生成与编辑器内单字段生成使用同一份提示词。
 */
export function getAiGenerationFields(tenderType: TenderDocumentType): Array<{
  fieldKey: string;
  label: string;
  aiPrompt?: string;
}> {
  // 为每个字段补上 templates.ts 中配置的 aiPrompt
  const withPrompts = (fields: Array<{ fieldKey: string; label: string }>) =>
    fields.map((f) => ({ ...f, aiPrompt: resolveAiPrompt(tenderType, f.fieldKey) }));

  // 注意：封面字段 projectName 不在 AI 生成清单（2026-10-30 实录）——名称权威来源是
  // PMI 标题（buildPrefillFromProject 预填），LLM 拿全套素材只会写出整段项目综述盖掉
  // 名称；服务端 tender-field-generate 亦纵深拦截 PROJECT_NAME_NO_AI。
  // 同批移除的结构化控件（2026-10-30 盘点）：siteSurvey/serviceContent 是 toggle
  //（开关即得法定固定文案）、responseDepositForm/performanceDepositForm/
  // evaluationMethod 是 select（下拉选定）——AI 生成的自由文本与控件形态不匹配，
  // 此前它们混在清单里且无 aiPrompt，服务端以「生成专业内容」兜底 prompt 带偏内容。
  switch (tenderType) {
    case 'COMPETITIVE_NEGOTIATION':
      return withPrompts([
        { fieldKey: 'projectOverview', label: '项目概况和采购内容' },
        { fieldKey: 'submissionRequirements', label: '提交成果要求' },
        { fieldKey: 'documentAcquireTime', label: '文件获取时间' },
        { fieldKey: 'responseDeadline', label: '开标时间' },
        { fieldKey: 'contactPhone', label: '联系电话' },
        { fieldKey: 'contactEmail', label: '联系邮箱' },
        { fieldKey: 'contractSubcontracting', label: '合同分包' },
        { fieldKey: 'businessRequirements', label: '商务要求' },
        { fieldKey: 'technicalRequirements', label: '技术要求' },
        { fieldKey: 'quotationLetter', label: '报价表' },
      ]);

    case 'SINGLE_SOURCE':
      return withPrompts([
        { fieldKey: 'projectDuration', label: '项目完成期限' },
        { fieldKey: 'documentAcquireTime', label: '采购文件获取时间' },
        { fieldKey: 'documentPrice', label: '采购文件售价' },
        { fieldKey: 'submissionAndNegotiationTime', label: '开标时间' },
        { fieldKey: 'contactPhone', label: '联系电话' },
        { fieldKey: 'contactEmail', label: '联系邮箱' },
        { fieldKey: 'procurementContent', label: '采购内容' },
        { fieldKey: 'procurementRequirements', label: '采购要求' },
        { fieldKey: 'quotationLetter', label: '报价函' },
      ]);

    case 'INQUIRY_PURCHASE':
      // 2026-10-29 模板 v2：六章制字段与竞价同构（去评标方法/评标委员会人数，
      // 评审标准为结构化评分行编辑器不走批量文本生成）
      return withPrompts([
        { fieldKey: 'projectOverview', label: '项目概况和采购内容' },
        { fieldKey: 'submissionRequirements', label: '提交成果要求' },
        { fieldKey: 'consortiumForm', label: '联合体形式' },
        { fieldKey: 'documentAcquireTime', label: '文件获取时间' },
        { fieldKey: 'documentPrice', label: '采购文件售价' },
        { fieldKey: 'responseSubmissionTime', label: '开标时间' },
        { fieldKey: 'contactPhone', label: '联系电话' },
        { fieldKey: 'contactEmail', label: '联系邮箱' },
        { fieldKey: 'responseDepositAmount', label: '响应保证金金额' },
        { fieldKey: 'performanceDepositAmount', label: '履约保证金金额' },
        { fieldKey: 'contractSubcontracting', label: '合同分包' },
        { fieldKey: 'copyCount', label: '副本份数' },
        { fieldKey: 'businessRequirements', label: '商务要求' },
        { fieldKey: 'technicalRequirements', label: '技术要求' },
        { fieldKey: 'quotationLetter', label: '报价表' },
      ]);

    case 'INTERNAL_BIDDING':
    case 'INVITED_BIDDING':
      return withPrompts([
        { fieldKey: 'projectOverview', label: '项目概况和采购内容' },
        { fieldKey: 'submissionRequirements', label: '提交成果要求' },
        { fieldKey: 'consortiumForm', label: '联合体形式' },
        { fieldKey: 'documentAcquireTime', label: '文件获取时间' },
        { fieldKey: 'documentPrice', label: '采购文件售价' },
        { fieldKey: 'responseSubmissionTime', label: '开标时间' },
        { fieldKey: 'contactPhone', label: '联系电话' },
        { fieldKey: 'contactEmail', label: '联系邮箱' },
        { fieldKey: 'responseDepositAmount', label: '响应保证金金额' },
        { fieldKey: 'performanceDepositAmount', label: '履约保证金金额' },
        { fieldKey: 'contractSubcontracting', label: '合同分包' },
        { fieldKey: 'copyCount', label: '副本份数' },
        { fieldKey: 'evaluationCommitteeCount', label: '评标委员会人数' },
        { fieldKey: 'businessRequirements', label: '商务要求' },
        { fieldKey: 'technicalRequirements', label: '技术要求' },
        { fieldKey: 'quotationLetter', label: '报价表' },
      ]);

    default:
      return [];
  }
}

/**
 * 构建 AI 生成时附带的上下文对象。
 */
export function buildAiGenerationContext(project: ProjectManagementItem): Record<string, string> {
  return {
    projectTitle: project.title || '',
    department: project.requesterDepartment || '',
    requester: project.requesterName || '',
    procurementMethod: project.procurementMethod || '',
    procurementCategory: project.procurementCategory || '',
    budgetAmount: project.budgetAmount != null ? String(project.budgetAmount) : '',
    projectReason: project.projectReason || '',
    supplierRequirements: project.supplierRequirements || '',
    awardedSupplier: project.awardedSupplier || '',
    contractAmount: project.contractAmount != null ? String(project.contractAmount) : '',
    initiationDate: project.initiationDate || '',
    biddingUnits: project.biddingUnits || '',
    expertInfo: project.expertInfo || '',
    projectOverview: project.projectOverview || '',
    bidOpeningTime: project.bidOpeningTime || '',
  };
}

/**
 * 项目预填合并（只填空缺，2026-10-30 直采供应商名污染实录）：已保存草稿的非空
 * 字段一律保留，预填值只进空缺——与 /tender-write 页 fillCompany 同口径。
 * 此前 modal 打开流程把 prefill 非空字段整体铺在已存草稿之后，用户在供应商抽选
 * 弹窗选好的名称会被 project.awardedSupplier（可能被上游写成长文本）顶掉。
 * 供应商名称另加形态守卫：>40 字符显然不是公司名，拒绝预填。
 */
export function mergePrefillFillingGaps<T extends object>(draft: T, prefill: Record<string, unknown>): T {
  const out = { ...(draft as Record<string, unknown>) };
  for (const [k, v] of Object.entries(prefill)) {
    if (v == null || v === '') continue;
    if (k === 'supplierName' && String(v).trim().length > 40) continue;
    const cur = out[k];
    if (cur == null || (typeof cur === 'string' && cur.trim() === '')) out[k] = v;
  }
  return out as T;
}
