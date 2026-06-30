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

    // 如果有聚焦的字段，滚动到该字段
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

    // 否则滚动到章节
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
        // 居中显示
        const scrollTo = Math.max(0, relativeTop - rootHeight / 2 + targetHeight / 2);
        root.scrollTo({ top: scrollTo, behavior: 'smooth' });
      } else {
        // 判断是否为最后一个章节
        const allSections = root.querySelectorAll<HTMLElement>('[id^="preview-"]');
        const isLastSection = allSections.length > 0 && allSections[allSections.length - 1] === target;

        if (isLastSection) {
          // 最后一项：底部对齐
          const scrollTo = scrollHeight - rootHeight;
          root.scrollTo({ top: Math.max(0, scrollTo), behavior: 'smooth' });
        } else {
          // 其他项：顶部对齐
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
      className="tender-preview-shell flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,250,255,0.92))] shadow-[0_18px_40px_rgba(59,89,143,0.08)] tender-section-enter-delay-2"
    >
      <div className="border-b border-white/60 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[52ch]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(94,126,189,0.76)]">
              完整预览
            </div>
            <div className="mt-2 text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
              {previewHeadline}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
              <span className="rounded-full border border-white/65 bg-white/84 px-2.5 py-1 transition-all duration-200">
                {selectedMeta.label}
              </span>
              <span className="rounded-full border border-[rgba(96,139,239,0.16)] bg-[rgba(96,139,239,0.08)] px-2.5 py-1 text-[rgba(87,126,214,1)] transition-all duration-200">
                当前定位：第 {activeSectionIndex + 1} 组 · {activeSectionTitle}
              </span>
            </div>
          </div>
          <div className="grid gap-2 text-right">
            <div className="rounded-[18px] border border-white/65 bg-white/84 px-3.5 py-2 text-[11px] font-semibold text-[color:var(--muted-foreground)] transition-all duration-200">
              已完成 {completedSections}/{progress.length} 组
            </div>
            <div className="rounded-[18px] border border-[rgba(230,129,102,0.14)] bg-[rgba(255,247,244,0.86)] px-3.5 py-2 text-[11px] font-semibold text-[rgba(199,108,83,1)] transition-all duration-200">
              待补充 {missingFieldCount} 项
            </div>
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none tender-scroll"
      >
        <div className="tender-preview-body rounded-[20px] border border-[rgba(230,236,248,0.86)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(247,249,255,0.88))] p-2 pb-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
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
