'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, FileText, Loader2, Search, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
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
import { parseQuotationTextToTable } from '@/components/tender-write/quotation-table-editor';
import {
  buildPrefillFromProject,
  getAiGenerationFields,
  buildAiGenerationContext,
} from '@/lib/tender-write/prefill-from-project';
import { TenderReviewProvider } from '@/components/tender-review/tender-review-provider';
import TenderReviewWorkspace from '@/components/tender-review/tender-review-workspace';
import { uploadReviewDocument, executeReview } from '@/lib/api/review';
import type { ReviewTask } from '@/lib/types/tender-review';
import { fetchKnowledgeBases } from '@/lib/api/knowledge';
import { uploadProjectStageAttachment, updateProjectExtractedInfo, type UploadStageAttachmentResult } from '@/lib/api/project-management';
import { SupplierSelectModal } from '@/components/tender-write/supplier-select-modal';
import { buildTenderSectionProgress } from '@/lib/tender-write/progress';
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

// ── localStorage 持久化（按项目 ID 缓存草稿，关闭后可恢复，避免重复 AI 生成）──
const DRAFTS_STORAGE_PREFIX = 'tender-write:project-drafts:v1:';
const getDraftsStorageKey = (projectId: string) => `${DRAFTS_STORAGE_PREFIX}${projectId}`;
const loadDraftsFromStorage = (projectId: string): TenderDraftsState | null => {
  try {
    const raw = localStorage.getItem(getDraftsStorageKey(projectId));
    if (!raw) return null;
    return JSON.parse(raw) as TenderDraftsState;
  } catch {
    return null;
  }
};
const saveDraftsToStorage = (projectId: string, d: TenderDraftsState) => {
  try {
    localStorage.setItem(getDraftsStorageKey(projectId), JSON.stringify(d));
  } catch { /* quota exceeded — 静默忽略 */ }
};
const clearDraftsStorage = (projectId: string) => {
  try {
    localStorage.removeItem(getDraftsStorageKey(projectId));
  } catch { /* ignore */ }
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  procurementMethod: string | null | undefined;
  projectTitle?: string;
  project: ProjectManagementItem | null;
  /** 文件上传至项目阶段成功后回调，供父面板即时刷新附件列表（无需手动刷新页面） */
  onAttachmentUploaded?: (result: UploadStageAttachmentResult) => void;
  /** 导出上传完成后回调，供父面板刷新项目基本信息（projectOverview/documentAcquireTime 等） */
  onUpdated?: () => Promise<void> | void;
};

