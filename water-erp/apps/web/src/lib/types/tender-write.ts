export type CompetitiveNegotiationSectionKey =
  | "cover"
  | "invitation"
  | "supplier"
  | "requirements"
  | "quotation";

export type SingleSourceSectionKey =
  | "cover"
  | "invitation"
  | "terms"
  | "procurement"
  | "contract"
  | "response";

export type InquiryPurchaseSectionKey =
  | "cover"
  | "invitation"
  | "supplier"
  | "evaluation"
  | "requirements"
  | "quotation";

export type InternalBiddingSectionKey =
  | "cover"
  | "invitation"
  | "supplier"
  | "evaluation"
  | "requirements"
  | "quotation";

export type InvitedBiddingSectionKey =
  | "cover"
  | "invitation"
  | "supplier"
  | "evaluation"
  | "requirements"
  | "quotation";

export type TenderSectionKey =
  | CompetitiveNegotiationSectionKey
  | SingleSourceSectionKey
  | InquiryPurchaseSectionKey
  | InternalBiddingSectionKey
  | InvitedBiddingSectionKey;

export type TenderSectionState =
  | "idle"
  | "completed"
  | "active-complete"
  | "active-missing"
  | "missing";

export type TenderSectionProgress = {
  key: TenderSectionKey;
  title: string;
  description: string;
  totalFields: number;
  filledFields: number;
  missingFields: number;
  state: TenderSectionState;
};

export type TenderDocumentType =
  | "COMPETITIVE_NEGOTIATION"
  | "INTERNAL_BIDDING"
  | "INQUIRY_PURCHASE"
  | "SINGLE_SOURCE"
  | "INVITED_BIDDING";

export type TenderTemplateAvailability = "ready" | "pending";

// Table data types for quotation letter
export type TableCell = {
  content: string;
  rowSpan: number;
  colSpan: number;
  align: "left" | "center" | "right";
  hidden?: boolean;
};

export type TableData = {
  rows: number;
  cols: number;
  cells: TableCell[][];
};

export type CompetitiveNegotiationFieldKey =
  | "projectName"
  | "coverDate"
  | "projectOverview"
  | "procurementContent"
  | "maxPrice"
  | "submissionRequirements"
  | "submissionRequirementsType"
  | "qualificationRequirements"
  | "documentAcquireTime"
  | "responseDeadline"
  | "responseDeadlineType"
  | "bidOpeningPlace"
  | "contactAddress"
  | "supervisionDepartment"
  | "supervisionAddress"
  | "supervisionContact"
  | "supervisionPhone"
  | "contactName"
  | "contactPhone"
  | "contactEmail"
  | "contractSubcontracting"
  | "contractSubcontractingType"
  | "siteSurvey"
  | "siteSurveyType"
  | "businessRequirements"
  | "technicalRequirements"
  | "quotationLetter"
  | "quotationLetterType";

export type SingleSourceFieldKey =
  | "projectName"
  | "coverDate"
  | "supplierName"
  | "projectBudget"
  | "projectDuration"
  | "documentAcquireTime"
  | "documentPrice"
  | "submissionAndNegotiationTime"
  | "submissionAndNegotiationTimeType"
  | "bidOpeningPlace"
  | "contactAddress"
  | "contactName"
  | "contactEmail"
  | "contactPhone"
  | "serviceContent"
  | "serviceContentType"
  | "procurementContent"
  | "procurementRequirements"
  | "quotationLetter"
  | "quotationLetterType";

/** 综合评分法评审标准行（询比 v2：评审方法固定综合评分法）——id 仅供列表 key */
export type ScoringItem = {
  id: string;
  factor: string; // 评分因素
  score: string; // 分值
  criteria: string; // 评分标准
  note: string; // 说明
};

/**
 * 询比字段键（2026-10-29 模板 v2）：与 InternalBiddingFieldKey 同构，
 * 去 evaluationMethod/evaluationCommitteeCount；scoringItems 走 Draft 附加属性。
 */
export type InquiryPurchaseFieldKey =
  | "projectName"
  | "coverDate"
  | "projectOverview"
  | "maxPrice"
  | "submissionRequirements"
  | "submissionRequirementsType"
  | "qualificationRequirements"
  | "consortiumForm"
  | "consortiumFormType"
  | "documentAcquireTime"
  | "documentPrice"
  | "responseSubmissionTime"
  | "bidOpeningPlace"
  | "contactAddress"
  | "contactName"
  | "contactEmail"
  | "contactPhone"
  | "supervisionDepartment"
  | "supervisionAddress"
  | "supervisionContact"
  | "supervisionPhone"
  | "responseDepositType"
  | "responseDepositAmount"
  | "responseDepositForm"
  | "responseDepositBankInfo"
  | "responseDepositOtherForm"
  | "responseDepositOtherRequirement"
  | "responseDepositNonRefundType"
  | "responseDepositNonRefundContent"
  | "performanceDepositType"
  | "performanceDepositAmount"
  | "performanceDepositForm"
  | "performanceDepositOtherForm"
  | "contractSubcontracting"
  | "contractSubcontractingType"
  | "siteSurvey"
  | "siteSurveyType"
  | "copyCount"
  | "businessRequirements"
  | "technicalRequirements"
  | "quotationLetter"
  | "quotationLetterType";

