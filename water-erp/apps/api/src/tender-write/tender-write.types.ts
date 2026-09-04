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

export type InquiryPurchaseAnswers = {
  projectName: string;
  coverDate: string;
  projectIntroduction: string;
  procurementContent: string;
  requiredDocuments: string;
  evaluationMethod: string;
  priceLimit: string;
  documentAcquireTime: string;
  bidOpeningTime: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  quotationLetterType: 'text' | 'table';
  quotationLetter: string; // 文本模式时使用
  quotationLetterTable?: TableData; // 表格模式时使用
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

// Invited bidding uses the same structure as internal bidding
export type InvitedBiddingAnswers = InternalBiddingAnswers;
