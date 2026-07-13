"use client";

// File System Access API type declaration
declare global {
  interface Window {
    showSaveFilePicker: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle>;
  }
}

import { useEffect, useMemo, useState } from "react";
import { Eraser, FileDown, FileText, History, Megaphone, Save, ScanText, Mail } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { LoginErrorDialog } from "@/components/login/login-error-dialog";
import { TenderHistoryDialog } from "@/components/tender-write/tender-history-dialog";
import { ImportAutofillButton } from "@/components/tender-write/import-autofill-button";
import { ImportAutofillDialog } from "@/components/tender-write/import-autofill-dialog";
import { TenderWriteWorkspace } from "@/components/tender-write/tender-write-workspace";
import { TenderTypeSwitcher } from "@/components/tender-write/tender-type-switcher";
import { AnnouncementDialog } from "@/components/tender-write/announcement-dialog";
import { NotificationHubDialog } from "@/components/tender-write/notification-hub-dialog";
import type { ImportAutofillFieldResult } from "@/lib/types/tender-write-import";
import { createTenderHistory } from "@/lib/api/tender-history";
import { exportTenderDocument } from "@/lib/api/tender-write";
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
} from "@/lib/tender-write/templates";
import {
  readTenderWriteState,
  resetTenderDraftByType,
  writeTenderWriteState,
} from "@/lib/tender-write/storage";
import type {
  CompetitiveNegotiationDraft,
  CompetitiveNegotiationFieldKey,
  ReadyTenderDocumentType,
  ReadyTenderDraft,
  SingleSourceDraft,
  SingleSourceFieldKey,
  InquiryPurchaseDraft,
  InquiryPurchaseFieldKey,
  InternalBiddingDraft,
  InternalBiddingFieldKey,
  InvitedBiddingDraft,
  InvitedBiddingFieldKey,
  TableData,
  TenderDocumentType,
  TenderDraftsState,
  TenderHistoryRecord,
  TenderSectionConfig,
  TenderSectionKey,
} from "@/lib/types/tender-write";

const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

function fadeIn(index: number, reducedMotion: boolean) {
  if (reducedMotion) {
    return { initial: {}, animate: {}, transition: { duration: 0 } };
  }

  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.4, delay: index * 0.08, ease: easeOutQuint },
  };
}

function downloadBlobFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveFileWithPicker(blob: Blob, suggestedName: string): Promise<boolean> {
  // Check if File System Access API is available
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'Word Document',
            accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      // User cancelled or browser doesn't support it properly
      if (err instanceof Error && err.name === 'AbortError') {
        return false;
      }
      // Fall back to traditional download
      downloadBlobFile(blob, suggestedName);
      return true;
    }
  }
  // Fall back to traditional download for browsers without File System Access API
  downloadBlobFile(blob, suggestedName);
  return true;
}