export function TenderWriteModal({ isOpen, onClose, procurementMethod, projectTitle, project, onAttachmentUploaded, onUpdated }: Props) {
  const [exporting, setExporting] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [aiDone, setAiDone] = useState(0);
  const [aiTotal, setAiTotal] = useState(0);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  // 审查完成后：等待用户选择是否上传到项目阶段
  const [showReviewUploadDialog, setShowReviewUploadDialog] = useState(false);
  const [supplierSelectOpen, setSupplierSelectOpen] = useState(false);
  const reviewPendingFileRef = useRef<{ blob: Blob; fileName: string } | null>(null);
  const [reviewUploading, setReviewUploading] = useState(false);

  const tenderType = mapProcurementMethodToTenderType(procurementMethod);
  const selectedType: TenderDocumentType | null = tenderType;

  const [drafts, setDrafts] = useState<TenderDraftsState>(createEmptyTenderDrafts());
  const draftRestoredFromStorageRef = useRef(false);
  const [activeSectionKey, setActiveSectionKey] = useState<TenderSectionKey>('cover');
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  // 草稿变更后自动持久化
  useEffect(() => {
    if (project?.id && draftRestoredFromStorageRef.current) {
      saveDraftsToStorage(project.id, drafts);
    }
  }, [drafts, project?.id]);

  // 组件卸载时保存草稿（父组件通过条件渲染直接卸载弹窗，isOpen 始终为 true）
  useEffect(() => {
    const projectId = project?.id;
    return () => {
      if (projectId) {
        saveDraftsToStorage(projectId, draftsRef.current);
      }
    };
  }, [project?.id]);

  // ======== 打开流程：restore + prefill + AI 决策 = 原子 effect ========
  const openFlowRanRef = useRef(false);
  useEffect(() => {
    if (!isOpen) { openFlowRanRef.current = false; return; }
    if (!selectedType || !project) return;
    if (openFlowRanRef.current) return;
    openFlowRanRef.current = true;

    const type = selectedType as TenderDocumentType;
    const typeKey = selectedType as keyof TenderDraftsState;
    const prefill = buildPrefillFromProject(project, selectedType as TenderDocumentType);
    const aiFields = getAiGenerationFields(type);

    // Step 1: 检查 localStorage 是否有已保存的草稿
    const saved = loadDraftsFromStorage(project.id);
    const hasSavedAiContent = saved
      ? aiFields.some((f) => String((saved[typeKey] as Record<string, unknown>)?.[f.fieldKey] ?? '').trim().length > 0)
      : false;

    if (saved && hasSavedAiContent) {
      // 已有完整草稿 → 合并 prefill（仅非空字段），直接进工作区
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prefill)) {
        if (v != null && v !== '') filtered[k] = v;
      }
      const merged = { ...saved, [typeKey]: { ...(saved[typeKey] ?? {}), ...filtered } };
      setDrafts(merged);
      draftRestoredFromStorageRef.current = true;
      setShowWorkspace(true);
      return;
    }

    // Step 2: 无草稿 → 从项目数据预填后触发 AI 生成
    if (saved && !hasSavedAiContent) {
      // 有保存记录但无 AI 内容（可能是首次打开后意外关闭）→ 合并后继续生成
      setDrafts(saved);
    }
    // 延迟一帧合并 prefill（确保 saved 的状态已落盘）
    setDrafts((prev) => {
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prefill)) {
        if (v != null && v !== '') filtered[k] = v;
      }
      return { ...prev, [typeKey]: { ...(prev[typeKey] ?? {}), ...filtered } };
    });

    // Step 3: 触发 AI 逐字段生成
    if (aiFields.length === 0) {
      setShowWorkspace(true);
      return;
    }

    const context = buildAiGenerationContext(project);
    setAiGenerating(true);
    setAiDone(0);
    setAiTotal(aiFields.length);

    (async () => {
      for (let i = 0; i < aiFields.length; i++) {
        const f = aiFields[i];
        setAiProgress(`${f.label}（${i + 1}/${aiFields.length}）`);
        setAiDone(i + 1);

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
            // 清理 AI 输出中的乱码字符（U+FFFD / 连续问号）
            const cleaned = result.content
              .replace(/�/g, '')
              .replace(/\?{2,}(?=\s|$|。|，|；)/g, '')
              .replace(/\s+$/, '');
            const isQuotationField = f.fieldKey === 'quotationLetter';
            const tableData = isQuotationField ? parseQuotationTextToTable(cleaned) : null;
            setDrafts((prev) => {
              const emptyFn = {
                COMPETITIVE_NEGOTIATION: createEmptyCompetitiveNegotiationDraft,
                SINGLE_SOURCE: createEmptySingleSourceDraft,
                INQUIRY_PURCHASE: createEmptyInquiryPurchaseDraft,
                INTERNAL_BIDDING: createEmptyInternalBiddingDraft,
                INVITED_BIDDING: createEmptyInvitedBiddingDraft,
              }[type];
              const base = { ...(emptyFn?.() ?? {}), ...(prev[typeKey] ?? {}) };
              if (tableData) {
                return {
                  ...prev,
                  [typeKey]: {
                    ...base,
                    quotationLetterType: 'table',
                    quotationLetterTable: tableData,
                    [f.fieldKey]: cleaned,
                  },
                };
              }
              return { ...prev, [typeKey]: { ...base, [f.fieldKey]: cleaned } };
            });
          }
        } catch { /* single field failure doesn't stop */ }
        await new Promise((r) => setTimeout(r, 300));
      }
      setAiProgress('');
      setAiGenerating(false);
      setShowWorkspace(true);
      draftRestoredFromStorageRef.current = true;
    })();
  }, [isOpen, selectedType, project]);

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

  /** 所有章节是否已全部填完（进度计算与侧边栏导航保持一致）。 */
  const isDraftComplete = useMemo(() => {
    if (!selectedType || !currentSections.length) return false;
    const progress = buildTenderSectionProgress(currentSections, currentDraft, activeSectionKey);
    return progress.every((p) => p.state === 'completed' || p.state === 'active-complete');
  }, [currentSections, currentDraft, activeSectionKey, selectedType]);

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

  const updateDraftTable = useCallback(
    (tableData: TableData | undefined) => {
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
            quotationLetterTable: tableData,
          },
        };
      });
    },
    [selectedType],
  );

  // ---------- 智能填入未填项 ----------
  const [batchFilling, setBatchFilling] = useState(false);
  const handleAutoFillAll = useCallback(async () => {
    if (!selectedType || !project) return;
    const type = selectedType as TenderDocumentType;
    const typeKey = selectedType as keyof TenderDraftsState;
    const aiFields = getAiGenerationFields(type);
    const context = buildAiGenerationContext(project);
    const currentDraftRef = draftsRef.current[typeKey] as Record<string, string>;
    const emptyFields = aiFields.filter((f) => {
      const val = currentDraftRef?.[f.fieldKey];
      return !val?.trim();
    });
    if (emptyFields.length === 0) {
      toast.success('所有可 AI 生成的字段均已填写');
      return;
    }
    setBatchFilling(true);
    for (const f of emptyFields) {
      try {
        const result = await generateFieldContent({
          fieldKey: f.fieldKey as TenderFieldKey,
          fieldLabel: f.label,
          currentValue: '',
          aiPrompt: f.aiPrompt,
          context,
        });
        if (result.content) {
          const cleaned = result.content.replace(/�/g, '').replace(/\?{2,}(?=\s|$|。|，|；)/g, '').replace(/\s+$/, '');
          updateDraft(f.fieldKey as TenderFieldKey, cleaned);
        }
      } catch { /* single field failure doesn't stop */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    setBatchFilling(false);
    toast.success(`已填入 ${emptyFields.length} 个字段`);
  }, [selectedType, project, updateDraft]);

  // ---------- 导出 / 审查 ----------

  const handleExport = useCallback(() => {
    if (!selectedType || !isDraftComplete) {
      toast.error('请先完成所有章节的填写，再导出采购文件。');
      return;
    }
    setShowExportDialog(true);
  }, [selectedType, isDraftComplete]);

  /** 直接导出：下载文件 + 上传至项目采购文件阶段。 */
  const handleDirectExport = useCallback(async () => {
    if (!selectedType || !project) return;
    setExporting(true);
    setErrorMessage(null);
    try {
      const result = await exportTenderDocument({ documentType: selectedType, answers: currentDraft });
      // 下载
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);
      setSuccessMessage('导出成功');
      setTimeout(() => setSuccessMessage(null), 2000);
      // 上传至项目阶段
      try {
        const file = new File([result.blob], result.fileName, {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const uploaded = await uploadProjectStageAttachment(project.id, 'TENDER_DOCUMENT', file);
        onAttachmentUploaded?.(uploaded);
        // 同步 tender-write draft 中的字段到项目基本信息（绕过 PDF 解析）
        // 不同模板的字段名不同：projectOverview/projectIntroduction、documentAcquireTime 等
        const draftRecord = currentDraft as Record<string, string>;
        const infoUpdate: Record<string, string> = {};
        const overviewKey = selectedType === 'INQUIRY_PURCHASE' ? 'projectIntroduction' : 'projectOverview';
        const overviewVal = draftRecord[overviewKey]?.trim();
        if (overviewVal) infoUpdate.projectOverview = overviewVal;
        const acquireVal = draftRecord['documentAcquireTime']?.trim();
        if (acquireVal) infoUpdate.documentAcquireTime = acquireVal;
        const evalVal = draftRecord['evaluationMethod']?.trim();
        if (evalVal) { infoUpdate.evaluationMethod = evalVal /* 非ExtractedInfo字段但DB接受 */; }
        if (Object.keys(infoUpdate).length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          try { await updateProjectExtractedInfo(project.id, infoUpdate as any); } catch { /* 同步失败不阻塞 */ }
        }
        // 刷新父组件项目数据，使基本信息中刚写入的 projectOverview / documentAcquireTime
        // / evaluationMethod 等字段即时显示，避免必须手动刷新页面。
        try { await onUpdated?.(); } catch { /* 刷新失败不阻塞导出 */ }
        toast.success('采购文件已上传至项目采购文件阶段');
      } catch {
        // 上传失败不阻塞导出
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
      setShowExportDialog(false);
    }
  }, [selectedType, currentDraft, project, onAttachmentUploaded, onUpdated]);

  /** 导出并导入审查：生成 DOCX → 上传审查服务 → 启动审查 → 打开审查窗口。 */
  const handleExportAndReview = useCallback(async () => {
    if (!selectedType) return;
    setReviewLoading(true);
    setErrorMessage(null);
    try {
      // 1. 生成 DOCX
      const result = await exportTenderDocument({ documentType: selectedType, answers: currentDraft });
      const file = new File([result.blob], result.fileName, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      // 2. 上传至审查服务
      const uploadResult = await uploadReviewDocument(file);

      // 3. 取知识库
      const kbs = await fetchKnowledgeBases();
      const activeKb = kbs.find((kb) => kb.isActive);
      if (!activeKb) {
        toast.error('未找到可用的知识库，请先在审查模块中创建知识库。');
        return;
      }

      // 4. 启动审查
      await executeReview({
        knowledgeBaseId: activeKb.id,
        reviewMode: 'general',
        documentContent: uploadResult.content,
        documentName: uploadResult.documentName,
        objectKey: uploadResult.objectKey,
      });
      toast.success('已导入审查并启动分析');

      // 5. 打开审查窗口
      setShowReview(true);
      setShowExportDialog(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导入审查失败';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setReviewLoading(false);
    }
  }, [selectedType, currentDraft]);

  /** 审查完成 → 重新导出当前草稿，由用户决定是否上传至项目采购文件阶段。 */
  const handleReviewComplete = useCallback(async (_task: ReviewTask) => {
    if (!selectedType) return;
    try {
      const result = await exportTenderDocument({ documentType: selectedType, answers: currentDraft });
      reviewPendingFileRef.current = { blob: result.blob, fileName: result.fileName };
      setShowReviewUploadDialog(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    }
  }, [selectedType, currentDraft]);

  /** 审查完成后用户确认上传 */
  const handleConfirmReviewUpload = useCallback(async () => {
    const pending = reviewPendingFileRef.current;
    if (!pending || !project) return;
    setReviewUploading(true);
    try {
      const file = new File([pending.blob], pending.fileName, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const uploaded = await uploadProjectStageAttachment(project.id, 'TENDER_DOCUMENT', file);
      onAttachmentUploaded?.(uploaded);
      // 同步 tender-write draft 中的字段到项目基本信息（绕过 PDF 解析）
      const draftRecord2 = currentDraft as Record<string, string>;
      const infoUpdate2: Record<string, string> = {};
      const overviewKey2 = selectedType === 'INQUIRY_PURCHASE' ? 'projectIntroduction' : 'projectOverview';
      const overviewVal2 = draftRecord2[overviewKey2]?.trim();
      if (overviewVal2) infoUpdate2.projectOverview = overviewVal2;
      const acquireVal2 = draftRecord2['documentAcquireTime']?.trim();
      if (acquireVal2) infoUpdate2.documentAcquireTime = acquireVal2;
      const evalVal2 = draftRecord2['evaluationMethod']?.trim();
      if (evalVal2) { infoUpdate2.evaluationMethod = evalVal2; }
      if (Object.keys(infoUpdate2).length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        try { await updateProjectExtractedInfo(project.id, infoUpdate2 as any); } catch { /* 同步失败不阻塞 */ }
      }
      toast.success('采购文件已提交至项目采购文件阶段');
      setShowReviewUploadDialog(false);
      setShowReview(false);
      reviewPendingFileRef.current = null;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败');
    } finally {
      setReviewUploading(false);
    }
  }, [project, onAttachmentUploaded]);

  /** 审查完成后用户选择不上传 */
  const handleSkipReviewUpload = useCallback(() => {
    setShowReviewUploadDialog(false);
    setShowReview(false);
    reviewPendingFileRef.current = null;
  }, []);

  // ----------

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
              onClick={() => {
                if (!isDraftComplete) {
                  toast.error('请先完成所有章节的填写，再进行审查。');
                  return;
                }
                handleExportAndReview();
              }}
              disabled={reviewLoading}
              className="neu-btn-soft gap-2 h-9 text-xs"
            >
              {reviewLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
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
              onTableChange={updateDraftTable}
              onOpenSupplierSelect={() => setSupplierSelectOpen(true)}
              onAutoFillAll={handleAutoFillAll}
              batchFilling={batchFilling}
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

      {/* 导出前确认对话框 */}
      {showExportDialog && (
        <div className="fixed inset-0 z-[650] flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'oklch(0.1 0.02 258 / 0.42)', backdropFilter: 'blur(4px)' }}
            onClick={() => setShowExportDialog(false)}
          />
          <div
            className="relative z-10 mx-4 w-full max-w-[380px] rounded-[22px] p-6"
            style={{
              background: 'linear-gradient(170deg, oklch(1 0 0 / 0.95), oklch(0.985 0.005 258 / 0.65))',
              boxShadow:
                'inset 0 1px 0 oklch(1 0 0 / 0.9), 4px 5px 18px oklch(0.45 0.07 258 / 0.2), -2px -2px 8px oklch(1 0 0 / 0.9)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[0.95rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                导出采购文件
              </h2>
              <button type="button" onClick={() => setShowExportDialog(false)} className="neu-btn-xs"><X size={16} /></button>
            </div>
            <p className="mt-2.5 text-sm leading-[1.6] text-[color:var(--muted-foreground)]">
              文件已生成，是否直接进行合规审查？
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={handleDirectExport}
                disabled={exporting}
                className="neu-btn-soft flex-1 gap-2 !h-10 text-sm"
              >
                {exporting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <FileDown size={14} />
                )}
                否，直接导出
              </button>
              <button
                type="button"
                onClick={handleExportAndReview}
                disabled={reviewLoading}
                className="neu-btn-primary flex-1 gap-2 !h-10 text-sm"
              >
                {reviewLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Search size={14} />
                )}
                是，导出并审查
              </button>
            </div>
          </div>
        </div>
      )}

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
              <TenderReviewProvider onReviewComplete={handleReviewComplete}>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden h-full">
                  <TenderReviewWorkspace />
                </div>
              </TenderReviewProvider>
            </div>
          </div>
        </div>
      )}

      {/* 审查完成后：用户选择是否上传到项目采购文件阶段 */}
      {showReviewUploadDialog && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'oklch(0.1 0.02 258 / 0.42)', backdropFilter: 'blur(4px)' }}
            onClick={handleSkipReviewUpload}
          />
          <div
            className="relative z-10 mx-4 w-full max-w-[380px] rounded-[22px] p-6"
            style={{
              background: 'linear-gradient(170deg, oklch(1 0 0 / 0.95), oklch(0.985 0.005 258 / 0.65))',
              boxShadow:
                'inset 0 1px 0 oklch(1 0 0 / 0.9), 4px 5px 18px oklch(0.45 0.07 258 / 0.2), -2px -2px 8px oklch(1 0 0 / 0.9)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[0.95rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                审查已完成
              </h2>
              <button type="button" onClick={handleSkipReviewUpload} className="neu-btn-xs"><X size={16} /></button>
            </div>
            <p className="mt-2.5 text-sm leading-[1.6] text-[color:var(--muted-foreground)]">
              是否将审查后的采购文件提交至项目采购文件阶段？
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={handleSkipReviewUpload}
                disabled={reviewUploading}
                className="neu-btn-soft flex-1 gap-2 !h-10 text-sm"
              >
                暂不上传
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmReviewUpload()}
                disabled={reviewUploading}
                className="neu-btn-primary flex-1 gap-2 !h-10 text-sm"
              >
                {reviewUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                提交至项目阶段
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 供应商抽选弹窗（直接采购） */}
      {supplierSelectOpen && project && (
        <SupplierSelectModal
          isOpen
          projectId={project.id}
          onClose={() => setSupplierSelectOpen(false)}
          onSelect={(supplierName) => {
            updateDraft('supplierName' as any, supplierName);
            setSupplierSelectOpen(false);
          }}
        />
      )}
    </div>
  );
}
