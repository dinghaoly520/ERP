"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  FileDown,
  Upload,
  FileText,
  Loader2,
  UserCircle,
  Table,
  FileTextIcon,
  Sparkles,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { ReadyTenderDraft, ReadyTenderDocumentType } from "@/lib/types/tender-write";
import { numberToChineseAmount } from "@/lib/tender-write/announcement-templates";
import {
  extractNotificationData,
  exportNotificationLetter,
  exportNotificationLedger,
  type NotificationLetterDraft,
} from "@/lib/api/announcement";
import { fetchProjectAttributions, type ProjectAttribution } from "@/lib/api/project-management";
import { aiIdentifyField } from "@/lib/api/project-management";
import type { FieldCandidate } from "@/lib/types/project-management";
import { ContactPickerDialog } from "./contact-picker-dialog";

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
  extensions: string[],
): Promise<boolean> {
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "Spreadsheet",
            accept: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                extensions,
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

type Step = "upload" | "edit";
type PreviewMode = "letter" | "table";

const CATEGORY_OPTIONS = [
  "生产技术类采购",
  "EPC项目采购",
  "EPC管理采购",
  "公用集中采购",
  "科技研发类采购",
  "信息化采购",
  "其他",
];

const PROCUREMENT_METHOD_OPTIONS = [
  "公开招标",
  "邀请招标",
  "内部竞标/竞价",
  "竞争性谈判",
  "询价采购",
  "单一来源采购",
  "直接委托",
  "续约采购",
  "框架协议采购",
  "直接签订合同",
];

const EMPTY_DRAFT: NotificationLetterDraft = {
  projectName: "",
  winnerName: "",
  winnerPrice: "",
  winnerPriceChinese: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  signatureDate: "",
  department: "",
  controlPrice: "",
  category: "",
  project: "",
  procurementMethod: "",
  remark: "",
};

export function NotificationLetterDialog({
  isOpen,
  tenderType,
  tenderDraft,
  onClose,
}: {
  isOpen: boolean;
  tenderType: ReadyTenderDocumentType;
  tenderDraft: ReadyTenderDraft;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const [step, setStep] = useState<Step>("upload");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("letter");
  const [extracting, setExtracting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectAttribution[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [draft, setDraft] = useState<NotificationLetterDraft>({ ...EMPTY_DRAFT });
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiCandidates, setAiCandidates] = useState<Record<string, FieldCandidate[]>>({});
  const [storedExtractedText, setStoredExtractedText] = useState("");

  // Load project options
  useEffect(() => {
    if (isOpen) {
      fetchProjectAttributions()
        .then(setProjectOptions)
        .catch(() => setProjectOptions([]));
    }
  }, [isOpen]);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep("upload");
      setPreviewMode("letter");
      setErrorMessage(null);
      setSuccessMessage(null);
      setFileName("");
      setExtracting(false);
      setExporting(false);
      setProjectSearch("");
      setAiLoading(null);
      setAiCandidates({});
      setStoredExtractedText("");

      const td = tenderDraft as Record<string, string>;
      setDraft({
        ...EMPTY_DRAFT,
        projectName: td.projectName ?? "",
        contactName: td.contactName ?? "",
        contactPhone: td.contactPhone ?? "",
        contactEmail: td.contactEmail ?? "",
      });
    }
  }, [isOpen, tenderDraft]);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setExtracting(true);
    setErrorMessage(null);

    try {
      const data = await extractNotificationData(file);
      setFileName(file.name);
      if (data.extractedText) {
        setStoredExtractedText(data.extractedText);
      }

      setDraft((prev) => {
        const next = { ...prev };
        if (data.projectName) next.projectName = data.projectName;
        if (data.winnerName) next.winnerName = data.winnerName;
        if (data.winnerPrice) {
          next.winnerPrice = data.winnerPrice;
          next.winnerPriceChinese = numberToChineseAmount(data.winnerPrice);
        }
        if (data.department) next.department = data.department;
        if (data.controlPrice) next.controlPrice = data.controlPrice;
        return next;
      });

      setStep("edit");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "提取失败，请稍后重试。",
      );
    } finally {
      setExtracting(false);
    }
  };

  const handleFieldChange = (
    key: keyof NotificationLetterDraft,
    value: string,
  ) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "winnerPrice") {
        next.winnerPriceChinese = value.trim()
          ? numberToChineseAmount(value)
          : "";
      }
      return next;
    });
  };

  const handleAiIdentify = async (fieldKey: string, fieldLabel: string) => {
    if (!storedExtractedText) return;
    setAiLoading(fieldKey);
    try {
      const candidates = await aiIdentifyField(fieldLabel, storedExtractedText, 3);
      setAiCandidates((prev) => ({ ...prev, [fieldKey]: candidates }));
    } catch {
      setErrorMessage("AI 识别失败，请手动填写。");
    } finally {
      setAiLoading(null);
    }
  };

  const handleContactSelect = (contact: { name: string; email: string; phone: string }) => {
    setDraft((prev) => ({
      ...prev,
      contactName: contact.name,
      contactPhone: contact.phone,
      contactEmail: contact.email,
    }));
  };

  const handleExport = async () => {
    setExporting(true);
    setErrorMessage(null);

    try {
      // 1. Generate and download the notification letter DOCX
      const docxResult = await exportNotificationLetter(draft);
      const saved = await saveFileWithPicker(docxResult.blob, docxResult.fileName, [".docx"]);
      if (saved) {
        // 2. Silently write to the ledger (server-side)
        try {
          await exportNotificationLedger(draft);
        } catch { /* ledger write is non-critical */ }
        setSuccessMessage("导出成功！已同步写入台账。");
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

  const handleProjectSelect = (name: string) => {
    handleFieldChange("project", name);
    setProjectSearch("");
    setProjectDropdownOpen(false);
  };

  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return projectOptions.slice(0, 20);
    const q = projectSearch.toLowerCase();
    return projectOptions.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [projectOptions, projectSearch]);

  // Fields configuration
  const fields = [
    { key: "category" as const, label: "类别", type: "select" as const, options: CATEGORY_OPTIONS },
    { key: "project" as const, label: "项目", type: "combo" as const },
    { key: "procurementMethod" as const, label: "采购方式", type: "select" as const, options: PROCUREMENT_METHOD_OPTIONS },
    { key: "projectName" as const, label: "项目名称", placeholder: "项目名称" },
    { key: "winnerName" as const, label: "中标单位名称", placeholder: "中标单位名称" },
    { key: "department" as const, label: "需求部门", placeholder: "需求部门" },
    { key: "controlPrice" as const, label: "控制价（元）", placeholder: "控制价" },
    { key: "winnerPrice" as const, label: "中标价（元）", placeholder: "中标金额（元）" },
    { key: "winnerPriceChinese" as const, label: "中标金额（大写）", placeholder: "自动生成", readOnly: true },
    { key: "contactName" as const, label: "联系人", placeholder: "联系人", isContact: true },
    { key: "contactPhone" as const, label: "联系电话", placeholder: "联系电话" },
    { key: "contactEmail" as const, label: "联系邮箱", placeholder: "联系邮箱" },
    { key: "signatureDate" as const, label: "落款日期", placeholder: "选择日期", type: "date" as const },
    { key: "remark" as const, label: "备注", placeholder: "备注（选填）" },
  ];

  const filledCount = fields.filter((f) => draft[f.key]?.trim()).length;

  const commonInputClass =
    "mt-2 w-full rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)] hover:border-[oklch(0.6_0.04_258_/_0.35)]";

  if (!isOpen) return null;

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
          step === "upload"
            ? "w-[480px]"
            : "w-[1200px] max-h-[90vh]",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">
              中标通知书台账
            </div>
            <div className="mt-1 flex items-center gap-2">
              {step === "edit" && (
                <button
                  type="button"
                  onClick={() => {
                    setStep("upload");
                    setErrorMessage(null);
                  }}
                  className="neu-btn-xs"
                >
                  ← 返回上传
                </button>
              )}
              <h2 className="text-[1.05rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
                {step === "upload" ? "上传定标审批表" : "确认信息并导出"}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step === "edit" && (
              <>
                {/* Preview mode toggle */}
                <div className="flex items-center rounded-full border border-[oklch(0.6_0.04_258_/_0.22)] bg-[oklch(1_0_0_/_0.4)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setPreviewMode("letter")}
                    className={[
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                      previewMode === "letter"
                        ? "bg-[rgba(107,149,240,0.12)] text-[rgba(75,110,200,1)] shadow-sm"
                        : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]",
                    ].join(" ")}
                  >
                    <FileTextIcon size={12} />
                    通知书
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode("table")}
                    className={[
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                      previewMode === "table"
                        ? "bg-[rgba(107,149,240,0.12)] text-[rgba(75,110,200,1)] shadow-sm"
                        : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]",
                    ].join(" ")}
                  >
                    <Table size={12} />
                    台账
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void handleExport()}
                  disabled={exporting}
                  className="tender-btn tender-btn--export disabled:cursor-not-allowed"
                >
                  <span className="tb-icon tb-anim-bob">
                    <FileDown size={13} />
                  </span>
                  {exporting ? "导出中..." : "生成通知书"}
                </button>
              </>
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
          {step === "upload" ? (
            /* Upload step */
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="w-full max-w-md">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extracting}
                  className="group w-full rounded-[18px] border-2 border-dashed border-[rgba(107,149,240,0.3)] bg-[rgba(244,248,255,0.5)] px-8 py-8 text-center transition-all duration-300 hover:border-[rgba(107,149,240,0.5)] hover:bg-[rgba(240,246,255,0.8)] hover:shadow-[0_12px_28px_rgba(59,89,143,0.08)]"
                >
                  {extracting ? (
                    <div className="flex items-center justify-center gap-3">
                      <Loader2 size={20} className="animate-spin text-[rgba(107,149,240,0.7)]" />
                      <div className="text-sm font-medium text-[color:var(--foreground)]">正在识别定标审批表...</div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(107,149,240,0.1)]">
                        <Upload size={18} className="text-[rgba(107,149,240,0.7)]" />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-medium text-[color:var(--foreground)]">点击上传定标审批表</div>
                        <div className="text-xs text-[color:var(--muted-foreground)]">PDF 格式，系统自动识别中标信息</div>
                      </div>
                    </div>
                  )}
                </button>
                {fileName && !extracting && (
                  <div className="mt-3 flex items-center gap-2 rounded-[14px] border border-[rgba(92,181,150,0.2)] bg-[rgba(92,181,150,0.06)] px-4 py-2">
                    <FileText size={14} className="text-[rgba(78,150,124,1)]" />
                    <span className="text-sm text-[color:var(--foreground)]">{fileName}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Edit + Preview step */
            <div className="flex min-h-0 flex-1 flex-row gap-4 p-4">
              {/* Editor (left) */}
              <section className="flex min-h-0 flex-1 flex-col rounded-[20px] wb-panel">
                <div className="shrink-0 border-b border-[oklch(0.6_0.04_258_/_0.16)] px-5 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(94,126,189,0.76)]">编辑区</div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    {filledCount}/{fields.length} 项已填写
                    {fileName && <span className="ml-2 text-[rgba(78,150,124,1)]">· 已从审批表导入</span>}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-5 tender-scroll">
                  <div className="grid gap-3">
                    {fields.map((field) => {
                      const hasValue = draft[field.key]?.trim().length > 0;
                      const isAutoGenerated = field.readOnly;
                      const isContactField = field.isContact;

                      return (
                        <label
                          key={field.key}
                          className={[
                            "block rounded-[18px] border px-4 py-3.5 transition-all duration-300",
                            hasValue
                              ? "border-[rgba(92,181,150,0.14)] bg-[rgba(92,181,150,0.04)]"
                              : "border-[oklch(0.55_0.05_258_/_0.15)] bg-[oklch(1_0_0_/_0.3)] hover:border-[oklch(0.5_0.08_258_/_0.25)] hover:bg-[oklch(1_0_0_/_0.5)]",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-[color:var(--foreground)]">{field.label}</span>
                            <div className="flex items-center gap-1.5">
                              {isContactField && (
                                <button
                                  type="button"
                                  onClick={() => setContactPickerOpen(true)}
                                  className="flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(107,149,240,0.2)] bg-[rgba(107,149,240,0.06)] text-[rgba(75,110,200,1)] transition-all hover:bg-[rgba(107,149,240,0.12)] hover:shadow-sm"
                                  title="从联系人选择"
                                >
                                  <UserCircle size={13} />
                                </button>
                              )}
                              {!isContactField && !isAutoGenerated && field.type !== "select" && field.type !== "combo" && field.type !== "date" && storedExtractedText && (
                                aiLoading === field.key ? (
                                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-[rgba(147,112,219,0.15)] to-[rgba(96,145,246,0.15)]">
                                    <Loader2 size={14} className="animate-spin text-[rgba(118,100,180,0.9)]" />
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    title="AI 识别"
                                    onClick={() => void handleAiIdentify(field.key, field.label)}
                                    className="group inline-flex items-center justify-center w-7 h-7 rounded-full border border-[rgba(147,112,219,0.2)] bg-[rgba(147,112,219,0.06)] transition-all duration-300 hover:border-[rgba(147,112,219,0.4)] hover:bg-[rgba(147,112,219,0.14)] hover:shadow-[0_0_10px_rgba(147,112,219,0.18)] active:scale-95"
                                  >
                                    <Sparkles size={14} className="text-[rgba(118,100,180,0.85)] transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
                                  </button>
                                )
                              )}
                              <span
                                className={[
                                  "rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all duration-200",
                                  hasValue
                                    ? "bg-[rgba(92,181,150,0.1)] text-[rgba(78,150,124,1)]"
                                    : "bg-[rgba(230,129,102,0.1)] text-[rgba(199,108,83,1)]",
                                ].join(" ")}
                              >
                                {hasValue ? (isAutoGenerated ? "已生成" : "已填写") : "待补充"}
                              </span>
                            </div>
                          </div>

                          {/* Select dropdown */}
                          {field.type === "select" ? (
                            <div className="relative mt-2">
                              <select
                                value={draft[field.key]}
                                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                                className="w-full appearance-none rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 pr-10 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)] hover:border-[oklch(0.6_0.04_258_/_0.35)]"
                              >
                                <option value="" disabled>请选择</option>
                                {field.options!.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                                <svg className="h-4 w-4 text-[color:var(--muted-foreground)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </div>
                            </div>
                          ) : field.type === "combo" ? (
                            /* Combo dropdown + input */
                            <div className="relative mt-2">
                              <input
                                type="text"
                                value={projectDropdownOpen ? projectSearch : (draft[field.key] || "")}
                                onChange={(e) => {
                                  setProjectSearch(e.target.value);
                                  setProjectDropdownOpen(true);
                                  handleFieldChange("project", e.target.value);
                                }}
                                onFocus={() => {
                                  setProjectSearch(draft.project || "");
                                  setProjectDropdownOpen(true);
                                }}
                                onBlur={() => {
                                  // Delay to allow click on dropdown item
                                  setTimeout(() => setProjectDropdownOpen(false), 200);
                                }}
                                placeholder="选择或输入项目名称"
                                className={commonInputClass}
                              />
                              {projectDropdownOpen && filteredProjects.length > 0 && (
                                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-[14px] border border-[oklch(0.6_0.04_258_/_0.22)] bg-[var(--background)] shadow-[0_16px_40px_rgba(0,0,0,0.1)]">
                                  {filteredProjects.map((p) => (
                                    <button
                                      key={p.name}
                                      type="button"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => handleProjectSelect(p.name)}
                                      className="w-full px-4 py-2 text-left text-sm text-[color:var(--foreground)] transition-colors hover:bg-[rgba(107,149,240,0.06)]"
                                    >
                                      {p.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            /* Regular input */
                            <div>
                              <input
                                type={field.type ?? "text"}
                                value={draft[field.key]}
                                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                                placeholder={field.placeholder}
                                readOnly={isAutoGenerated}
                                className={[
                                  commonInputClass,
                                  isAutoGenerated ? "cursor-default bg-[oklch(1_0_0_/_0.3)] opacity-80" : "",
                                ].join(" ")}
                              />
                              {field.key === "signatureDate" && draft.signatureDate.trim() && (
                                <div className="mt-1 text-xs text-[color:var(--muted-foreground)] pl-1">
                                  落款格式：{toChineseDate(draft.signatureDate)}
                                </div>
                              )}
                            </div>
                          )}
                          {aiCandidates[field.key]?.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-[rgba(184,199,227,0.36)]">
                              <div className="text-[11px] font-medium text-[rgba(88,107,142,0.9)] mb-1.5">AI 推荐</div>
                              <div className="space-y-1.5">
                                {aiCandidates[field.key].map((candidate, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => handleFieldChange(field.key, candidate.value)}
                                    className="w-full p-2 text-left rounded-lg border transition-all duration-200 border-[oklch(0.6_0.04_258_/_0.2)] bg-[oklch(1_0_0_/_0.3)] hover:bg-[oklch(1_0_0_/_0.5)]"
                                  >
                                    <span className="text-sm font-medium text-[color:var(--foreground)]">{candidate.value}</span>
                                    <span className="ml-2 text-xs text-[rgba(88,107,142,0.82)]">({(candidate.confidence * 100).toFixed(0)}%)</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Preview (right) */}
              <aside className="flex min-h-0 flex-[1.1] flex-col overflow-hidden rounded-[22px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,250,255,0.92))] shadow-[0_18px_40px_rgba(59,89,143,0.08)]">
                <div className="shrink-0 border-b border-[oklch(0.6_0.04_258_/_0.16)] px-5 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(94,126,189,0.76)]">
                    预览区
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    {previewMode === "letter" ? "中标通知书 · 实时预览" : "台账记录 · 实时预览"}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto tender-scroll">
                  <div className="rounded-[18px] border border-[rgba(230,236,248,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(247,249,255,0.88))] m-3 p-6 pb-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
                    {previewMode === "letter" ? (
                      <NotificationPreview draft={draft} />
                    ) : (
                      <LedgerPreview draft={draft} />
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
      </motion.div>

      {/* Contact picker */}
      {contactPickerOpen && (
        <ContactPickerDialog
          isOpen={contactPickerOpen}
          onSelect={handleContactSelect}
          onClose={() => setContactPickerOpen(false)}
        />
      )}

      {/* Hidden file input */}
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

/** Inline preview of the notification letter */
/** Convert YYYY-MM-DD date input to Chinese date format: 2026年6月10日 */
function toChineseDate(dateStr: string): string {
  if (!dateStr) return "";
  const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return `${parseInt(match[1], 10)}年${parseInt(match[2], 10)}月${parseInt(match[3], 10)}日`;
  }
  return dateStr;
}

function NotificationPreview({ draft }: { draft: NotificationLetterDraft }) {
  return (
    <div className="space-y-5 text-sm leading-7 text-[color:var(--foreground)]">
      <h3 className="text-center text-lg font-semibold tracking-wide">中标通知书</h3>
      <p>
        <PreviewField value={draft.winnerName} placeholder="中标单位名称" />：
      </p>
      <p className="text-indent-[2em]">
        经过我方组织项目（<PreviewField value={draft.projectName} placeholder="项目名称" />）的招标、评标工作已结束，现通知贵单位中标。
      </p>
      <p className="text-indent-[2em]">
        中标金额为人民币：<PreviewField value={draft.winnerPrice} placeholder="中标金额" />
        元（大写：<PreviewField value={draft.winnerPriceChinese} placeholder="大写金额" />）。
      </p>
      <p className="text-indent-[2em]">
        请贵单位在收到中标通知书后，于一个工作日内以书面方式回复，确认中标通知书已被接受。
      </p>
      <p className="text-indent-[2em]">特此通知。</p>
      <div className="space-y-1 pl-[2em]">
        <p>联系人：<PreviewField value={draft.contactName} placeholder="联系人" /></p>
        <p>联系电话：<PreviewField value={draft.contactPhone} placeholder="联系电话" /></p>
        <p>电子邮箱：<PreviewField value={draft.contactEmail} placeholder="联系邮箱" /></p>
      </div>
      <div className="pt-8 text-right">
        <p>四川水发勘测设计研究有限公司</p>
        <p><PreviewField value={toChineseDate(draft.signatureDate)} placeholder="落款日期" /></p>
      </div>
    </div>
  );
}

/** Table preview showing the ledger row */
function LedgerPreview({ draft }: { draft: NotificationLetterDraft }) {
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  };

  const headers = ["时间", "类别", "项目", "项目名称", "中标公司", "需求部门", "控制价", "中标价（元）", "采购方式", "备注"];
  const values = [
    formatDate(draft.signatureDate),
    draft.category,
    draft.project,
    draft.projectName,
    draft.winnerName,
    draft.department,
    draft.controlPrice,
    draft.winnerPrice,
    draft.procurementMethod,
    draft.remark,
  ];

  return (
    <div>
      <div className="mb-4 text-xs text-[color:var(--muted-foreground)]">新增台账记录预览：</div>
      <div className="overflow-x-auto rounded-[14px] border border-[rgba(230,236,248,0.82)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[rgba(230,236,248,0.82)] bg-[rgba(244,248,255,0.6)]">
              {headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-[color:var(--foreground)]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {values.map((v, i) => (
                <td key={i} className="whitespace-nowrap border-b border-white/40 px-3 py-2.5 text-[color:var(--foreground)]">
                  {v ? (
                    <span>{v}</span>
                  ) : (
                    <span className="text-[rgba(230,129,102,0.5)]">—</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewField({ value, placeholder }: { value: string; placeholder: string }) {
  if (value.trim()) {
    return <span className="border-b border-[rgba(92,181,150,0.3)]">{value}</span>;
  }
  return (
    <span className="border-b border-dashed border-[rgba(230,129,102,0.3)] text-[rgba(230,129,102,0.6)]">
      {placeholder}
    </span>
  );
}
