"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { FileDown, FileSearch, Plus, Trash2, ScrollText, FileCheck, Ban, Sparkles, Loader2 } from "lucide-react";
import type { ProjectManagementItem } from "@/lib/types/project-management";

const CATEGORY_ICONS: Record<string, typeof ScrollText> = {
  procurement_document: ScrollText,
  winning_bid: FileCheck,
  failed_bid: Ban,
};
import { Modal } from "@/components/workbench";
import type {
  AnnouncementCategory,
  AnnouncementDraft,
  AnnouncementFieldConfig,
  AnnouncementFieldKey,
} from "@/lib/types/announcement";
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_AVAILABILITY,
} from "@/lib/types/announcement";
import type {
  ReadyTenderDraft,
  ReadyTenderDocumentType,
  TenderDocumentTypeMeta,
  TenderFieldKey,
} from "@/lib/types/tender-write";
import {
  getAnnouncementLabel,
  getAnnouncementFields,
  createEmptyAnnouncementDraft,
  applyAutoFill,
  ANNOUNCEMENT_AUTO_FILL,
  numberToChineseAmount,
} from "@/lib/tender-write/announcement-templates";
import { AnnouncementPreviewDocument } from "./announcement-preview-document";
import { TenderFieldActions } from "./tender-field-actions";
import { TenderFieldSampleDialog } from "./tender-field-sample-drawer";
import { ContactPickerDialog } from "./contact-picker-dialog";
import { createFieldSample, generateFieldContent } from "@/lib/api/tender-sample";
import { findContactByName } from "@/lib/api/contacts";
import { exportAnnouncementDocument, importWinningBidFromPdf } from "@/lib/api/announcement";

function downloadBlobFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveFileWithPicker(
  blob: Blob,
  suggestedName: string,
): Promise<boolean> {
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "Word Document",
            accept: {
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                [".docx"],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return false;
      downloadBlobFile(blob, suggestedName);
      return true;
    }
  }
  downloadBlobFile(blob, suggestedName);
  return true;
}

// Fields that should not show favorite/sample/AI actions (dates, short fields)
const FIELDS_WITHOUT_ACTIONS: Set<string> = new Set([
  "announcementStart",
  "announcementEnd",
  "bidOpeningTime",
  "signatureDate",
  "procurementTime",
  "announcementDays",
  "maxPriceChinese",
  "scheduleRequirementsType",
  "bidder1Remark",
  "bidder1RemarkType",
]);

/** Read dynamic bidder entries from the draft record */
function getBidders(draftRecord: Record<string, string>): Array<{ name: string; price: string }> {
  const count = parseInt(draftRecord.bidderCount || "0", 10);
  const bidders: Array<{ name: string; price: string }> = [];
  // If bidderCount is set, use it; otherwise fall back to detecting non-empty fields
  const limit = count > 0 ? count : 3;
  for (let i = 1; i <= limit; i++) {
    const name = draftRecord[`bidder${i}Name`] ?? "";
    const price = draftRecord[`bidder${i}Price`] ?? "";
    bidders.push({ name, price });
  }
  return bidders;
}

