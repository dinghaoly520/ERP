import type {
  ReadyTenderDocumentType,
  TenderFieldKey,
  TenderSectionKey,
} from './tender-write';

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
  key: TenderFieldKey;
  label: string;
  sectionKey: TenderSectionKey;
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
