export type TenderDocumentType =
  | 'COMPETITIVE_NEGOTIATION'
  | 'INTERNAL_BIDDING'
  | 'INQUIRY_PURCHASE'
  | 'SINGLE_SOURCE'
  | 'INVITED_BIDDING';

export type ReadyTenderDocumentType =
  | 'COMPETITIVE_NEGOTIATION'
  | 'SINGLE_SOURCE'
  | 'INQUIRY_PURCHASE'
  | 'INTERNAL_BIDDING'
  | 'INVITED_BIDDING';

export type CompetitiveNegotiationAnswers = {
  projectName: string;
  coverDate: string;
  projectOverview: string;
  procurementContent: string;
  maxPrice: string;
  submissionRequirements: string;
  submissionRequirementsType: string;
  qualificationRequirements: string;
  documentAcquireTime: string;
  responseDeadline: string;
  responseDeadlineType: string;
  // 开标地点/联系人地址（2026-10-09 占位符化）：选填，留空回退模板原值
  bidOpeningPlace?: string;
  contactAddress?: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  contractSubcontracting: string;
  contractSubcontractingType: string;
  siteSurvey: string;
  siteSurveyType: string;
  businessRequirements: string;
  technicalRequirements: string;
  quotationLetterType: 'text' | 'table';
  quotationLetter: string; // 文本模式时使用
  quotationLetterTable?: TableData; // 表格模式时使用
};

export type TableCell = {
  content: string;
  rowSpan: number;
  colSpan: number;
  align: 'left' | 'center' | 'right';
  hidden?: boolean;
};

export type TableData = {
  rows: number;
  cols: number;
  cells: TableCell[][];
};

export type SingleSourceAnswers = {
  projectName: string;
  coverDate: string;
  supplierName: string;
  projectBudget: string;
  projectDuration: string;
  documentAcquireTime: string;
  documentPrice: string;
  submissionAndNegotiationTime: string;
  bidOpeningPlace?: string;
  contactAddress?: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  serviceContent: string;
  procurementContent: string;
  procurementRequirements: string;
  quotationLetterType: 'text' | 'table';
  quotationLetter: string; // 文本模式时使用
  quotationLetterTable?: TableData; // 表格模式时使用
};

/** 综合评分法评审标准行（询比固定综合评分法）——id 仅供前端列表 key，后端忽略 */
export type ScoringItem = {
  id: string;
  factor: string; // 评分因素
  score: string; // 分值
  criteria: string; // 评分标准
  note: string; // 说明
};

/**
 * 询比采购答案（2026-10-29 模板 v2）：与 InternalBiddingAnswers 同构，
 * 去掉 evaluationMethod（评审方法固定综合评分法，模板无勾选占位符）与
 * evaluationCommitteeCount（模板固定「询比小组 3 人以上单数」，无占位符），
 * 新增 scoringItems（注入「六、综合评分法评审标准」表）。
 */
export type InquiryPurchaseAnswers = {
  projectName: string;
  coverDate: string;
  projectOverview: string;
  maxPrice: string;
  submissionRequirements: string;
  submissionRequirementsType: string;
  qualificationRequirements: string;
  consortiumForm: string;
  consortiumFormType: string;
  documentAcquireTime: string;
  documentPrice: string;
  responseSubmissionTime: string;
  bidOpeningPlace?: string;
  contactAddress?: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  responseDepositType: string;
  responseDepositAmount: string;
  responseDepositForm: string;
  responseDepositBankInfo: string;
  responseDepositOtherForm: string;
  responseDepositOtherRequirement: string;
  responseDepositNonRefundType: string;
  responseDepositNonRefundContent: string;
  performanceDepositType: string;
  performanceDepositAmount: string;
  performanceDepositForm: string;
  performanceDepositOtherForm: string;
  contractSubcontracting: string;
  contractSubcontractingType: string;
  siteSurvey: string;
  siteSurveyType: string;
  copyCount: string;
  businessRequirements: string;
  technicalRequirements: string;
  quotationLetterType: 'text' | 'table';
  quotationLetter: string; // 文本模式时使用
  quotationLetterTable?: TableData; // 表格模式时使用
  scoringItems?: ScoringItem[]; // 综合评分法评审标准行
};

export type InternalBiddingAnswers = {
  projectName: string;
  coverDate: string;
  projectOverview: string;
  procurementContent: string;
  maxPrice: string;
  submissionRequirements: string;
  submissionRequirementsType: string;
  qualificationRequirements: string;
  consortiumForm: string;
  consortiumFormType: string;
  documentAcquireTime: string;
  documentPrice: string;
  responseSubmissionTime: string;
  bidOpeningPlace?: string;
  contactAddress?: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  responseDepositType: string;
  responseDepositAmount: string;
  responseDepositForm: string;
  responseDepositBankInfo: string;
  responseDepositOtherForm: string;
  responseDepositOtherRequirement: string;
  responseDepositOtherRequirementType: string;
  responseDepositNonRefundType: string;
  responseDepositNonRefundContent: string;
  performanceDepositType: string;
  performanceDepositAmount: string;
  performanceDepositForm: string;
  performanceDepositOtherForm: string;
  evaluationMethod: string;
  evaluationCommitteeCount?: string;
  contractSubcontracting: string;
  contractSubcontractingType: string;
  siteSurvey: string;
  siteSurveyType: string;
  copyCount: string;
  businessRequirements: string;
  technicalRequirements: string;
  quotationLetterType: 'text' | 'table';
  quotationLetter: string; // 文本模式时使用
  quotationLetterTable?: TableData; // 表格模式时使用
};
