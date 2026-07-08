import { useMemo, useState } from 'react';
import {
  getAdjacentTenderSectionKey,
  buildTenderSectionProgress,
} from '../../lib/tender-write/progress';
import type {
  ReadyTenderDraft,
  ReadyTenderDocumentType,
  TableData,
  TenderDocumentTypeMeta,
  TenderFieldKey,
  TenderSectionConfig,
  TenderSectionKey,
} from '../../lib/types/tender-write';
import { TenderEditorHeader } from './tender-editor-header';
import { TenderQuestionnaire } from './tender-questionnaire';
import { TenderPreviewPane } from './tender-preview-pane';
import { TenderSectionNav } from './tender-section-nav';
import { TenderFieldSampleDialog } from './tender-field-sample-drawer';

const SUBMISSION_REQUIREMENTS_PREFIX_PATTERN = /^5[.．]\s*提交成果要求[:：]\s*/;

function stripSubmissionRequirementsPrefix(value: string): string {
  return value.trim().replace(SUBMISSION_REQUIREMENTS_PREFIX_PATTERN, '');
}

export function TenderWriteWorkspace({
  documentType,
  draft,
  sections,
  selectedMeta,
  activeSectionKey,
  onSectionSelect,
  onChange,
  onTableChange,
}: {
  documentType: ReadyTenderDocumentType;
  draft: ReadyTenderDraft;
  sections: TenderSectionConfig[];
  selectedMeta: TenderDocumentTypeMeta;
  activeSectionKey: TenderSectionKey;
  onSectionSelect: (key: TenderSectionKey) => void;
  onChange: (key: TenderFieldKey, value: string) => void;
  onTableChange?: (tableData: TableData | undefined) => void;
}) {
  const [scrollToCenter, setScrollToCenter] = useState(false);
  const [focusedFieldKey, setFocusedFieldKey] = useState<string | undefined>(undefined);
  const [sampleDrawerState, setSampleDrawerState] = useState<{
    isOpen: boolean;
    fieldKey: TenderFieldKey;
    fieldLabel: string;
  } | null>(null);

  const handleSectionSelect = (key: TenderSectionKey) => {
    setScrollToCenter(false);
    setFocusedFieldKey(undefined);
    onSectionSelect(key);
  };

  const handleFieldFocus = (fieldKey: TenderFieldKey) => {
    setScrollToCenter(true);
    setFocusedFieldKey(fieldKey);
  };

  const handleSampleOpen = (fieldKey: TenderFieldKey, fieldLabel: string) => {
    setSampleDrawerState({ isOpen: true, fieldKey, fieldLabel });
  };

  const handleSampleClose = () => {
    setSampleDrawerState(null);
  };

  const handleSampleSelect = (content: string) => {
    if (sampleDrawerState) {
      onChange(sampleDrawerState.fieldKey, content);
    }
  };

  const handlePreviewValueChange = (fieldKey: TenderFieldKey, value: string) => {
    const normalizedValue = value.trim();

    if (fieldKey === 'contractText') {
      onChange('contractTextType', normalizedValue ? 'yes' : 'no');
      onChange(fieldKey, normalizedValue ? value : '');
      return;
    }

    if (fieldKey === 'serviceContent') {
      onChange('serviceContentType', normalizedValue ? 'yes' : 'no');
      onChange(fieldKey, normalizedValue ? value : '');
      return;
    }

    if (fieldKey === 'submissionRequirements') {
      const nextValue = normalizedValue ? stripSubmissionRequirementsPrefix(value) : '';
      onChange('submissionRequirementsType', nextValue ? 'have' : 'none');
      onChange(fieldKey, nextValue);
      return;
    }

    if (fieldKey === 'contractSubcontracting') {
      onChange('contractSubcontractingType', normalizedValue ? 'allow' : 'none');
      onChange(fieldKey, normalizedValue ? value : '');
      return;
    }

    if (fieldKey === 'consortiumForm') {
      onChange('consortiumFormType', normalizedValue ? 'accept' : 'reject');
      onChange(fieldKey, normalizedValue ? value : '');
      return;
    }

    onChange(fieldKey, value);
  };

  const progress = useMemo(
    () => buildTenderSectionProgress(sections, draft, activeSectionKey),
    [sections, draft, activeSectionKey],
  );

  const currentSection =
    progress.find((item) => item.key === activeSectionKey) ?? progress[0];
  const isFirst = activeSectionKey === sections[0].key;
  const isLast = activeSectionKey === sections[sections.length - 1].key;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden xl:flex-row">
        <aside
          data-tender-panel="nav"
          className="hidden min-h-0 w-[240px] shrink-0 flex-col overflow-hidden rounded-[24px] wb-panel p-3 xl:flex tender-section-enter"
        >
          <TenderSectionNav
            sections={progress}
            activeSectionKey={activeSectionKey}
            onSelect={handleSectionSelect}
          />
        </aside>

        <section
          data-tender-panel="editor"
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] wb-panel p-0 tender-section-enter-delay-1"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              className="min-h-0 flex-1 overflow-y-auto pr-1 tender-scroll"
              data-tender-editor-scroll="true"
            >
              <div className="tender-editor-sticky">
                <TenderEditorHeader
                  section={currentSection}
                  isFirst={isFirst}
                  isLast={isLast}
                  onPrevious={() =>
                    handleSectionSelect(
                      getAdjacentTenderSectionKey(
                        sections,
                        activeSectionKey,
                        -1,
                      ),
                    )
                  }
                  onNext={() =>
                    handleSectionSelect(
                      getAdjacentTenderSectionKey(
                        sections,
                        activeSectionKey,
                        1,
                      ),
                    )
                  }
                />
              </div>
              <div className="pt-2 pb-5">
                <TenderQuestionnaire
                  draft={draft}
                  sections={sections}
                  activeSectionKey={activeSectionKey}
                  onChange={onChange}
                  onTableChange={onTableChange}
                  onFieldFocus={handleFieldFocus}
                  onSampleOpen={handleSampleOpen}
                />
              </div>
            </div>
          </div>
        </section>

        <TenderPreviewPane
          documentType={documentType}
          draft={draft}
          activeSectionKey={activeSectionKey}
          selectedMeta={selectedMeta}
          progress={progress}
          onSectionClick={handleSectionSelect}
          scrollToCenter={scrollToCenter}
          focusedFieldKey={focusedFieldKey}
          onValueChange={handlePreviewValueChange}
        />
      </div>

      {sampleDrawerState && (
        <TenderFieldSampleDialog
          isOpen={sampleDrawerState.isOpen}
          fieldKey={sampleDrawerState.fieldKey}
          fieldLabel={sampleDrawerState.fieldLabel}
          onSelect={handleSampleSelect}
          onClose={handleSampleClose}
        />
      )}
    </>
  );
}
