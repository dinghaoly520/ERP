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
      };
    }

    case 'INQUIRY_PURCHASE': {
      const draft = createEmptyInquiryPurchaseDraft();
      return {
        ...draft,
        projectName: project.title || draft.projectName,
        priceLimit: budgetStr,
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

  // 所有类型共有的封面字段
  const cover = [{ fieldKey: 'projectName', label: '项目名称' }];

  switch (tenderType) {
    case 'COMPETITIVE_NEGOTIATION':
      return withPrompts([
        ...cover,
        { fieldKey: 'projectOverview', label: '项目概况和采购内容' },
        { fieldKey: 'submissionRequirements', label: '提交成果要求' },
        { fieldKey: 'documentAcquireTime', label: '文件获取时间' },
        { fieldKey: 'responseDeadline', label: '响应文件提交截止时间' },
        { fieldKey: 'contactPhone', label: '联系电话' },
        { fieldKey: 'contactEmail', label: '联系邮箱' },
        { fieldKey: 'contractSubcontracting', label: '合同分包' },
        { fieldKey: 'siteSurvey', label: '现场踏勘' },
        { fieldKey: 'businessRequirements', label: '商务要求' },
        { fieldKey: 'technicalRequirements', label: '技术要求' },
        { fieldKey: 'quotationLetter', label: '报价表' },
      ]);

    case 'SINGLE_SOURCE':
      return withPrompts([
        ...cover,
        { fieldKey: 'projectDuration', label: '项目完成期限' },
        { fieldKey: 'documentAcquireTime', label: '采购文件获取时间' },
        { fieldKey: 'documentPrice', label: '采购文件售价' },
        { fieldKey: 'submissionAndNegotiationTime', label: '递交和谈判时间' },
        { fieldKey: 'contactPhone', label: '联系电话' },
        { fieldKey: 'contactEmail', label: '联系邮箱' },
        { fieldKey: 'serviceContent', label: '服务内容' },
        { fieldKey: 'procurementContent', label: '采购内容' },
        { fieldKey: 'procurementRequirements', label: '采购要求' },
        { fieldKey: 'quotationLetter', label: '报价函' },
      ]);

    case 'INQUIRY_PURCHASE':
      return withPrompts([
        ...cover,
        { fieldKey: 'projectIntroduction', label: '项目介绍' },
        { fieldKey: 'procurementContent', label: '采购内容' },
        { fieldKey: 'requiredDocuments', label: '需提供的资料' },
        { fieldKey: 'evaluationMethod', label: '评标方法' },
        { fieldKey: 'submissionDeadline', label: '递交报价函截止时间' },
        { fieldKey: 'contactPhone', label: '联系电话' },
        { fieldKey: 'contactEmail', label: '联系邮箱' },
        { fieldKey: 'quotationLetter', label: '报价函' },
      ]);

    case 'INTERNAL_BIDDING':
    case 'INVITED_BIDDING':
      return withPrompts([
        ...cover,
        { fieldKey: 'projectOverview', label: '项目概况和采购内容' },
        { fieldKey: 'submissionRequirements', label: '提交成果要求' },
        { fieldKey: 'consortiumForm', label: '联合体形式' },
        { fieldKey: 'documentAcquireTime', label: '文件获取时间' },
        { fieldKey: 'documentPrice', label: '采购文件售价' },
        { fieldKey: 'responseSubmissionTime', label: '响应文件提交时间' },
        { fieldKey: 'contactPhone', label: '联系电话' },
        { fieldKey: 'contactEmail', label: '联系邮箱' },
        { fieldKey: 'responseDepositAmount', label: '响应保证金金额' },
        { fieldKey: 'responseDepositForm', label: '响应保证金形式' },
        { fieldKey: 'performanceDepositAmount', label: '履约保证金金额' },
        { fieldKey: 'performanceDepositForm', label: '履约保证金形式' },
        { fieldKey: 'contractSubcontracting', label: '合同分包' },
        { fieldKey: 'siteSurvey', label: '现场踏勘' },
        { fieldKey: 'copyCount', label: '副本份数' },
        { fieldKey: 'evaluationCommitteeCount', label: '评标委员会人数' },
        { fieldKey: 'evaluationMethod', label: '评标方法' },
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
