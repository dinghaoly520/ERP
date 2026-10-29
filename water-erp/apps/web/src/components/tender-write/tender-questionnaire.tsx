import type {
  ReadyTenderDraft,
  ScoringItem,
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
  onScoringItemsChange,
  onFieldFocus,
  onSampleOpen,
  onOpenSupplierSelect,
  fieldLabelMap,
}: {
  /** 全部章节的字段键→标签映射（评分标准 AI 生成上下文用跨章节中文名） */
  fieldLabelMap?: Record<string, string>;
  draft: ReadyTenderDraft;
  sections: TenderSectionConfig[];
  activeSectionKey: TenderSectionKey;
  onChange: (key: TenderFieldKey, value: string) => void;
  onTableChange?: (tableData: TableData | undefined) => void;
  onScoringItemsChange?: (items: ScoringItem[] | undefined) => void;
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
        fieldLabelMap={fieldLabelMap}
        draft={draft}
        onChange={onChange}
        onTableChange={onTableChange}
        onScoringItemsChange={onScoringItemsChange}
        onFieldFocus={onFieldFocus}
        onSampleOpen={onSampleOpen}
        onOpenSupplierSelect={onOpenSupplierSelect}
      />
    </div>
  );
}
