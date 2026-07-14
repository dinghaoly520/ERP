'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, FileText, Search, X } from 'lucide-react';
import { TenderWriteWorkspace } from '@/components/tender-write/tender-write-workspace';
import { mapProcurementMethodToTenderType } from '@/lib/tender-write/procurement-method-map';
import {
  COMPETITIVE_NEGOTIATION_SECTIONS,
  createEmptyCompetitiveNegotiationDraft,
  createEmptySingleSourceDraft,
  createEmptyInquiryPurchaseDraft,
  createEmptyInternalBiddingDraft,
  createEmptyInvitedBiddingDraft,
  createEmptyTenderDrafts,
  SINGLE_SOURCE_SECTIONS,
  INQUIRY_PURCHASE_SECTIONS,
  INTERNAL_BIDDING_SECTIONS,
  INVITED_BIDDING_SECTIONS,
  TENDER_DOCUMENT_TYPES,
} from '@/lib/tender-write/templates';
import { exportTenderDocument } from '@/lib/api/tender-write';
import { generateFieldContent } from '@/lib/api/tender-sample';
import {
  buildPrefillFromProject,
  getAiGenerationFields,
  buildAiGenerationContext,
} from '@/lib/tender-write/prefill-from-project';
import { TenderReviewProvider } from '@/components/tender-review/tender-review-provider';
import TenderReviewWorkspace from '@/components/tender-review/tender-review-workspace';
import type {
  ReadyTenderDocumentType,
  ReadyTenderDraft,
  TenderDocumentType,
  TenderDraftsState,
  TenderFieldKey,
  TenderSectionConfig,
  TenderSectionKey,
  TableData,
} from '@/lib/types/tender-write';
import type { ProjectManagementItem } from '@/lib/types/project-management';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  procurementMethod: string | null | undefined;
  projectTitle?: string;
  project: ProjectManagementItem | null;
};