export type InternalBiddingFieldKey =
  | "projectName"
  | "coverDate"
  | "projectOverview"
  | "procurementContent"
  | "maxPrice"
  | "submissionRequirements"
  | "submissionRequirementsType"
  | "qualificationRequirements"
  | "consortiumForm"
  | "consortiumFormType"
  | "documentAcquireTime"
  | "documentPrice"
  | "responseSubmissionTime"
  | "bidOpeningPlace"
  | "contactAddress"
  | "supervisionDepartment"
  | "supervisionAddress"
  | "supervisionContact"
  | "supervisionPhone"
  | "contactName"
  | "contactPhone"
  | "contactEmail"
  | "responseDepositType"
  | "responseDepositAmount"
  | "responseDepositForm"
  | "responseDepositBankInfo"
  | "responseDepositOtherForm"
  | "responseDepositOtherRequirement"
  | "responseDepositOtherRequirementType"
  | "responseDepositNonRefundType"
  | "responseDepositNonRefundContent"
  | "performanceDepositType"
  | "performanceDepositAmount"
  | "performanceDepositForm"
  | "performanceDepositOtherForm"
  | "evaluationMethod"
  | "evaluationCommitteeCount"
  | "contractSubcontracting"
  | "contractSubcontractingType"
  | "siteSurvey"
  | "siteSurveyType"
  | "copyCount"
  | "businessRequirements"
  | "technicalRequirements"
  | "quotationLetter"
  | "quotationLetterType";

export type InvitedBiddingFieldKey = InternalBiddingFieldKey;

export type TenderFieldKey =
  | CompetitiveNegotiationFieldKey
  | SingleSourceFieldKey
  | InquiryPurchaseFieldKey
  | InternalBiddingFieldKey
  | InvitedBiddingFieldKey
  | "scoringItems"; // 询比综合评分法评审标准（结构化行编辑器，值走 Draft.scoringItems）

export type CompetitiveNegotiationDraft = Record<
  CompetitiveNegotiationFieldKey,
  string
> & {
  quotationLetterTable?: TableData;
};

export type SingleSourceDraft = Record<SingleSourceFieldKey, string> & {
  quotationLetterTable?: TableData;
};

export type InquiryPurchaseDraft = Record<InquiryPurchaseFieldKey, string> & {
  quotationLetterTable?: TableData;
  scoringItems?: ScoringItem[];
};

export type InternalBiddingDraft = Record<InternalBiddingFieldKey, string> & {
  quotationLetterTable?: TableData;
};

export type InvitedBiddingDraft = InternalBiddingDraft;

export type ReadyTenderDocumentType = "COMPETITIVE_NEGOTIATION" | "SINGLE_SOURCE" | "INQUIRY_PURCHASE" | "INTERNAL_BIDDING" | "INVITED_BIDDING";

export type ReadyTenderDraft = CompetitiveNegotiationDraft | SingleSourceDraft | InquiryPurchaseDraft | InternalBiddingDraft | InvitedBiddingDraft;

export type TenderDraftRecord = Partial<CompetitiveNegotiationDraft>;

export type TenderDraftsState = {
  COMPETITIVE_NEGOTIATION: CompetitiveNegotiationDraft;
  INTERNAL_BIDDING: InternalBiddingDraft;
  INQUIRY_PURCHASE: InquiryPurchaseDraft;
  SINGLE_SOURCE: SingleSourceDraft;
  INVITED_BIDDING: InvitedBiddingDraft;
};

export type TenderFieldConfig<K extends TenderFieldKey = TenderFieldKey> = {
  key: K;
  label: string;
  placeholder: string;
  multiline?: boolean;
  // "datetime" = datetime-local 选择器（存中文格式「YYYY年MM月DD日HH:MM」），
  // 用于开标时间等只允许填时间的字段（2026-09-09 起开标时间不再支持文字）；
  // "datetime-range" = 起止两个 datetime-local 组成时间段（存「YYYY年MM月DD日HH:MM至YYYY年MM月DD日HH:MM」，
  // 与 AI 生成同口径），用于文件获取时间（2026-10-21 用户口径：弃文句式录入）
  type?: "text" | "date" | "month" | "datetime" | "datetime-range" | "email" | "tel";
  aiPrompt?: string;
  composite?: {
    typeKey: TenderFieldKey;
    typeLabel: string;
    typeOptions: { value: string; label: string }[];
  };
  toggle?: {
    yesLabel: string;
    noLabel: string;
    yesValue: string;
    noValue?: string;
  };
  typeKey?: TenderFieldKey;
  select?: {
    options: { value: string; label: string }[];
  };
  quotationType?: {
    options: { value: string; label: string }[];
  };
  // 综合评分法评审标准（询比 v2）：专用结构化评分行编辑器，值存 Draft.scoringItems
  scoring?: boolean;
};

export type TenderSectionConfig<
  S extends TenderSectionKey = TenderSectionKey,
  K extends TenderFieldKey = TenderFieldKey,
> = {
  key: S;
  title: string;
  description: string;
  fields: TenderFieldConfig<K>[];
};

export type TenderDocumentTypeMeta = {
  type: TenderDocumentType;
  label: string;
  availability: TenderTemplateAvailability;
  description: string;
};

export type TenderHistoryRecord = {
  id: string;
  documentType: TenderDocumentType;
  title: string;
  draftData: TenderDraftRecord;
  createdAt: string;
  updatedAt: string;
};
