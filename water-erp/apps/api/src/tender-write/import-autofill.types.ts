export type ReadyTenderDocumentType =
  | 'COMPETITIVE_NEGOTIATION'
  | 'SINGLE_SOURCE'
  | 'INQUIRY_PURCHASE'
  | 'INTERNAL_BIDDING'
  | 'INVITED_BIDDING';

export type ImportAutofillFileStatus = 'parsed' | 'unsupported' | 'failed';

export type ImportAutofillFieldStatus =
  | 'recognized'
  | 'low_confidence'
  | 'not_found';

export type ImportAutofillFileResult = {
  name: string;
  type: string;
  status: ImportAutofillFileStatus;
  message?: string;
};

export type ImportAutofillFieldSource = {
  fileName: string;
  location: string;
  sourceField: string;
  quote: string;
  reason?: string;
};

export type ImportAutofillFieldResult = {
  key: string;
  label: string;
  sectionKey: string;
  sectionTitle: string;
  status: ImportAutofillFieldStatus;
  value: string;
  confidence: number;
  source?: ImportAutofillFieldSource;
};

export type ImportAutofillResult = {
  documentType: ReadyTenderDocumentType;
  files: ImportAutofillFileResult[];
  fields: ImportAutofillFieldResult[];
};
