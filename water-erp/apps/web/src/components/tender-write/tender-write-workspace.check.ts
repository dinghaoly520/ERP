import type {
  ReadyTenderDocumentType,
  ReadyTenderDraft,
  SingleSourceDraft,
  CompetitiveNegotiationDraft,
  TenderSectionConfig,
  TenderFieldKey,
  TenderSectionKey,
} from '../../lib/types/tender-write';
import {
  TENDER_DOCUMENT_TYPES,
  SINGLE_SOURCE_SECTIONS,
  COMPETITIVE_NEGOTIATION_SECTIONS,
  createEmptySingleSourceDraft,
  createEmptyCompetitiveNegotiationDraft,
} from '../../lib/tender-write/templates';
import { buildTenderSectionProgress } from '../../lib/tender-write/progress';

// Assert SINGLE_SOURCE is ready and has correct label
const singleSourceType = TENDER_DOCUMENT_TYPES.find(
  (t) => t.type === 'SINGLE_SOURCE',
);
if (!singleSourceType) throw new Error('SINGLE_SOURCE type not found');
if (singleSourceType.availability !== 'ready')
  throw new Error('SINGLE_SOURCE should be ready');
if (singleSourceType.label !== '单源直接采购')
  throw new Error('SINGLE_SOURCE label should be 单源直接采购');

// Assert SINGLE_SOURCE has 6 sections
if (SINGLE_SOURCE_SECTIONS.length !== 6)
  throw new Error(`Expected 6 sections, got ${SINGLE_SOURCE_SECTIONS.length}`);

// Assert SINGLE_SOURCE has 16 total fields
const singleSourceFieldCount = SINGLE_SOURCE_SECTIONS.reduce(
  (sum, s) => sum + s.fields.length,
  0,
);
if (singleSourceFieldCount !== 16)
  throw new Error(`Expected 16 fields, got ${singleSourceFieldCount}`);

// Assert all expected field keys exist
const expectedSingleSourceFields = [
  'projectName',
  'coverDate',
  'supplierName',
  'projectBudget',
  'projectDuration',
  'documentAcquireTime',
  'documentPrice',
  'submissionAndNegotiationTime',
  'contactName',
  'contactEmail',
  'contactPhone',
  'serviceContent',
  'procurementContent',
  'procurementRequirements',
  'contractText',
  'quotationLetter',
] as const;

const allFieldKeys = SINGLE_SOURCE_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
for (const expected of expectedSingleSourceFields) {
  if (!allFieldKeys.includes(expected as TenderFieldKey)) {
    throw new Error(`Missing field: ${expected}`);
  }
}

// Assert draft factory creates all fields
const emptyDraft = createEmptySingleSourceDraft();
for (const field of expectedSingleSourceFields) {
  if (!(field in emptyDraft)) {
    throw new Error(`Draft missing field: ${field}`);
  }
  if (emptyDraft[field as keyof SingleSourceDraft] !== '') {
    throw new Error(`Draft field ${field} should be empty string`);
  }
}

// Assert progress builder works with SingleSourceDraft
const progress = buildTenderSectionProgress(
  SINGLE_SOURCE_SECTIONS,
  emptyDraft,
  'cover',
);
if (progress.length !== 6)
  throw new Error(`Expected 6 progress items, got ${progress.length}`);

// Assert type narrowing works
const documentType: ReadyTenderDocumentType = 'SINGLE_SOURCE';
const draft: ReadyTenderDraft = emptyDraft;
if (documentType === 'SINGLE_SOURCE') {
  const singleSourceDraft = draft as SingleSourceDraft;
  // TypeScript should recognize this as valid
  const _test: string = singleSourceDraft.supplierName;
}

// Assert competitive negotiation still works
const compDraft = createEmptyCompetitiveNegotiationDraft();
const compProgress = buildTenderSectionProgress(
  COMPETITIVE_NEGOTIATION_SECTIONS,
  compDraft,
  'cover',
);
if (compProgress.length !== 5)
  throw new Error(`Expected 5 competitive sections, got ${compProgress.length}`);

console.log('All workspace assertions passed!');
console.log('SINGLE_SOURCE sections:', SINGLE_SOURCE_SECTIONS.map((s) => s.key));
console.log('SINGLE_SOURCE field count:', singleSourceFieldCount);