export function TenderWriteModal({ isOpen, onClose, procurementMethod, projectTitle, project }: Props) {
  const [exporting, setExporting] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [aiDone, setAiDone] = useState(0);
  const [aiTotal, setAiTotal] = useState(0);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tenderType = mapProcurementMethodToTenderType(procurementMethod);
  const selectedType: TenderDocumentType | null = tenderType;

  const [drafts, setDrafts] = useState<TenderDraftsState>(createEmptyTenderDrafts());
  const [activeSectionKey, setActiveSectionKey] = useState<TenderSectionKey>('cover');
  const [prefilled, setPrefilled] = useState(false);
  const aiGenTriggeredRef = useRef(false);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  // 关闭时全部重置
  useEffect(() => {
    if (!isOpen) {
      setPrefilled(false);
      setShowWorkspace(false);
      aiGenTriggeredRef.current = false;
      setAiGenerating(false);
      setAiProgress('');
      setAiDone(0);
      setAiTotal(0);
    }
  }, [isOpen]);

  // 首次打开时从项目数据预填
  useEffect(() => {
    if (!isOpen || !selectedType || !project || prefilled) return;
    const prefill = buildPrefillFromProject(project, selectedType as TenderDocumentType);
    setDrafts((prev) => {
      const typeKey = selectedType as keyof TenderDraftsState;
      return { ...prev, [typeKey]: { ...prev[typeKey], ...prefill } };
    });
    setPrefilled(true);
  }, [isOpen, selectedType, project, prefilled]);

  // 预填完成后自动触发 AI 生成，生成完毕才进入工作区
  useEffect(() => {
    if (!prefilled || !selectedType || aiGenTriggeredRef.current) return;
    aiGenTriggeredRef.current = true;

    const type = selectedType as TenderDocumentType;
    const fields = project
      ? getAiGenerationFields(type)
      : [];

    if (fields.length === 0) {
      // 不需要 AI 生成，直接进入工作区
      setShowWorkspace(true);
      return;
    }

    const context = buildAiGenerationContext(project!);
    setAiGenerating(true);
    setAiDone(0);
    setAiTotal(fields.length);

    (async () => {
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        setAiProgress(`${f.label}（${i + 1}/${fields.length}）`);
        setAiDone(i + 1);

        // 跳过已有内容的字段
        const typeKey = type as keyof TenderDraftsState;
        const current = String((draftsRef.current[typeKey] as Record<string, string>)?.[f.fieldKey] ?? '');
        if (current.trim()) continue;

        try {
          const result = await generateFieldContent({
            fieldKey: f.fieldKey,
            fieldLabel: f.label,
            currentValue: '',
            aiPrompt: f.aiPrompt,
            context,
          });
          if (result.content) {
            setDrafts((prev) => {
              const tk = type as keyof TenderDraftsState;
              const emptyFn = {
                COMPETITIVE_NEGOTIATION: createEmptyCompetitiveNegotiationDraft,
                SINGLE_SOURCE: createEmptySingleSourceDraft,
                INQUIRY_PURCHASE: createEmptyInquiryPurchaseDraft,
                INTERNAL_BIDDING: createEmptyInternalBiddingDraft,
                INVITED_BIDDING: createEmptyInvitedBiddingDraft,
              }[type];
              return {
                ...prev,
                [tk]: { ...(emptyFn?.() ?? {}), ...(prev[tk] ?? {}), [f.fieldKey]: result.content },
              };
            });
          }
        } catch {
          // 单个字段失败不中断整体流程
        }

        await new Promise((r) => setTimeout(r, 300));
      }

      setAiProgress('');
      setAiGenerating(false);
      setShowWorkspace(true);
    })();
  }, [prefilled, selectedType, project]);

  const selectedMeta = useMemo(
    () => TENDER_DOCUMENT_TYPES.find((item) => item.type === selectedType) ?? null,
    [selectedType],
  );

  const currentSections: TenderSectionConfig[] = useMemo(() => {
    if (selectedType === 'COMPETITIVE_NEGOTIATION') return COMPETITIVE_NEGOTIATION_SECTIONS;
    if (selectedType === 'SINGLE_SOURCE') return SINGLE_SOURCE_SECTIONS;
    if (selectedType === 'INQUIRY_PURCHASE') return INQUIRY_PURCHASE_SECTIONS;
    if (selectedType === 'INTERNAL_BIDDING') return INTERNAL_BIDDING_SECTIONS;
    if (selectedType === 'INVITED_BIDDING') return INVITED_BIDDING_SECTIONS;
    return [];
  }, [selectedType]);

  const currentDraft: ReadyTenderDraft = useMemo(() => {
    if (selectedType === 'COMPETITIVE_NEGOTIATION') {
      return { ...createEmptyCompetitiveNegotiationDraft(), ...(drafts.COMPETITIVE_NEGOTIATION ?? {}) };
    }
    if (selectedType === 'SINGLE_SOURCE') {
      return { ...createEmptySingleSourceDraft(), ...(drafts.SINGLE_SOURCE ?? {}) };
    }
    if (selectedType === 'INQUIRY_PURCHASE') {
      return { ...createEmptyInquiryPurchaseDraft(), ...(drafts.INQUIRY_PURCHASE ?? {}) };
    }
    if (selectedType === 'INTERNAL_BIDDING') {
      return { ...createEmptyInternalBiddingDraft(), ...(drafts.INTERNAL_BIDDING ?? {}) };
    }
    if (selectedType === 'INVITED_BIDDING') {
      return { ...createEmptyInvitedBiddingDraft(), ...(drafts.INVITED_BIDDING ?? {}) };
    }
    return createEmptyCompetitiveNegotiationDraft();
  }, [selectedType, drafts]);

  const updateDraft = useCallback(
    (key: TenderFieldKey, value: string) => {
      if (!selectedType) return;
      setDrafts((prev) => {
        const typeKey = selectedType as keyof TenderDraftsState;
        const emptyFn = {
          COMPETITIVE_NEGOTIATION: createEmptyCompetitiveNegotiationDraft,
          SINGLE_SOURCE: createEmptySingleSourceDraft,
          INQUIRY_PURCHASE: createEmptyInquiryPurchaseDraft,
          INTERNAL_BIDDING: createEmptyInternalBiddingDraft,
          INVITED_BIDDING: createEmptyInvitedBiddingDraft,
        }[selectedType];
        return {
          ...prev,
          [typeKey]: {
            ...(emptyFn?.() ?? {}),
            ...(prev[typeKey] ?? {}),
            [key]: value,
          },
        };
      });
    },
    [selectedType],
  );

  const handleExport = useCallback(async () => {
    if (!selectedType) return;
    setExporting(true);
    setErrorMessage(null);
    try {
      const result = await exportTenderDocument({
        documentType: selectedType,
        answers: currentDraft,
      });
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);
      setSuccessMessage('导出成功');
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }, [selectedType, currentDraft]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  if (!selectedType || !selectedMeta) {
    return (
      <div className="fixed inset-0 z-[500] flex items-center justify-center">
        <div
          className="absolute inset-0"
          style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        />
        <div
          className="relative z-10 mx-4 w-full max-w-lg rounded-[24px] p-8 text-center"
          style={{
            background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.985 0.005 258 / 0.6))',
            boxShadow:
              'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 14px oklch(0.48 0.06 258 / 0.16), -2px -2px 8px oklch(1 0 0 / 0.92)',
          }}
        >
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[14px]"
            style={{
              background: 'color-mix(in oklch, var(--muted) 35%, transparent)',
              boxShadow:
                'inset 1px 2px 4px oklch(0.55 0.04 258 / 0.14), inset -1px -1px 2px oklch(1 0 0 / 0.7)',
            }}
          >
            <FileText size={24} className="text-[var(--muted-foreground)]" />
          </div>
          <p className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
            {procurementMethod ? `「${procurementMethod}」暂不支持在线编写采购文件` : '当前项目未设置采购方式'}
          </p>
          <p className="mt-2 text-xs leading-[1.55] text-[var(--muted-foreground)]">
            请在项目详情中补充采购方式，或前往采购文件编写页面选择模板。
          </p>
          <button type="button" onClick={onClose} className="neu-btn-primary mt-6 px-6">
            关闭
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[500] flex flex-col">
      {/* 遮罩 */}
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />

      {/* 窗口容器 */}
      <div
        className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        {/* 标题栏 */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
          style={{
            background:
              'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
              style={{
                background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)',
                boxShadow:
                  'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)',
              }}
            >
              <FileText size={17} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] truncate">
                采购文件编写
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span
                  className="rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                    color: 'var(--accent)',
                  }}
                >
                  {selectedMeta.label}
                </span>
                <span className="text-[11px] text-[var(--muted-foreground)] truncate">
                  {projectTitle ?? '未命名项目'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {successMessage && (
              <span className="text-xs font-semibold text-[color:var(--success)]">{successMessage}</span>
            )}
            {errorMessage && (
              <span className="text-xs font-semibold text-[color:var(--danger)]">{errorMessage}</span>
            )}
            <button
              type="button"
              onClick={() => setShowReview(true)}
              className="neu-btn-soft gap-2 h-9 text-xs"
            >
              <Search size={14} />
              采购文件审查
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="neu-btn-soft gap-2 h-9 text-xs"
            >
              <FileDown size={14} />
              {exporting ? '导出中…' : '导出采购文件'}
            </button>
            <button type="button" onClick={onClose} className="neu-btn-soft !p-2">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 正文 */}
        <div
          className="flex-1 min-h-0 overflow-hidden flex flex-col p-5"
          style={{
            background:
              'oklch(0.975 0.012 258 / 0.32)',
            boxShadow:
              'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)',
          }}
        >
          {showWorkspace ? (
            <TenderWriteWorkspace
              documentType={selectedType as ReadyTenderDocumentType}
              draft={currentDraft}
              sections={currentSections}
              selectedMeta={selectedMeta}
              activeSectionKey={activeSectionKey}
              onSectionSelect={setActiveSectionKey}
              onChange={updateDraft}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-4 w-full max-w-[380px]">
                <FileText size={36} className="text-[var(--muted-foreground)]" />
                <div className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                  正在智能生成采购文件内容
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)] text-center leading-[1.55]">
                  基于项目信息和采购方式，AI 正在自动填充各章节内容，请稍候…
                </div>
                <div className="w-full space-y-2">
                  <div className="flex justify-between text-[10px] font-semibold text-[var(--muted-foreground)]">
                    <span>{aiProgress || '准备中…'}</span>
                    <span className="tabular-nums">{aiTotal > 0 ? `${aiDone}/${aiTotal}` : ''}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[oklch(0.55_0.03_258_/_0.1)]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${aiTotal > 0 ? (aiDone / aiTotal) * 100 : 5}%`,
                        background: 'linear-gradient(90deg, oklch(0.5 0.16 258 / 0.9), oklch(0.6 0.1 258 / 0.7))',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 采购文件审查弹窗 */}
      {showReview && (
        <div className="fixed inset-0 z-[600] flex flex-col">
          <div
            className="absolute inset-0"
            style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
            onClick={() => setShowReview(false)}
          />
          <div
            className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
            style={{
              background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
              boxShadow:
                'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
            }}
          >
            <div
              className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
              style={{
                background:
                  'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
                borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
                  style={{
                    background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)',
                    boxShadow:
                      'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)',
                  }}
                >
                  <Search size={17} className="text-[var(--accent)]" />
                </div>
                <div className="min-w-0">
                  <div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] truncate">
                    采购文件审查
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                    基于知识库规则引擎 + AI 语义分析，对采购文件进行合规性智能审查
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setShowReview(false)} className="neu-btn-soft !p-2">
                <X size={16} />
              </button>
            </div>
            <div
              className="flex-1 min-h-0 overflow-hidden flex flex-col"
              style={{
                background: 'oklch(0.975 0.012 258 / 0.32)',
                boxShadow:
                  'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)',
              }}
            >
              <TenderReviewProvider>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden h-full">
                  <TenderReviewWorkspace />
                </div>
              </TenderReviewProvider>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