export default function TenderWritePage() {
  const reducedMotion = useReducedMotion() ?? false;
  const [selectedType, setSelectedType] = useState<TenderDocumentType | null>(
    null,
  );
  const [drafts, setDrafts] = useState<TenderDraftsState>(
    createEmptyTenderDrafts(),
  );
  const [activeSectionKey, setActiveSectionKey] = useState<TenderSectionKey>(
    "cover",
  );
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showAnnouncementDialog, setShowAnnouncementDialog] = useState(false);
  const [showNotificationDialog, setShowNotificationDialog] = useState(false);

  useEffect(() => {
    const cached = readTenderWriteState();
    setDrafts(cached.drafts);
    // 默认进入竞争性谈判，有缓存则恢复
    setSelectedType(cached.selectedType || "COMPETITIVE_NEGOTIATION");
  }, []);

  useEffect(() => {
    writeTenderWriteState({ selectedType, drafts });
  }, [selectedType, drafts]);

  const selectedMeta = useMemo(
    () => TENDER_DOCUMENT_TYPES.find((item) => item.type === selectedType) ?? null,
    [selectedType],
  );

  const isReadyType = selectedType === "COMPETITIVE_NEGOTIATION" || selectedType === "SINGLE_SOURCE" || selectedType === "INQUIRY_PURCHASE" || selectedType === "INTERNAL_BIDDING" || selectedType === "INVITED_BIDDING";

  const currentSections: TenderSectionConfig[] = useMemo(() => {
    if (selectedType === "COMPETITIVE_NEGOTIATION") {
      return COMPETITIVE_NEGOTIATION_SECTIONS;
    }
    if (selectedType === "SINGLE_SOURCE") {
      return SINGLE_SOURCE_SECTIONS;
    }
    if (selectedType === "INQUIRY_PURCHASE") {
      return INQUIRY_PURCHASE_SECTIONS;
    }
    if (selectedType === "INTERNAL_BIDDING") {
      return INTERNAL_BIDDING_SECTIONS;
    }
    if (selectedType === "INVITED_BIDDING") {
      return INVITED_BIDDING_SECTIONS;
    }
    return [];
  }, [selectedType]);

  const currentDraft: ReadyTenderDraft = useMemo(() => {
    if (selectedType === "COMPETITIVE_NEGOTIATION") {
      return {
        ...createEmptyCompetitiveNegotiationDraft(),
        ...(drafts.COMPETITIVE_NEGOTIATION ?? {}),
      };
    }
    if (selectedType === "SINGLE_SOURCE") {
      return {
        ...createEmptySingleSourceDraft(),
        ...(drafts.SINGLE_SOURCE ?? {}),
      };
    }
    if (selectedType === "INQUIRY_PURCHASE") {
      return {
        ...createEmptyInquiryPurchaseDraft(),
        ...(drafts.INQUIRY_PURCHASE ?? {}),
      };
    }
    if (selectedType === "INTERNAL_BIDDING") {
      return {
        ...createEmptyInternalBiddingDraft(),
        ...(drafts.INTERNAL_BIDDING ?? {}),
      };
    }
    if (selectedType === "INVITED_BIDDING") {
      return {
        ...createEmptyInvitedBiddingDraft(),
        ...(drafts.INVITED_BIDDING ?? {}),
      };
    }
    return createEmptyCompetitiveNegotiationDraft();
  }, [selectedType, drafts]);

  const updateDraft = (key: CompetitiveNegotiationFieldKey | SingleSourceFieldKey | InquiryPurchaseFieldKey | InternalBiddingFieldKey | InvitedBiddingFieldKey, value: string) => {
    if (selectedType === "COMPETITIVE_NEGOTIATION") {
      setDrafts((previous) => ({
        ...previous,
        COMPETITIVE_NEGOTIATION: {
          ...createEmptyCompetitiveNegotiationDraft(),
          ...previous.COMPETITIVE_NEGOTIATION,
          [key]: value,
        },
      }));
    } else if (selectedType === "SINGLE_SOURCE") {
      setDrafts((previous) => ({
        ...previous,
        SINGLE_SOURCE: {
          ...createEmptySingleSourceDraft(),
          ...previous.SINGLE_SOURCE,
          [key]: value,
        },
      }));
    } else if (selectedType === "INQUIRY_PURCHASE") {
      setDrafts((previous) => ({
        ...previous,
        INQUIRY_PURCHASE: {
          ...createEmptyInquiryPurchaseDraft(),
          ...previous.INQUIRY_PURCHASE,
          [key]: value,
        },
      }));
    } else if (selectedType === "INTERNAL_BIDDING") {
      setDrafts((previous) => ({
        ...previous,
        INTERNAL_BIDDING: {
          ...createEmptyInternalBiddingDraft(),
          ...previous.INTERNAL_BIDDING,
          [key]: value,
        },
      }));
    } else if (selectedType === "INVITED_BIDDING") {
      setDrafts((previous) => ({
        ...previous,
        INVITED_BIDDING: {
          ...createEmptyInvitedBiddingDraft(),
          ...previous.INVITED_BIDDING,
          [key]: value,
        },
      }));
    }
  };

  const updateDraftTable = (tableData: TableData | undefined) => {
    if (selectedType === "COMPETITIVE_NEGOTIATION") {
      setDrafts((previous) => ({
        ...previous,
        COMPETITIVE_NEGOTIATION: {
          ...createEmptyCompetitiveNegotiationDraft(),
          ...previous.COMPETITIVE_NEGOTIATION,
          quotationLetterTable: tableData,
        },
      }));
    } else if (selectedType === "SINGLE_SOURCE") {
      setDrafts((previous) => ({
        ...previous,
        SINGLE_SOURCE: {
          ...createEmptySingleSourceDraft(),
          ...previous.SINGLE_SOURCE,
          quotationLetterTable: tableData,
        },
      }));
    } else if (selectedType === "INQUIRY_PURCHASE") {
      setDrafts((previous) => ({
        ...previous,
        INQUIRY_PURCHASE: {
          ...createEmptyInquiryPurchaseDraft(),
          ...previous.INQUIRY_PURCHASE,
          quotationLetterTable: tableData,
        },
      }));
    } else if (selectedType === "INTERNAL_BIDDING") {
      setDrafts((previous) => ({
        ...previous,
        INTERNAL_BIDDING: {
          ...createEmptyInternalBiddingDraft(),
          ...previous.INTERNAL_BIDDING,
          quotationLetterTable: tableData,
        },
      }));
    } else if (selectedType === "INVITED_BIDDING") {
      setDrafts((previous) => ({
        ...previous,
        INVITED_BIDDING: {
          ...createEmptyInvitedBiddingDraft(),
          ...previous.INVITED_BIDDING,
          quotationLetterTable: tableData,
        },
      }));
    }
  };

  const handleSelectType = (type: TenderDocumentType) => {
    setSelectedType(type);
    setActiveSectionKey("cover");
  };

  const handleClearCurrent = async () => {
    if (!selectedType) {
      return;
    }

    setClearing(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    // Add a small delay for visual feedback
    await new Promise((resolve) => setTimeout(resolve, 300));

    setDrafts((previous) => resetTenderDraftByType(previous, selectedType));
    setActiveSectionKey("cover");
    setClearing(false);
    setSuccessMessage("已清除当前草稿内容。");

    // Auto-hide success message after 2 seconds
    setTimeout(() => setSuccessMessage(null), 2000);
  };

  const handleSaveCurrent = async () => {
    if (!selectedType || !selectedMeta) {
      return;
    }

    setSavingHistory(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const draftData = drafts[selectedType] ?? {};
      const projectName = (draftData as Record<string, string>).projectName || '未命名项目';
      await createTenderHistory({
        documentType: selectedType,
        title: projectName,
        draftData,
      });
      setSuccessMessage("保存成功！可在历史记录中查看。");
      // Auto-hide success message after 2 seconds
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "保存当前记录失败，请稍后重试。",
      );
    } finally {
      setSavingHistory(false);
    }
  };

  const handleApplyHistory = (record: TenderHistoryRecord) => {
    setDrafts((previous) => ({
      ...previous,
      [record.documentType]: {
        ...record.draftData,
      },
    }));
    setActiveSectionKey("cover");
    setShowHistoryDialog(false);
  };

  const handleExport = async () => {
    if (!isReadyType || !selectedMeta) {
      setErrorMessage("当前模板尚未配置导出。");
      return;
    }

    setExporting(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      // Auto-save to history before export
      const draftData = drafts[selectedType as ReadyTenderDocumentType] ?? {};
      const projectName = (draftData as Record<string, string>).projectName || '未命名项目';
      await createTenderHistory({
        documentType: selectedType as ReadyTenderDocumentType,
        title: projectName,
        draftData,
      });

      const result = await exportTenderDocument({
        documentType: selectedType as ReadyTenderDocumentType,
        answers: currentDraft,
      });
      const saved = await saveFileWithPicker(result.blob, result.fileName);
      if (saved) {
        setSuccessMessage("导出成功！已自动保存到历史记录。");
        setTimeout(() => setSuccessMessage(null), 2000);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "导出失败，请稍后重试。",
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImportConfirm = (selectedFields: ImportAutofillFieldResult[]) => {
    for (const field of selectedFields) {
      if (field.value) {
        updateDraft(field.key as Parameters<typeof updateDraft>[0], field.value);
      }
    }
    setShowImportDialog(false);
    setSuccessMessage(`已回填 ${selectedFields.length} 个字段。`);
    setTimeout(() => setSuccessMessage(null), 2000);
  };

  return (
    <>
      <motion.div
        {...fadeIn(0, reducedMotion)}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {selectedType ? (
          <div className="page-hero mb-4 !rounded-[16px]">
            <div className="page-hero__row">
              <div className="page-hero__left">
                <div className="page-hero__icon">
                  <FileText size={18} strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <div className="page-hero__title">
                    {selectedMeta?.label}
                  </div>
                  <p className="page-hero__sub">
                    {selectedMeta?.description}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ImportAutofillButton
                  disabled={!isReadyType}
                  onClick={() => setShowImportDialog(true)}
                />
                <button type="button" onClick={() => setShowAnnouncementDialog(true)} disabled={!isReadyType} className="neu-btn-soft">
                  <Megaphone size={14} />公告
                </button>
                <button type="button" onClick={() => setShowNotificationDialog(true)} disabled={!isReadyType} className="neu-btn-soft">
                  <Mail size={14} />通知书
                </button>
                <button type="button" onClick={() => void handleClearCurrent()} disabled={clearing} className="neu-btn-soft is-danger">
                  <Eraser size={14} />{clearing ? "清除中..." : "一键清除"}
                </button>
                <button type="button" onClick={() => void handleSaveCurrent()} disabled={savingHistory} className="neu-btn-soft">
                  <Save size={14} />{savingHistory ? "保存中..." : "保存当前"}
                </button>
                <button type="button" onClick={() => setShowHistoryDialog(true)} className="neu-btn-soft">
                  <History size={14} />历史记录
                </button>
                <button type="button" onClick={() => void handleExport()} disabled={exporting || selectedMeta?.availability !== "ready"} className="neu-btn-primary">
                  <FileDown size={14} />{exporting ? "导出中..." : "导出招标文件"}
                </button>
              </div>
            </div>

            <div className="mt-3 pt-2" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.12)" }}>
              <TenderTypeSwitcher
                options={TENDER_DOCUMENT_TYPES}
                selectedType={selectedType}
                onSelect={handleSelectType}
              />
            </div>
          </div>
        ) : null}
        {selectedMeta ? (<TenderWriteWorkspace
            documentType={selectedType as ReadyTenderDocumentType}
            draft={currentDraft}
            sections={currentSections}
            selectedMeta={selectedMeta}
            activeSectionKey={activeSectionKey}
            onSectionSelect={setActiveSectionKey}
            onChange={updateDraft}
            onTableChange={updateDraftTable}
          />) : (
            <div className="flex flex-1 items-center justify-center wb-panel">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(96,139,239,0.3)] border-t-[rgba(96,139,239,1)]" />
                <span className="text-sm text-[color:var(--muted-foreground)]">正在加载...</span>
              </div>
            </div>
          )}
      </motion.div>

      {selectedType && selectedMeta ? (
        <TenderHistoryDialog
          isOpen={showHistoryDialog}
          documentType={selectedType}
          documentLabel={selectedMeta.label}
          onApply={handleApplyHistory}
          onClose={() => setShowHistoryDialog(false)}
        />
      ) : null}

      <LoginErrorDialog
        isOpen={Boolean(errorMessage)}
        message={errorMessage ?? ""}
        onClose={() => setErrorMessage(null)}
      />

      {showImportDialog && (
        <ImportAutofillDialog
          documentType={selectedType as ReadyTenderDocumentType}
          onConfirm={handleImportConfirm}
          onClose={() => setShowImportDialog(false)}
        />
      )}

      {showAnnouncementDialog && selectedType && isReadyType && selectedMeta && (
        <AnnouncementDialog
          isOpen={showAnnouncementDialog}
          tenderType={selectedType as ReadyTenderDocumentType}
          tenderDraft={currentDraft}
          selectedMeta={selectedMeta}
          onClose={() => setShowAnnouncementDialog(false)}
        />
      )}

      {showNotificationDialog && selectedType && isReadyType && (
        <NotificationHubDialog
          isOpen={showNotificationDialog}
          tenderType={selectedType as ReadyTenderDocumentType}
          tenderDraft={currentDraft}
          onClose={() => setShowNotificationDialog(false)}
        />
      )}

      {/* Success Toast */}
      {successMessage && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-in">
          <div className="rounded-[10px] border border-[color-mix(in_oklch,var(--success)_28%,transparent)] bg-[var(--success)] px-5 py-3 text-sm font-medium text-white shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
            {successMessage}
          </div>
        </div>
      )}
    </>
  );
}
