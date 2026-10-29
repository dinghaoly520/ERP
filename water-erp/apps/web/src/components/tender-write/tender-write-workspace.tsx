import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  getAdjacentTenderSectionKey,
  buildTenderSectionProgress,
} from '../../lib/tender-write/progress';
import type {
  ReadyTenderDraft,
  ReadyTenderDocumentType,
  ScoringItem,
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
  onScoringItemsChange,
  onOpenSupplierSelect,
  onAutoFillAll,
  batchFilling,
  sectionGate,
}: {
  documentType: ReadyTenderDocumentType;
  draft: ReadyTenderDraft;
  sections: TenderSectionConfig[];
  selectedMeta: TenderDocumentTypeMeta;
  activeSectionKey: TenderSectionKey;
  onSectionSelect: (key: TenderSectionKey) => void;
  onChange: (key: TenderFieldKey, value: string) => void;
  onTableChange?: (tableData: TableData | undefined) => void;
  onScoringItemsChange?: (items: ScoringItem[] | undefined) => void;
  onOpenSupplierSelect?: () => void;
  onAutoFillAll?: () => void;
  batchFilling?: boolean;
  /** 前置章节闸（询比评分标准章节）：未满足时该节可进入但只渲染解锁提示 */
  sectionGate?: {
    key: TenderSectionKey;
    locked: boolean;
    missing: Array<{ key: TenderSectionKey; title: string; missingFields: number }>;
  };
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
    () =>
      buildTenderSectionProgress(sections, draft, activeSectionKey).map((item) =>
        sectionGate && item.key === sectionGate.key && sectionGate.locked
          ? { ...item, locked: true }
          : item,
      ),
    [sections, draft, activeSectionKey, sectionGate],
  );

  // 全章节字段键→标签映射：评分标准 AI 生成上下文跨章节取中文名（避免英文键弱化参考效果）
  const fieldLabelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const sec of sections) for (const f of sec.fields) m[String(f.key)] = f.label;
    return m;
  }, [sections]);

  // 前置闸生效中的当前节：不渲染表单，渲染解锁提示面板
  const gateActive = !!sectionGate && sectionGate.key === activeSectionKey && sectionGate.locked;

  const currentSection =
    progress.find((item) => item.key === activeSectionKey) ?? progress[0];
  const isFirst = activeSectionKey === sections[0].key;
  const isLast = activeSectionKey === sections[sections.length - 1].key;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden xl:flex-row">
        <aside
          data-tender-panel="nav"
          className="hidden min-h-0 w-[280px] shrink-0 flex-col overflow-hidden rounded-[24px] wb-panel p-3 xl:flex tender-section-enter"
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
                  onAutoFillAll={onAutoFillAll}
                  batchFilling={batchFilling}
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
                {gateActive ? (
                  <div className="mx-auto max-w-[64ch] rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.22)] bg-[oklch(1_0_0_/_0.4)] p-6">
                    <div className="flex items-center gap-2 text-[color:var(--foreground)]">
                      <Lock size={16} className="text-[color:var(--muted-foreground)]" />
                      <span className="text-[0.95rem] font-semibold">评分标准填写尚未开放</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                      评审方法固定为综合评分法，请先完成前四章的全部字段（含采购需求的商务、技术要求）——
                      填写完整后，AI 生成评分标准时将以这些内容为参考，产出更贴合项目的打分规则。
                    </p>
                    <div className="mt-4 space-y-2">
                      {sectionGate!.missing.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => handleSectionSelect(m.key)}
                          className="flex w-full items-center justify-between rounded-[12px] border border-[oklch(0.6_0.04_258_/_0.22)] bg-[oklch(1_0_0_/_0.5)] px-4 py-2.5 text-left transition-all hover:bg-[oklch(1_0_0_/_0.7)]"
                        >
                          <span className="text-sm font-medium text-[color:var(--foreground)]">{m.title}</span>
                          <span className="flex items-center gap-2 text-xs text-[rgba(191,142,52,1)]">
                            待补充 {m.missingFields} 项
                            <span className="text-[color:var(--muted-foreground)]">去填写 →</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                <TenderQuestionnaire
                  draft={draft}
                  sections={sections}
                  fieldLabelMap={fieldLabelMap}
                  activeSectionKey={activeSectionKey}
                  onChange={onChange}
                  onTableChange={onTableChange}
                  onScoringItemsChange={onScoringItemsChange}
                  onFieldFocus={handleFieldFocus}
                  onSampleOpen={handleSampleOpen}
                  onOpenSupplierSelect={onOpenSupplierSelect}
                />
                )}
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
