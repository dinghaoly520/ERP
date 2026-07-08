"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { X, FileDown, FileSearch, Plus, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
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
  numberToChineseAmount,
} from "@/lib/tender-write/announcement-templates";
import { AnnouncementPreviewDocument } from "./announcement-preview-document";
import { TenderFieldActions } from "./tender-field-actions";
import { TenderFieldSampleDialog } from "./tender-field-sample-drawer";
import { ContactPickerDialog } from "./contact-picker-dialog";
import { createFieldSample, generateFieldContent } from "@/lib/api/tender-sample";
import { findContactByName } from "@/lib/api/contacts";
import { exportAnnouncementDocument, importWinningBidFromPdf } from "@/lib/api/announcement";

const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

function fadeIn(reducedMotion: boolean) {
  if (reducedMotion) {
    return { initial: {}, animate: {}, transition: { duration: 0 } };
  }
  return {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    transition: { duration: 0.3, ease: easeOutQuint },
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
  const limit = count > 0 ? count : 20;
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
    <div className="rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.18)] bg-[oklch(1_0_0_/_0.35)] px-4 py-3.5 transition-all duration-300">
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
  const hasValue = value.trim().length > 0;
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
    <label
      className={[
        "block rounded-[18px] border px-4 py-3.5 transition-all duration-300",
        hasValue
          ? "border-[rgba(92,181,150,0.14)] bg-[rgba(92,181,150,0.04)]"
          : "border-[oklch(0.6_0.04_258_/_0.18)] bg-[oklch(1_0_0_/_0.35)] hover:border-[oklch(0.6_0.04_258_/_0.35)]",
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
              "rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all duration-200",
              hasValue
                ? "bg-[rgba(92,181,150,0.1)] text-[rgba(78,150,124,1)]"
                : "bg-[rgba(230,129,102,0.1)] text-[rgba(199,108,83,1)]",
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
                    "rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200",
                    isActive
                      ? "bg-[rgba(107,149,240,0.16)] text-[rgba(75,110,200,1)] shadow-[0_1px_4px_rgba(107,149,240,0.12)]"
                      : "bg-white/60 text-[color:var(--muted-foreground)] hover:bg-white/80",
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
    </label>
  );
}

export function AnnouncementDialog({
  isOpen,
  tenderType,
  tenderDraft,
  selectedMeta,
  onClose,
}: {
  isOpen: boolean;
  tenderType: ReadyTenderDocumentType;
  tenderDraft: ReadyTenderDraft;
  selectedMeta: TenderDocumentTypeMeta;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
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
  useEffect(() => {
    if (isOpen) {
      setStep("select_category");
      setCategory(null);
      setDraft(null);
      setErrorMessage(null);
      setSuccessMessage(null);
      setFavoriteStates({});
      setGeneratingStates({});
      setSampleDrawerState(null);
      setAiError(null);
    }
  }, [isOpen, tenderType]);

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
  };

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
      handleFieldChange(fieldKey, result.content);
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

  if (!isOpen) return null;

  const draftRecord = (draft ?? {}) as Record<string, string>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        {...fadeIn(reducedMotion)}
        className="absolute inset-0 bg-[rgba(0,0,0,0.24)] backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <motion.div
        {...fadeIn(reducedMotion)}
        className={[
          "relative z-10 flex flex-col overflow-hidden rounded-[24px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]",
          step === "select_category"
            ? "w-[520px] max-h-[80vh]"
            : "w-[1200px] max-h-[90vh]",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">
              {selectedMeta.label} · 公告
            </div>
            <div className="mt-1 flex items-center gap-2">
              {step === "edit" && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="rounded-full border border-white/60 bg-white/80 px-3 py-1 text-xs font-medium text-[color:var(--muted-foreground)] transition-all hover:bg-white hover:shadow-sm"
                >
                  ← 返回选择
                </button>
              )}
              <h2 className="text-[1.05rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
                {step === "select_category" ? "选择公告类型" : dialogTitle}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step === "edit" && draft && (
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting}
                className="tender-btn tender-btn--export disabled:cursor-not-allowed"
              >
                <span className="tb-icon tb-anim-bob">
                  <FileDown size={13} />
                </span>
                {exporting ? "导出中..." : "导出公告"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="neu-btn-xs"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {step === "select_category" ? (
            /* Category Selection */
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="grid gap-4 w-full max-w-lg">
                {availableCategories.map((cat) => {
                  const catMeta = ANNOUNCEMENT_CATEGORIES.find(
                    (c) => c.type === cat,
                  );
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => handleSelectCategory(cat)}
                      className="group rounded-[22px] border border-white/60 bg-white/80 px-6 py-5 text-left transition-all duration-300 hover:border-[rgba(107,149,240,0.3)] hover:bg-[rgba(244,248,255,0.98)] hover:shadow-[0_12px_28px_rgba(59,89,143,0.1)]"
                    >
                      <div className="text-[1.05rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                        {getAnnouncementLabel(tenderType, cat)}
                      </div>
                      <div className="mt-1.5 text-sm leading-6 text-[color:var(--muted-foreground)]">
                        {catMeta?.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Editor + Preview */
            <div className="flex min-h-0 flex-1 flex-row gap-4 p-4">
              {/* Editor (left) */}
              <section className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(245,248,255,0.8))] shadow-[0_18px_40px_rgba(59,89,143,0.08)]">
                <div className="shrink-0 border-b border-white/60 px-5 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(94,126,189,0.76)]">
                    编辑区
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    {fields.filter((f) => draftRecord[f.key]?.trim()).length}/{fields.length} 项已填写
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-5 tender-scroll">
                  <div className="grid gap-3">
                    {fields
                      .filter((field) => {
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
              <aside className="flex min-h-0 flex-[1.1] flex-col overflow-hidden rounded-[22px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,250,255,0.92))] shadow-[0_18px_40px_rgba(59,89,143,0.08)]">
                <div className="shrink-0 border-b border-white/60 px-5 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(94,126,189,0.76)]">
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
                  <div className="rounded-[18px] border border-[rgba(230,236,248,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(247,249,255,0.88))] m-3 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
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
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="shrink-0 border-t border-[rgba(230,129,102,0.16)] bg-[rgba(255,247,244,0.86)] px-6 py-3 text-sm text-[rgba(199,108,83,1)]">
            {errorMessage}
          </div>
        )}

        {/* Success toast */}
        {successMessage && (
          <div className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-in">
            <div className="rounded-full border border-[rgba(92,181,150,0.3)] bg-[rgba(92,181,150,0.95)] px-5 py-3 text-sm font-medium text-white shadow-lg">
              {successMessage}
            </div>
          </div>
        )}

        {/* AI / Import error toast */}
        {aiError && (
          <div className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-in">
            <div className="rounded-full border border-[rgba(230,129,102,0.3)] bg-[rgba(230,129,102,0.95)] px-5 py-3 text-sm font-medium text-white shadow-lg">
              {aiError}
            </div>
          </div>
        )}
      </motion.div>

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
    </div>
  );
}
