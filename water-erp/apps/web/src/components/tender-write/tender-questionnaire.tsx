import type {
  ReadyTenderDraft,
  TableData,
  TenderFieldKey,
  TenderSectionConfig,
  TenderSectionKey,
} from '../../lib/types/tender-write';
import { TenderSectionEditor } from './tender-section-editor';

export function TenderQuestionnaire({
  draft,
  sections,
  activeSectionKey,
  onChange,
  onTableChange,
  onFieldFocus,
  onSampleOpen,
  onOpenSupplierSelect,
}: {
  draft: ReadyTenderDraft;
  sections: TenderSectionConfig[];
  activeSectionKey: TenderSectionKey;
  onChange: (key: TenderFieldKey, value: string) => void;
  onTableChange?: (tableData: TableData | undefined) => void;
  onFieldFocus?: (fieldKey: TenderFieldKey) => void;
  onSampleOpen?: (fieldKey: TenderFieldKey, fieldLabel: string) => void;
  onOpenSupplierSelect?: () => void;
}) {
  const section =
    sections.find((item) => item.key === activeSectionKey) ?? sections[0];

  return (
    <div className="min-h-full tender-section-enter">
      <TenderSectionEditor
        section={section}
        draft={draft}
        onChange={onChange}
        onTableChange={onTableChange}
        onFieldFocus={onFieldFocus}
        onSampleOpen={onSampleOpen}
        onOpenSupplierSelect={onOpenSupplierSelect}
      />
    </div>
  );
}