/** Dynamic bidder editor for winning_bid announcement */
function BidderEditor({
  draftRecord,
  onChange,
  onImport,
  importing,
}: {
  draftRecord: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onImport: () => void;
  importing: boolean;
}) {
  const bidders = getBidders(draftRecord);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleRemove = (idx: number) => {
    // Shift all bidders down from idx+1
    const updated = bidders.filter((_, i) => i !== idx);
    // Clear all existing bidder keys first
    for (let i = 1; i <= bidders.length; i++) {
      onChange(`bidder${i}Name`, "");
      onChange(`bidder${i}Price`, "");
    }
    // Rewrite with the filtered list
    updated.forEach((b, i) => {
      onChange(`bidder${i + 1}Name`, b.name);
      onChange(`bidder${i + 1}Price`, b.price);
    });
    // Update count
    onChange("bidderCount", String(updated.length));
  };

  const handleAdd = () => {
    const newCount = bidders.length + 1;
    onChange(`bidder${newCount}Name`, "");
    onChange(`bidder${newCount}Price`, "");
    onChange("bidderCount", String(newCount));
  };

  const rankLabels = ["第一名", "第二名", "第三名", "第四名", "第五名", "第六名", "第七名", "第八名", "第九名", "第十名"];

  const commonInputClass =
    "w-full rounded-[14px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-3 py-2.5 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)] hover:border-[oklch(0.6_0.04_258_/_0.35)]";

  return (
    <div className="neu-card-static !rounded-[16px] px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-[color:var(--foreground)]">
          投标单位（{bidders.length}家）
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onImport}
            disabled={importing}
            className="tender-btn tender-btn--purple disabled:cursor-not-allowed text-xs px-3 py-1.5"
          >
            <span className="tb-icon tb-icon--purple tb-anim-bounce">
              <FileSearch size={12} />
            </span>
            {importing ? "导入中..." : "从审批表导入"}
          </button>
          <button
            type="button"
            onClick={handleAdd}
            className="tender-btn text-xs px-3 py-1.5"
          >
            <Plus size={12} />
            添加
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {bidders.map((bidder, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="shrink-0 w-14 text-xs font-medium text-[color:var(--muted-foreground)]">
              {rankLabels[idx] ?? `第${idx + 1}名`}
            </span>
            <input
              type="text"
              value={bidder.name}
              onChange={(e) => onChange(`bidder${idx + 1}Name`, e.target.value)}
              placeholder="投标单位名称"
              className={commonInputClass}
            />
            <input
              type="text"
              value={bidder.price}
              onChange={(e) => onChange(`bidder${idx + 1}Price`, e.target.value)}
              placeholder="评审报价（元）"
              className={`${commonInputClass} w-36`}
            />
            <button
              type="button"
              onClick={() => handleRemove(idx)}
              className="neu-btn-xs is-danger"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {bidders.length === 0 && (
          <div className="py-4 text-center text-xs text-[color:var(--muted-foreground)]">
            暂无投标单位，点击"从审批表导入"或"添加"
          </div>
        )}
      </div>
    </div>
  );
}

function AnnouncementFieldEditor({
  field,
  value,
  draftRecord,
  onChange,
  onFieldFocus,
  favoriteStates,
  generatingStates,
  onFavoriteToggle,
  onSampleOpen,
  onAiGenerate,
  onContactOpen,
}: {
  field: AnnouncementFieldConfig;
  value: string;
  draftRecord: Record<string, string>;
  onChange: (key: AnnouncementFieldKey, value: string) => void;
  onFieldFocus?: (fieldKey: AnnouncementFieldKey) => void;
  favoriteStates: Record<string, boolean>;
  generatingStates: Record<string, boolean>;
  onFavoriteToggle: (fieldKey: AnnouncementFieldKey, value: string) => void;
  onSampleOpen: (fieldKey: AnnouncementFieldKey, fieldLabel: string) => void;
  onAiGenerate: (fieldKey: AnnouncementFieldKey, fieldLabel: string, value: string, aiPrompt?: string) => void;
  onContactOpen?: () => void;
}) {
  // 有值判定：文本字段只看非空；date/datetime-local 字段需校验格式（否则 input 显示空白却标记"已填写"）
  const hasValue = (() => {
    const v = value.trim();
    if (!v) return false;
    if (field.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (field.type === 'datetime-local') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
    return true;
  })();
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hideActions = FIELDS_WITHOUT_ACTIONS.has(field.key);
  const isContactField = field.key === "contactName";

  // Composite field state
  const compositeConfig = field.composite;
  const compositeType = compositeConfig
    ? (draftRecord[compositeConfig.typeKey] || "")
    : null;

  const commonInputClass =
    "w-full rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)] hover:border-[oklch(0.6_0.04_258_/_0.35)]";

  useEffect(() => {
    if (textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = "auto";
      el.style.height = Math.max(120, el.scrollHeight) + "px";
    }
  }, [value]);

  return (
    <div
      className={[
        "border-b border-[oklch(0.6_0.04_258_/_0.12)] py-3.5",
        hasValue ? "" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-[color:var(--foreground)]">
          {field.label}
        </span>
        <div className="flex items-center gap-2">
          {!hideActions && (
            <TenderFieldActions
              fieldKey={field.key as TenderFieldKey}
              currentValue={value}
              isFavorite={favoriteStates[field.key] ?? false}
              isGenerating={generatingStates[field.key] ?? false}
              isContactField={isContactField}
              onSampleOpen={() => onSampleOpen(field.key, field.label)}
              onFavoriteToggle={() => onFavoriteToggle(field.key, value)}
              onAiGenerate={() => onAiGenerate(field.key, field.label, value, field.aiPrompt)}
              onContactOpen={onContactOpen}
            />
          )}
          <span
            className={[
              "rounded-[5px] px-2 py-0.5 text-[10px] font-semibold",
              hasValue
                ? "bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[color:var(--success)]"
                : "bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] text-[color:var(--danger)]",
            ].join(" ")}
          >
            {hasValue ? "已填写" : "待补充"}
          </span>
        </div>
      </div>

      {field.select ? (
        <div className="relative mt-2">
          <select
            value={value}
            onChange={(e) => onChange(field.key, e.target.value)}
            className="w-full appearance-none rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 pr-10 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)] hover:border-[oklch(0.6_0.04_258_/_0.35)]"
          >
            <option value="" disabled>
              请选择
            </option>
            {field.select.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
            <svg className="h-4 w-4 text-[color:var(--muted-foreground)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      ) : field.composite ? (
        /* Composite field: type selector + conditional input */
        <div className="mt-2">
          {/* Type toggle buttons */}
          <div className="flex gap-1.5 mb-2">
            {field.composite.typeOptions.map((opt) => {
              const isActive = compositeType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(field.composite!.typeKey as AnnouncementFieldKey, opt.value);
                    // When switching to text mode, auto-fill "另行通知" if empty
                    if (opt.value === "text" && !value.trim()) {
                      onChange(field.key, "另行通知");
                    }
                  }}
                  className={[
                    "rounded-[12px] px-3 py-1.5 text-xs font-medium transition-all duration-200",
                    isActive
                      ? "bg-[rgba(107,149,240,0.16)] text-[rgba(75,110,200,1)]"
                      : "bg-[oklch(1_0_0_/_0.4)] text-[color:var(--muted-foreground)] hover:bg-[oklch(1_0_0_/_0.6)]",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Conditional input based on selected type */}
          {compositeType === "datetime" ? (
            <input
              ref={dateInputRef}
              type="datetime-local"
              value={value}
              onChange={(e) => onChange(field.key, e.target.value)}
              onFocus={() => onFieldFocus?.(field.key)}
              className={commonInputClass}
            />
          ) : (
            <input
              ref={textInputRef}
              type="text"
              value={value}
              onChange={(e) => onChange(field.key, e.target.value)}
              onFocus={() => onFieldFocus?.(field.key)}
              onKeyDown={(e) => {
                // Tab auto-fills "另行通知" when input is empty
                if (e.key === "Tab" && !e.shiftKey && !value.trim()) {
                  e.preventDefault();
                  onChange(field.key, "另行通知");
                  // Move focus to next focusable element
                  const form = textInputRef.current?.form;
                  if (form && textInputRef.current) {
                    const elements = Array.from(form.elements) as HTMLElement[];
                    const currentIdx = elements.indexOf(textInputRef.current);
                    for (let i = currentIdx + 1; i < elements.length; i++) {
                      const el = elements[i];
                      if (el instanceof HTMLElement && el.tabIndex >= 0 && !el.hasAttribute("disabled")) {
                        el.focus();
                        break;
                      }
                    }
                  }
                }
              }}
              placeholder={field.placeholder}
              className={commonInputClass}
            />
          )}
        </div>
      ) : field.multiline ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          onFocus={() => onFieldFocus?.(field.key)}
          placeholder={field.placeholder}
          className={`${commonInputClass} mt-2 min-h-[120px] resize-none`}
        />
      ) : field.type === "date" ? (
        <input
          ref={dateInputRef}
          type="date"
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          onFocus={() => onFieldFocus?.(field.key)}
          className={`${commonInputClass} mt-2`}
        />
      ) : (
        <input
          type={field.type ?? "text"}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          onFocus={() => onFieldFocus?.(field.key)}
          placeholder={field.placeholder}
          className={`${commonInputClass} mt-2`}
        />
      )}
    </div>
  );
}

export function AnnouncementDialog({
  isOpen,
  tenderType,
  tenderDraft,
  selectedMeta,
  onClose,
  embedded = false,
  initialCategory = null,
  initialDraft = null,
  onDraftChange,
  hiddenFields = [],
  project = null,
}: {
  isOpen: boolean;
  tenderType: ReadyTenderDocumentType;
  tenderDraft: ReadyTenderDraft;
  selectedMeta: TenderDocumentTypeMeta;
  onClose: () => void;
  embedded?: boolean;
  initialCategory?: AnnouncementCategory | null;
  initialDraft?: AnnouncementDraft | null;
  onDraftChange?: (draft: AnnouncementDraft, category: AnnouncementCategory) => void;
  /** 渲染时隐藏的字段 key（如 wizard 把某些字段移到发布配置单独编辑） */
  hiddenFields?: string[];
  /** 项目数据（供"智能填入"直接取值，非 AI 生成） */
  project?: ProjectManagementItem | null;
}) {
  const [step, setStep] = useState<"select_category" | "edit">("select_category");
  const [category, setCategory] = useState<AnnouncementCategory | null>(null);
  const [draft, setDraft] = useState<AnnouncementDraft | null>(null);
  const [exporting, setExporting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [focusedFieldKey, setFocusedFieldKey] =
    useState<AnnouncementFieldKey | null>(null);
  const [favoriteStates, setFavoriteStates] = useState<Record<string, boolean>>({});
  const [generatingStates, setGeneratingStates] = useState<Record<string, boolean>>({});
  const [sampleDrawerState, setSampleDrawerState] = useState<{
    isOpen: boolean;
    fieldKey: AnnouncementFieldKey;
    fieldLabel: string;
  } | null>(null);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [importingBidders, setImportingBidders] = useState(false);

  // Reset state when dialog opens with a new tender type
  /* eslint-disable react-hooks/set-state-in-effect -- modal/dialog form reset is intentional */
  const initRef = useRef(false);
  useEffect(() => {
    if (!isOpen) { initRef.current = false; return; }
    if (initRef.current) return;
    initRef.current = true;
    if (embedded && initialCategory && initialDraft) {
      setStep("edit");
      setCategory(initialCategory);
      setDraft(initialDraft);
      setErrorMessage(null);
      setSuccessMessage(null);
      setFavoriteStates({});
      setGeneratingStates({});
      setSampleDrawerState(null);
      setAiError(null);
      return;
    }
    setStep("select_category");
    setCategory(null);
    setDraft(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setFavoriteStates({});
    setGeneratingStates({});
    setSampleDrawerState(null);
    setAiError(null);
  }, [isOpen, embedded, initialCategory, initialDraft]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const fields = useMemo(() => {
    if (!tenderType || !category) return [];
    return getAnnouncementFields(tenderType, category);
  }, [tenderType, category]);

  const dialogTitle = useMemo(() => {
    if (!tenderType || !category) return "公告";
    return getAnnouncementLabel(tenderType, category);
  }, [tenderType, category]);

  const availableCategories = useMemo(() => {
    return ANNOUNCEMENT_AVAILABILITY[tenderType] ?? [];
  }, [tenderType]);

  const handleSelectCategory = (cat: AnnouncementCategory) => {
    setCategory(cat);
    const emptyDraft = createEmptyAnnouncementDraft(tenderType, cat);
    const tenderDraftRecord = tenderDraft as Record<string, string>;
    const filledDraft = applyAutoFill(emptyDraft, tenderDraftRecord, getAnnouncementFields(tenderType, cat));
    setDraft(filledDraft);
    setStep("edit");
    if (embedded && onDraftChange) onDraftChange(filledDraft, cat);
  };

  // Notify parent wizard of any subsequent draft changes (deep-compare to avoid infinite loop)
  const lastNotifiedKey = useRef('');
  useEffect(() => {
    if (embedded && onDraftChange && draft && category) {
      const key = JSON.stringify({ d: draft, c: category });
      if (key !== lastNotifiedKey.current) {
        lastNotifiedKey.current = key;
        onDraftChange(draft, category);
      }
    }
  }, [draft, category, embedded, onDraftChange]);

  const handleFieldChange = (key: AnnouncementFieldKey, value: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value } as Record<string, string>;

      // Auto-calculate Chinese uppercase amount when numeric field changes
      if ((key === "maxPriceNumeric" || key === "maxPrice") && value.trim()) {
        next.maxPriceChinese = numberToChineseAmount(value);
      } else if (key === "maxPriceNumeric" || key === "maxPrice") {
        next.maxPriceChinese = "";
      }

      // Auto-fill remark when remark type changes to a preset option
      if (key === "bidder1RemarkType" && value !== "手动填入") {
        next.bidder1Remark = value;
      }

      return next as AnnouncementDraft;
    });
  };

  const handleFavoriteToggle = async (fieldKey: AnnouncementFieldKey, currentValue: string) => {
    if (!currentValue.trim()) return;
    const isCurrentlyFavorite = favoriteStates[fieldKey] ?? false;
    try {
      if (isCurrentlyFavorite) {
        setFavoriteStates((prev) => ({ ...prev, [fieldKey]: false }));
      } else {
        await createFieldSample({
          fieldKey: fieldKey as TenderFieldKey,
          content: currentValue,
          isFavorite: true,
          sourceType: "manual",
        });
        setFavoriteStates((prev) => ({ ...prev, [fieldKey]: true }));
      }
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  };

  const handleSampleOpen = (fieldKey: AnnouncementFieldKey, fieldLabel: string) => {
    setSampleDrawerState({ isOpen: true, fieldKey, fieldLabel });
  };

  const handleSampleSelect = (content: string) => {
    if (sampleDrawerState) {
      handleFieldChange(sampleDrawerState.fieldKey, content);
    }
  };

  const handleAiGenerate = async (
    fieldKey: AnnouncementFieldKey,
    fieldLabel: string,
    currentValue: string,
    aiPrompt?: string,
  ) => {
    setGeneratingStates((prev) => ({ ...prev, [fieldKey]: true }));
    setAiError(null);

    try {
      const context: Record<string, string> = {};

      // Include announcement draft fields as context
      if (draft) {
        for (const [key, val] of Object.entries(draft)) {
          if (typeof val === "string" && val.trim() && key !== fieldKey) {
            const fc = fields.find((f) => f.key === key);
            context[fc?.label ?? key] = val;
          }
        }
      }

      // Include tender document draft as additional context (keyed by field labels)
      const tenderDraftAny = tenderDraft as Record<string, string>;
      for (const [key, val] of Object.entries(tenderDraftAny)) {
        if (typeof val === "string" && val.trim()) {
          context[`[招标文件]${key}`] = val;
        }
      }

      const result = await generateFieldContent({
        fieldKey: fieldKey as TenderFieldKey,
        fieldLabel,
        currentValue,
        aiPrompt,
        context,
      });
      if (!result.content) throw new Error("AI返回的内容为空");
      // 清理 AI 输出中的乱码字符（U+FFFD / 连续问号）—— token 截断导致的中文字符损坏
      const cleaned = result.content
        .replace(/�/g, '')        // 移除 Unicode 替换字符
        .replace(/\?{2,}(?=\s|$|。|，|；)/g, '') // 移除末尾连续问号（中文截断残留）
        .replace(/\s+$/, '');           // 移除尾部空白
      handleFieldChange(fieldKey, cleaned);
      await createFieldSample({
        fieldKey: fieldKey as TenderFieldKey,
        content: result.content,
        sourceType: "ai_generated",
        context: { generatedAt: new Date().toISOString(), prompt: aiPrompt },
      });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI生成失败，请稍后重试");
      setTimeout(() => setAiError(null), 5000);
    } finally {
      setGeneratingStates((prev) => ({ ...prev, [fieldKey]: false }));
    }
  };

  // ★ 智能填入未填项：项目数据直接填入 → tenderDraft 映射 → AI 生成剩余
  const [batchFilling, setBatchFilling] = useState(false);
  const handleAutoFillAll = useCallback(async () => {
    if (!draft || !fields.length) return;
    const draftRecord = draft as Record<string, string>;
    const tenderRecord = tenderDraft as Record<string, string>;
    const patch: Record<string, string> = {};

    // Pass 1: 从项目数据直接填入（公告专属字段，tenderDraft 中不存在）
    if (project) {
      if (!draftRecord.supplierName?.trim()) {
        let sn = project.awardedSupplier?.trim();
        if (!sn) {
          try {
            const raw = localStorage.getItem(`tender-write:project-drafts:v1:${project.id}`);
            if (raw) sn = (JSON.parse(raw)?.SINGLE_SOURCE as Record<string, string>)?.supplierName?.trim();
          } catch {}
        }
        if (sn) patch.supplierName = sn;
      }
      if (!draftRecord.procurementTime?.trim() && project.bidOpeningTime?.trim()) {
        // 中文日期时间 "2026年3月24日9:00" → ISO "2026-03-24T09:00"
        const m = project.bidOpeningTime.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/);
        if (m) {
          patch.procurementTime = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}T${m[4].padStart(2,'0')}:${m[5]}`;
        } else {
          const dm = project.bidOpeningTime.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
          if (dm) patch.procurementTime = `${dm[1]}-${dm[2].padStart(2,'0')}-${dm[3].padStart(2,'0')}T09:00`;
        }
      }
      // 修正：procurementTime 已有值但不符合 datetime-local 格式（YYYY-MM-DDTHH:MM）→ 重新转换
      if (draftRecord.procurementTime?.trim() && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draftRecord.procurementTime)) {
        const raw = draftRecord.procurementTime;
        const m = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/);
        if (m) {
          patch.procurementTime = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}T${m[4].padStart(2,'0')}:${m[5]}`;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          patch.procurementTime = `${raw}T09:00`;
        }
      }
      if (!draftRecord.maxPriceNumeric?.trim() && project.budgetAmount != null) patch.maxPriceNumeric = String(project.budgetAmount);
      if (!draftRecord.projectOverview?.trim() && project.projectOverview?.trim()) patch.projectOverview = project.projectOverview;
      if (!draftRecord.signatureDate?.trim()) {
        const today = new Date();
        patch.signatureDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      }
      // 公示期限起/止 + 天数：从 documentAcquireTime 解析
      // documentAcquireTime 格式如 "2026年03月23日09:00至2026年03月26日15:00"
      // 同时修正已有值但格式不符合 datetime-local 的字段
      const needsStartFix = !draftRecord.announcementStart?.trim()
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draftRecord.announcementStart);
      const needsEndFix = !draftRecord.announcementEnd?.trim()
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draftRecord.announcementEnd);
      if (needsStartFix || needsEndFix) {
        const at = project.documentAcquireTime?.trim();
        if (at) {
          // 支持 "至" / "-" / "~" 作为区间分隔符
          const sepMatch = at.match(/至|-|~/);
          const sepIdx = sepMatch ? at.indexOf(sepMatch[0]) : -1;
          if (sepIdx > 0) {
            const startRaw = at.slice(0, sepIdx).trim();
            const endRaw = at.slice(sepIdx + 1).trim();
            // 解析为 ISO 日期 + 保留时分
            const toISODate = (s: string) => {
              const m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
              return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : s;
            };
            const toISODatetime = (s: string) => {
              const m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/);
              if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}T${m[4].padStart(2,'0')}:${m[5]}`;
              return toISODate(s);
            };
            if (needsStartFix) patch.announcementStart = toISODatetime(startRaw);
            if (needsEndFix) patch.announcementEnd = toISODatetime(endRaw);
            if (!draftRecord.announcementDays?.trim()) {
              try {
                const days = Math.round((new Date(toISODate(endRaw)).getTime() - new Date(toISODate(startRaw)).getTime()) / 86400000);
                if (days > 0) patch.announcementDays = String(days);
              } catch {}
            }
          }
        }
      }
    }

    // Pass 2: 从 tenderDraft 映射填入剩余空字段
    for (const field of fields) {
      if (hiddenFields.includes(field.key)) continue;
      if (field.composite || field.toggle || field.quotationType) continue;
      if (draftRecord[field.key]?.trim() || patch[field.key]) continue;
      const tenderKey = ANNOUNCEMENT_AUTO_FILL[field.key];
      if (tenderKey && tenderRecord[tenderKey]?.trim()) {
        patch[field.key] = tenderRecord[tenderKey];
      }
    }

    const directCount = Object.keys(patch).length;

    // 应用直接填入
    if (directCount > 0) {
      setDraft((prev) => prev ? { ...prev, ...patch } as AnnouncementDraft : prev);
    }

    // Pass 3: 对仍为空且有 aiPrompt 的字段走 AI 生成
    const mergedRecord = { ...draftRecord, ...patch };
    const aiFields = fields.filter((f) => {
      if (hiddenFields.includes(f.key)) return false;
      if (f.composite || f.toggle || f.quotationType) return false;
      const val = mergedRecord[f.key]?.trim();
      return !val && !!f.aiPrompt;
    });

    if (directCount > 0) {
      toast.success(`已直接填入 ${directCount} 个字段${aiFields.length > 0 ? '，正在 AI 生成剩余…' : ''}`);
    }

    if (aiFields.length === 0) {
      if (directCount === 0) toast.info('所有字段均已填写');
      return;
    }

    setBatchFilling(true);
    for (const field of aiFields) {
      setGeneratingStates((prev) => ({ ...prev, [field.key]: true }));
      try {
        await handleAiGenerate(field.key, field.label, '', field.aiPrompt);
      } catch { /* 单字段失败不阻塞 */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    setBatchFilling(false);
    if (aiFields.length > 0) toast.success(`AI 已生成 ${aiFields.length} 个字段`);
  }, [draft, fields, hiddenFields, tenderDraft, project]);

  const handleContactSelect = (contact: { name: string; email: string; phone: string }) => {
    handleFieldChange("contactName", contact.name);
    handleFieldChange("contactEmail", contact.email);
    handleFieldChange("contactPhone", contact.phone);
  };

  const handleContactNameChange = async (value: string) => {
    handleFieldChange("contactName", value);
    if (value.trim()) {
      try {
        const contact = await findContactByName(value.trim());
        if (contact) {
          const d = draft as Record<string, string> | null;
          if (d && !d.contactEmail?.trim() && contact.email) {
            handleFieldChange("contactEmail", contact.email);
          }
          if (d && !d.contactPhone?.trim() && contact.phone) {
            handleFieldChange("contactPhone", contact.phone);
          }
        }
      } catch { /* silent */ }
    }
  };

  const handlePreviewValueChange = (
    fieldKey: AnnouncementFieldKey,
    value: string,
  ) => {
    handleFieldChange(fieldKey, value);
  };

  const handleFieldFocus = (fieldKey: AnnouncementFieldKey) => {
    setFocusedFieldKey(fieldKey);

    // Scroll preview to the focused field
    const previewRoot = previewScrollRef.current;
    if (!previewRoot) return;

    requestAnimationFrame(() => {
      const target = previewRoot.querySelector<HTMLElement>(
        `#announcement-preview-field-${fieldKey}`,
      );
      if (target) {
        const rootRect = previewRoot.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const relativeTop =
          targetRect.top - rootRect.top + previewRoot.scrollTop;
        const scrollTo = Math.max(
          0,
          relativeTop - rootRect.height / 2 + targetRect.height / 2,
        );
        previewRoot.scrollTo({ top: scrollTo, behavior: "smooth" });
      }
    });
  };

  const handleImportBidders = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset the input so the same file can be re-selected
    e.target.value = "";

    setImportingBidders(true);
    setAiError(null);

    try {
      const bidders = await importWinningBidFromPdf(file);
      if (bidders.length === 0) {
        setAiError("未从定标审批表中提取到投标单位信息。");
        setTimeout(() => setAiError(null), 5000);
        return;
      }

      setDraft((prev) => {
        if (!prev) return prev;
        const next = { ...prev } as Record<string, string>;

        // Clear any existing bidder data first
        for (let i = 1; i <= 20; i++) {
          next[`bidder${i}Name`] = "";
          next[`bidder${i}Price`] = "";
        }

        // Fill with imported data (dynamic count)
        bidders.forEach((bidder, idx) => {
          const i = idx + 1;
          next[`bidder${i}Name`] = bidder.name;
          next[`bidder${i}Price`] = bidder.price;
        });
        next.bidderCount = String(bidders.length);

        return next as AnnouncementDraft;
      });

      setSuccessMessage(`已导入 ${bidders.length} 家投标单位。`);
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "导入失败，请稍后重试。");
      setTimeout(() => setAiError(null), 5000);
    } finally {
      setImportingBidders(false);
    }
  };

  const handleBack = () => {
    setStep("select_category");
    setCategory(null);
    setDraft(null);
  };

  const handleExport = async () => {
    if (!draft || !category) return;

    setExporting(true);
    setErrorMessage(null);

    try {
      const result = await exportAnnouncementDocument({
        tenderType,
        category,
        draft,
      });
      const saved = await saveFileWithPicker(result.blob, result.fileName);
      if (saved) {
        setSuccessMessage("导出成功！");
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

  const draftRecord = (draft ?? {}) as Record<string, string>;

  const modalBody = (
    <>
      {step === "select_category" ? (
          /* Category Selection */
          <div className="grid gap-4">
            {availableCategories.map((cat) => {
              const catMeta = ANNOUNCEMENT_CATEGORIES.find(
                (c) => c.type === cat,
              );
              const IconComponent = CATEGORY_ICONS[cat] ?? FileSearch;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => handleSelectCategory(cat)}
                  className="group flex items-start gap-4 rounded-[16px] border border-transparent px-5 py-4 text-left bg-[oklch(1_0_0_/_0.55)] backdrop-blur-[16px] transition-[transform,box-shadow] duration-300 [box-shadow:var(--cs)] hover:[box-shadow:var(--csh)] hover:-translate-y-0.5"
                  style={{
                    "--cs": "inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.12), -2px -2px 6px oklch(1 0 0 / 0.85)",
                    "--csh": "inset 0 1px 0 oklch(1 0 0 / 0.85), 4px 4px 10px oklch(0.45 0.08 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.9)",
                  } as React.CSSProperties}
                >
                  <div className="neu-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[color:var(--accent)] transition-transform duration-300 group-hover:scale-105">
                    <IconComponent size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[0.95rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                      {getAnnouncementLabel(tenderType, cat)}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                      {catMeta?.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* Editor + Preview */
          <div className="flex flex-row gap-4">
            {/* Editor (left) */}
            <section className="flex min-h-0 flex-1 flex-col rounded-[20px] wb-panel">
              <div className="shrink-0 border-b border-[oklch(0.6_0.04_258_/_0.16)] px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">
                      编辑区
                    </div>
                    <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                      {fields.filter((f) => draftRecord[f.key]?.trim()).length}/{fields.length} 项已填写
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleAutoFillAll()}
                    disabled={batchFilling}
                    className="group relative flex items-center gap-2 rounded-[10px] px-4 py-2 text-[12px] font-bold tracking-[-0.01em] transition-all duration-300 disabled:opacity-60"
                    style={{
                      background: batchFilling
                        ? 'linear-gradient(135deg, oklch(0.7 0.08 258), oklch(0.65 0.06 258))'
                        : 'linear-gradient(135deg, oklch(0.55 0.18 258), oklch(0.48 0.16 258))',
                      color: 'white',
                      boxShadow: batchFilling
                        ? 'inset 0 1px 0 oklch(1 0 0 / 0.3), 0 2px 8px oklch(0.4 0.1 258 / 0.25)'
                        : 'inset 0 1px 0 oklch(1 0 0 / 0.35), 2px 3px 8px oklch(0.42 0.14 258 / 0.3), -1px -1px 4px oklch(1 0 0 / 0.15)',
                    }}
                    title="AI 自动填充所有未填写的字段"
                  >
                    {batchFilling ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Sparkles size={15} className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
                    )}
                    {batchFilling ? '填入中…' : '智能填入未填项'}
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-5 tender-scroll">
                <div className="grid gap-3">
                  {fields
                    .filter((field) => {
                      if (hiddenFields.includes(field.key)) return false;
                      // Hide scheduleRequirements content when type is not "have"
                      if (field.key === "scheduleRequirements") {
                        const typeVal = draftRecord.scheduleRequirementsType;
                        return typeVal === "have";
                      }
                      // Hide the composite typeKey field — it's rendered inline with its parent
                      if (field.composite) {
                        return true;
                      }
                      // Hide bidOpeningTimeType standalone — rendered as part of bidOpeningTime composite
                      if (field.key === "bidOpeningTimeType") {
                        return false;
                      }
                      // Hide remark text input when type is not "手动填入"
                      if (field.key === "bidder1Remark") {
                        return draftRecord.bidder1RemarkType === "手动填入";
                      }
                      return true;
                    })
                    .map((field, fieldIdx, filteredFields) => {
                      // Inject BidderEditor after bidOpeningTime for winning_bid
                      const isWinningBid = category === "winning_bid";
                      const isAfterBidOpening = isWinningBid && field.key === "bidder1RemarkType";

                      return (
                        <Fragment key={field.key}>
                          {isAfterBidOpening && (
                            <BidderEditor
                              draftRecord={draftRecord}
                              onChange={(k, v) => handleFieldChange(k as AnnouncementFieldKey, v)}
                              onImport={handleImportBidders}
                              importing={importingBidders}
                            />
                          )}
                          <AnnouncementFieldEditor
                      key={field.key}
                      field={field}
                      value={draftRecord[field.key] ?? ""}
                      draftRecord={draftRecord}
                      onChange={field.key === "contactName" ? handleContactNameChange : handleFieldChange}
                      onFieldFocus={handleFieldFocus}
                      favoriteStates={favoriteStates}
                      generatingStates={generatingStates}
                      onFavoriteToggle={handleFavoriteToggle}
                      onSampleOpen={handleSampleOpen}
                      onAiGenerate={handleAiGenerate}
                      onContactOpen={() => setContactPickerOpen(true)}
                    />
                        </Fragment>
                      );
                    })}
                </div>
              </div>
            </section>

            {/* Preview (right) */}
            <aside className="flex min-h-0 flex-[1.1] flex-col overflow-hidden rounded-[24px] wb-panel">
              <div className="shrink-0 border-b border-[oklch(0.6_0.04_258_/_0.16)] px-5 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">
                  预览区
                </div>
                <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                  {dialogTitle} · 实时预览（支持双击编辑）
                </div>
              </div>
              <div
                ref={previewScrollRef}
                className="min-h-0 flex-1 overflow-y-auto tender-scroll"
              >
                <div className="mx-3 my-2 px-2 py-2">
                  {draft && (
                    <AnnouncementPreviewDocument
                      tenderType={tenderType}
                      category={category!}
                      draft={draft}
                      onValueChange={handlePreviewValueChange}
                    />
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className="text-sm text-[color:var(--danger)]">
            {errorMessage}
          </div>
        )}

        {/* Success toast */}
        {successMessage && (
          <div className="rounded-[10px] border border-[color-mix(in_oklch,var(--success)_28%,transparent)] bg-[var(--success)] px-5 py-3 text-sm font-medium text-white">
            {successMessage}
          </div>
        )}

        {/* AI / Import error toast */}
        {aiError && (
          <div className="rounded-[10px] border border-[color-mix(in_oklch,var(--danger)_28%,transparent)] bg-[var(--danger)] px-5 py-3 text-sm font-medium text-white">
            {aiError}
          </div>
        )}
    </>
  );

  return (
    <>
      {embedded ? (
        <div className="flex-1 min-h-0 flex flex-col">
          {modalBody}
        </div>
      ) : (
        <Modal
          open={isOpen}
          onClose={onClose}
          title={step === "select_category" ? "选择公告类型" : dialogTitle}
          description={`${selectedMeta.label} · 公告`}
          size="lg"
          className={step === "edit" ? "!max-w-[min(1200px,95vw)]" : undefined}
          footer={
            step === "edit" && draft ? (
              <>
                <button type="button" onClick={handleBack} className="neu-btn-soft">
                  ← 返回选择
                </button>
                <button
                  type="button"
                  onClick={() => void handleExport()}
                  disabled={exporting}
                  className="tender-btn tender-btn--export disabled:cursor-not-allowed"
                >
                  <span className="tb-icon tb-anim-bob"><FileDown size={13} /></span>
                  {exporting ? "导出中..." : "导出公告"}
                </button>
              </>
            ) : undefined
          }
        >
          {modalBody}
        </Modal>
      )}

      {/* Sample drawer */}
      {sampleDrawerState && (
        <TenderFieldSampleDialog
          isOpen={sampleDrawerState.isOpen}
          fieldKey={sampleDrawerState.fieldKey as TenderFieldKey}
          fieldLabel={sampleDrawerState.fieldLabel}
          onSelect={handleSampleSelect}
          onClose={() => setSampleDrawerState(null)}
        />
      )}

      {/* Contact picker */}
      {contactPickerOpen && (
        <ContactPickerDialog
          isOpen={contactPickerOpen}
          onSelect={handleContactSelect}
          onClose={() => setContactPickerOpen(false)}
        />
      )}

      {/* Hidden file input for importing winning bid data */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        hidden
        onChange={(e) => void handleFileSelected(e)}
      />
    </>
  );
}
