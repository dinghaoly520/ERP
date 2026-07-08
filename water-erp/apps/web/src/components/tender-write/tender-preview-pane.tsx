import { useEffect, useMemo, useRef } from 'react';
import type {
  ReadyTenderDocumentType,
  ReadyTenderDraft,
  TenderSectionKey,
  TenderSectionProgress,
  TenderDocumentTypeMeta,
  TenderFieldKey,
} from '../../lib/types/tender-write';
import { TenderPreviewDocument } from './tender-preview-document';

export function TenderPreviewPane({
  documentType,
  draft,
  activeSectionKey,
  selectedMeta,
  progress,
  onSectionClick,
  scrollToCenter = false,
  focusedFieldKey,
  onValueChange,
}: {
  documentType: ReadyTenderDocumentType;
  draft: ReadyTenderDraft;
  activeSectionKey: TenderSectionKey;
  selectedMeta: TenderDocumentTypeMeta;
  progress: TenderSectionProgress[];
  onSectionClick?: (key: TenderSectionKey) => void;
  scrollToCenter?: boolean;
  focusedFieldKey?: string;
  onValueChange?: (fieldKey: TenderFieldKey, value: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    if (scrollToCenter && focusedFieldKey) {
      const fieldTarget = root.querySelector<HTMLElement>(`#preview-field-${focusedFieldKey}`);
      if (fieldTarget) {
        requestAnimationFrame(() => {
          const rootRect = root.getBoundingClientRect();
          const targetRect = fieldTarget.getBoundingClientRect();
          const relativeTop = targetRect.top - rootRect.top + root.scrollTop;
          const targetHeight = targetRect.height;
          const rootHeight = rootRect.height;
          const scrollTo = Math.max(0, relativeTop - rootHeight / 2 + targetHeight / 2);
          root.scrollTo({ top: scrollTo, behavior: 'smooth' });
        });
        return;
      }
    }

    const target = root.querySelector<HTMLElement>(`#preview-${activeSectionKey}`);
    if (!target) return;

    requestAnimationFrame(() => {
      const rootRect = root.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const relativeTop = targetRect.top - rootRect.top + root.scrollTop;
      const targetHeight = targetRect.height;
      const rootHeight = rootRect.height;
      const scrollHeight = root.scrollHeight;

      if (scrollToCenter) {
        const scrollTo = Math.max(0, relativeTop - rootHeight / 2 + targetHeight / 2);
        root.scrollTo({ top: scrollTo, behavior: 'smooth' });
      } else {
        const allSections = root.querySelectorAll<HTMLElement>('[id^="preview-"]');
        const isLastSection = allSections.length > 0 && allSections[allSections.length - 1] === target;

        if (isLastSection) {
          const scrollTo = scrollHeight - rootHeight;
          root.scrollTo({ top: Math.max(0, scrollTo), behavior: 'smooth' });
        } else {
          root.scrollTo({ top: Math.max(0, relativeTop), behavior: 'smooth' });
        }
      }
    });
  }, [activeSectionKey, scrollToCenter, focusedFieldKey]);

  const completedSections = progress.filter((item) => item.missingFields === 0).length;
  const missingFieldCount = progress.reduce((sum, item) => sum + item.missingFields, 0);
  const activeSectionTitle =
    progress.find((item) => item.key === activeSectionKey)?.title ?? '未定位章节';
  const previewHeadline = useMemo(() => {
    return draft.projectName.trim() ? `${draft.projectName} · 成稿预览` : '成稿预览';
  }, [draft.projectName]);

  const activeSectionIndex = Math.max(
    progress.findIndex((item) => item.key === activeSectionKey),
    0,
  );

  return (
    <aside
      data-tender-panel="preview"
      className="flex min-h-0 flex-1 flex-col overflow-hidden tender-section-enter-delay-2"
    >
      {/* Header — lightweight, no nested card frames */}
      <div className="px-4 py-2.5" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-[48ch]">
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">
              完整预览
            </div>
            <div className="mt-1 text-sm font-semibold tracking-[-0.025em] text-[color:var(--foreground)]">
              {previewHeadline}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="rounded-[5px] bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-1.5 py-0.5 font-medium text-[color:var(--accent)]">
                {selectedMeta.label}
              </span>
              <span className="text-[color:var(--muted-foreground)]">
                第 {activeSectionIndex + 1} 组 · {activeSectionTitle}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-semibold">
            <div className="flex items-center gap-1 text-[color:var(--foreground)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              {completedSections}/{progress.length} 组
            </div>
            {missingFieldCount > 0 && (
              <div className="flex items-center gap-1 text-[color:var(--danger)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" />
                +{missingFieldCount}
              </div>
            )}
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none tender-scroll"
      >
        <div className="px-1 pb-6">
          <TenderPreviewDocument
            documentType={documentType}
            draft={draft}
            activeSectionKey={activeSectionKey}
            onSectionClick={onSectionClick}
            onValueChange={onValueChange}
          />
        </div>
      </div>
    </aside>
  );
}
