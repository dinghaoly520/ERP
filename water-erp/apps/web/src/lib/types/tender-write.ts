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
  | "instructions"
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
  | "contactName"
  | "contactPhone"
  | "contactEmail"
  | "contractSubcontracting"
  | "contractSubcontractingType"
  | "siteSurvey"
  | "siteSurveyType"
  | "contractText"
  | "contractTextType"
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
  | "projectDurationType"
  | "documentAcquireTime"
  | "documentPrice"
  | "submissionAndNegotiationTime"
  | "submissionAndNegotiationTimeType"
  | "contactName"
  | "contactEmail"
  | "contactPhone"
  | "serviceContent"
  | "serviceContentType"
  | "procurementContent"
  | "procurementRequirements"
  | "contractText"
  | "quotationLetter"
  | "quotationLetterType";

export type InquiryPurchaseFieldKey =
  | "projectName"
  | "coverDate"
  | "projectIntroduction"
  | "procurementContent"
  | "requiredDocuments"
  | "evaluationMethod"
  | "priceLimit"
  | "submissionDeadline"
  | "contactName"
  | "contactEmail"
  | "contactPhone"
  | "quotationLetter"
  | "quotationLetterType";

export type InternalBiddingFieldKey =
  | "projectName"
  | "coverDate"
  | "projectOverview"
  | "procurementContent"
  | "maxPrice"
  | "qualificationRequirements"
  | "consortiumForm"
  | "consortiumFormType"
  | "documentAcquireTime"
  | "documentPrice"
  | "responseSubmissionTime"
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
  | InvitedBiddingFieldKey;

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
  type?: "text" | "date" | "month" | "email" | "tel";
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
