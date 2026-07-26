import { useState, useRef, useEffect } from 'react';
import type {
  ReadyTenderDraft,
  TableData as TableDataType,
  TenderFieldKey,
  TenderSectionConfig,
} from '@/lib/types/tender-write';
import { TenderFieldActions } from './tender-field-actions';
import { TenderFieldSampleDialog } from './tender-field-sample-drawer';
import { ContactPickerDialog } from './contact-picker-dialog';
import {
  QuotationTableEditor,
  createDefaultQuotationTable,
  createEmptyTableData,
  parseTableFromHtml,
  parseQuotationTextToTable,
  type TableData,
} from './quotation-table-editor';
import {
  createFieldSample,
  toggleFieldSampleFavorite,
  generateFieldContent,
} from '@/lib/api/tender-sample';
import { findContactByName } from '@/lib/api/contacts';

// Year-Month selector for coverDate field with custom dropdown panels
function CoverDateSelector({
  value,
  onChange,
  onFocus,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  // Only show current year and ±1 year (3 years total)
  const years = [currentYear - 1, currentYear, currentYear + 1];

  // Parse current value (format: YYYY-MM), default to current year/month
  let selectedYear = currentYear.toString();
  let selectedMonth = currentMonth.toString();
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    selectedYear = value.split('-')[0];
    selectedMonth = value.split('-')[1].replace(/^0/, '');
  }

  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);
  const yearDropdownRef = useRef<HTMLDivElement>(null);
  const monthDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (yearDropdownRef.current && !yearDropdownRef.current.contains(event.target as Node)) {
        setYearDropdownOpen(false);
      }
      if (monthDropdownRef.current && !monthDropdownRef.current.contains(event.target as Node)) {
        setMonthDropdownOpen(false);
        onBlur?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onBlur]);

  const handleYearSelect = (year: number) => {
    const formattedMonth = selectedMonth.padStart(2, '0');
    onChange(`${year}-${formattedMonth}`);
    setYearDropdownOpen(false);
  };

  const handleMonthSelect = (month: number) => {
    const formattedMonth = month.toString().padStart(2, '0');
    onChange(`${selectedYear}-${formattedMonth}`);
    setMonthDropdownOpen(false);
  };

  // Month grid: 2 rows, 6 columns
  const monthRows = [
    [1, 2, 3, 4, 5, 6],
    [7, 8, 9, 10, 11, 12],
  ];

  return (
    <div className="flex gap-2">
      {/* Year dropdown */}
      <div ref={yearDropdownRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setYearDropdownOpen(!yearDropdownOpen);
            onFocus?.();
          }}
          className="w-28 shrink-0 rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] hover:border-[oklch(0.6_0.04_258_/_0.35)] flex items-center justify-between"
        >
          <span>{selectedYear}年</span>
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${yearDropdownOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {yearDropdownOpen && (
          <div className="absolute top-full left-0 mt-2 z-50 rounded-[16px] tender-popup p-2 min-w-[100px]">
            {years.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => handleYearSelect(year)}
                className={[
                  'w-full h-10 rounded-[12px] text-sm font-medium transition-all duration-200 flex items-center justify-center',
                  selectedYear === year.toString()
                    ? 'bg-[rgba(107,149,240,0.16)] text-[rgba(87,126,214,1)]'
                    : 'hover:bg-[rgba(59,89,143,0.08)] text-[color:var(--foreground)]',
                ].join(' ')}
              >
                {year}年
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Month dropdown */}
      <div ref={monthDropdownRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setMonthDropdownOpen(!monthDropdownOpen);
            onFocus?.();
          }}
          className="w-28 shrink-0 rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] hover:border-[oklch(0.6_0.04_258_/_0.35)] flex items-center justify-between"
        >
          <span>{selectedMonth}月</span>
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${monthDropdownOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {monthDropdownOpen && (
          <div className="absolute top-full left-0 mt-2 z-50 rounded-[16px] tender-popup p-3 min-w-[180px]">
            {monthRows.map((row, rowIndex) => (
              <div key={rowIndex} className="flex gap-2 mb-2 last:mb-0">
                {row.map((month) => (
                  <button
                    key={month}
                    type="button"
                    onClick={() => handleMonthSelect(month)}
                    className={[
                      'w-8 h-8 rounded-[12px] text-sm font-medium transition-all duration-200 flex items-center justify-center',
                      selectedMonth === month.toString()
                        ? 'bg-[rgba(107,149,240,0.16)] text-[rgba(87,126,214,1)]'
                        : 'hover:bg-[rgba(59,89,143,0.08)] text-[color:var(--foreground)]',
                    ].join(' ')}
                  >
                    {month}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Format text for textarea display with hierarchical numbered points
function formatTextareaDisplay(text: string): string {
  if (!text || !text.trim()) return text;

  let result = text;

  // First, handle first-level points (1. 2. 3.)
  result = result.replace(/(\d+\.\s)/g, '\n$1');

  // Then, handle second-level circled numbers (①②③④⑤⑥⑦⑧⑨⑩)
  result = result.replace(/([①②③④⑤⑥⑦⑧⑨⑩]+)/g, '\n  $1');

  // Clean up: remove leading newline if the text starts with a numbered point
  result = result.replace(/^\n/, '');

  // Remove multiple consecutive newlines (replace with single newline)
  result = result.replace(/\n+/g, '\n');

  return result.trim();
}

// Convert Chinese datetime format to ISO for datetime-local input display
// "2026年7月1日14:00" → "2026-07-01T14:00"
// Also handles legacy ISO date: "2026-12-31" → "2026-12-31T00:00"
function chineseDatetimeToISO(chinese: string): string {
  if (!chinese) return '';
  const m = chinese.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(\d{1,2}):(\d{2})/);
  if (m) {
    const [, y, mo, d, h, min] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min}`;
  }
  // Fallback: legacy ISO date from old type="date" input
  const isoDate = chinese.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const [, y, mo, d] = isoDate;
    return `${y}-${mo}-${d}T00:00`;
  }
  return '';
}

// Convert ISO datetime-local value to Chinese format for storage
// "2026-07-01T14:00" → "2026年7月1日14:00"
function isoDatetimeToChinese(iso: string): string {
  if (!iso) return '';
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso; // Already Chinese format or plain text, pass through
  const [, y, mo, d, h, min] = m;
  return `${parseInt(y, 10)}年${parseInt(mo, 10)}月${parseInt(d, 10)}日${h}:${min}`;
}

export function TenderSectionEditor({
  section,
  draft,
  onChange,
  onTableChange,
  onFieldFocus,
  onSampleOpen,
}: {
  section: TenderSectionConfig;
  draft: ReadyTenderDraft;
  onChange: (key: TenderFieldKey, value: string) => void;
  onTableChange?: (tableData: TableDataType | undefined) => void;
  onFieldFocus?: (fieldKey: TenderFieldKey) => void;
  onSampleOpen?: (fieldKey: TenderFieldKey, fieldLabel: string) => void;
}) {
  const [sampleDrawerState, setSampleDrawerState] = useState<{
    isOpen: boolean;
    fieldKey: TenderFieldKey;
    fieldLabel: string;
  } | null>(null);

  const [favoriteStates, setFavoriteStates] = useState<
    Record<string, boolean>
  >({});

  const [generatingStates, setGeneratingStates] = useState<
    Record<string, boolean>
  >({});

  const [contactPickerOpen, setContactPickerOpen] = useState(false);

  const [activeFieldKey, setActiveFieldKey] = useState<TenderFieldKey | null>(null);
  const [recentFieldKey, setRecentFieldKey] = useState<TenderFieldKey | null>(null);

  const dateInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const recentFieldTimeoutRef = useRef<number | null>(null);

  const [aiError, setAiError] = useState<string | null>(null);

  const handleSampleOpenLocal = (
    fieldKey: TenderFieldKey,
    fieldLabel: string,
  ) => {
    if (onSampleOpen) {
      onSampleOpen(fieldKey, fieldLabel);
    } else {
      setSampleDrawerState({ isOpen: true, fieldKey, fieldLabel });
    }
  };

  const handleSampleClose = () => {
    setSampleDrawerState(null);
  };

  const handleSampleSelect = (content: string) => {
    if (sampleDrawerState) {
      onChange(sampleDrawerState.fieldKey, content);
    }
  };

  const handleFavoriteToggle = async (
    fieldKey: TenderFieldKey,
    currentValue: string,
  ) => {
    if (!currentValue.trim()) return;

    const isCurrentlyFavorite = favoriteStates[fieldKey] ?? false;

    try {
      if (isCurrentlyFavorite) {
        // 取消收藏：需要找到对应的样本并取消收藏
        // 这里简化处理，直接更新状态
        setFavoriteStates((prev) => ({ ...prev, [fieldKey]: false }));
      } else {
        // 添加收藏：创建新样本并标记为收藏
        await createFieldSample({
          fieldKey,
          content: currentValue,
          isFavorite: true,
          sourceType: 'manual',
        });
        setFavoriteStates((prev) => ({ ...prev, [fieldKey]: true }));
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const handleAiGenerate = async (
    fieldKey: TenderFieldKey,
    fieldLabel: string,
    currentValue: string,
    aiPrompt?: string,
  ) => {
    setGeneratingStates((prev) => ({ ...prev, [fieldKey]: true }));
    setAiError(null);

    try {
      // 构建上下文：所有已填写字段的内容
      const context: Record<string, string> = {};
      for (const [key, value] of Object.entries(draft)) {
        // Skip non-string values (like tables) and empty values
        if (typeof value === 'string' && value.trim() && key !== fieldKey) {
          // 使用字段的 label 作为上下文键名
          const fieldConfig = section.fields.find((f) => f.key === key);
          const label = fieldConfig?.label ?? key;
          context[label] = value;
        }
      }

      const result = await generateFieldContent({
        fieldKey,
        fieldLabel,
        currentValue,
        aiPrompt,
        context,
      });

      console.log('AI generation result:', result);

      if (!result.content) {
        throw new Error('AI返回的内容为空');
      }

      // 报价表/报价函：将 AI 文本解析为表格并自动切换到设计表格模式
      const isQuotationField = fieldKey === 'quotationLetter';
      const tableData = isQuotationField
        ? parseQuotationTextToTable(result.content)
        : null;

      if (tableData && onTableChange) {
        // 先切换类型再写入表格，确保编辑器渲染正确
        onChange('quotationLetterType' as TenderFieldKey, 'table');
        onTableChange(tableData);
      } else {
        onChange(fieldKey, result.content);
      }

      // 自动保存生成的样本（AI 原始文本，便于回看）
      await createFieldSample({
        fieldKey,
        content: result.content,
        sourceType: 'ai_generated',
        context: { generatedAt: new Date().toISOString(), prompt: aiPrompt },
      });
    } catch (error) {
      console.error('Failed to generate content:', error);
      setAiError(error instanceof Error ? error.message : 'AI生成失败，请稍后重试');
      // Auto-hide error after 5 seconds
      setTimeout(() => setAiError(null), 5000);
    } finally {
      setGeneratingStates((prev) => ({ ...prev, [fieldKey]: false }));
    }
  };

  const handleContactSelect = (contact: { name: string; email: string; phone: string }) => {
    onChange('contactName', contact.name);
    onChange('contactEmail', contact.email);
    onChange('contactPhone', contact.phone);
  };

  // 保存人工输入的样本
  const saveManualSample = async (fieldKey: TenderFieldKey, content: string) => {
    if (!content.trim()) return;
    try {
      await createFieldSample({
        fieldKey,
        content,
        sourceType: 'manual',
      });
    } catch (error) {
      // 静默失败，不影响用户体验
      console.error('Failed to save manual sample:', error);
    }
  };

  const handleContactNameChange = async (value: string) => {
    onChange('contactName', value);

    // Auto-fill email and phone if contact name matches existing contact
    if (value.trim()) {
      try {
        const contact = await findContactByName(value.trim());
        if (contact) {
          // Only fill if email/phone are empty
          if (!draft.contactEmail?.trim() && contact.email) {
            onChange('contactEmail', contact.email);
          }
          if (!draft.contactPhone?.trim() && contact.phone) {
            onChange('contactPhone', contact.phone);
          }
        }
      } catch {
        // Silently ignore errors
      }
    }
  };

  // Auto-fill copyCount and evaluationCommitteeCount based on maxPrice
  const handleMaxPriceChange = (value: string) => {
    onChange('maxPrice', value);

    // Auto-calculate copy count and evaluation committee count based on max price
    const maxPriceNum = parseFloat(value.replace(/[^\d.]/g, ''));
    if (!isNaN(maxPriceNum)) {
      const copyCount = maxPriceNum < 1000000 ? '4' : '6';
      const evaluationCommitteeCount = maxPriceNum < 1000000 ? '5' : '7';
      onChange('copyCount', copyCount);
      onChange('evaluationCommitteeCount', evaluationCommitteeCount);
    }
  };

  // Check if current section has contact fields
  const hasContactFields = section.fields.some(
    (f) => f.key === 'contactName' || f.key === 'contactEmail' || f.key === 'contactPhone',
  );

  // Handle date input - listen for change and track for double-click
  const lastDateValueRef = useRef<Record<string, { value: string; time: number }>>({});

  const handleDateChange = (fieldKey: TenderFieldKey, value: string) => {
    const now = Date.now();
    const lastChange = lastDateValueRef.current[fieldKey];

    // Check if this is a double-click (same value selected within 300ms)
    if (lastChange && lastChange.value === value && now - lastChange.time < 300) {
      // Double-click: close the date picker by blurring the input
      const input = dateInputRefs.current[fieldKey];
      if (input) {
        input.blur();
      }
      // Clear the ref to prevent triple-click issues
      lastDateValueRef.current[fieldKey] = { value, time: 0 };
    } else {
      // Single click: just record the change
      lastDateValueRef.current[fieldKey] = { value, time: now };
    }

    onChange(fieldKey, value);
  };

  const markFieldEdited = (fieldKey: TenderFieldKey) => {
    setRecentFieldKey(fieldKey);
    if (recentFieldTimeoutRef.current) {
      window.clearTimeout(recentFieldTimeoutRef.current);
    }
    recentFieldTimeoutRef.current = window.setTimeout(() => {
      setRecentFieldKey((current) => (current === fieldKey ? null : current));
    }, 1800);
  };

  useEffect(() => {
    return () => {
      if (recentFieldTimeoutRef.current) {
        window.clearTimeout(recentFieldTimeoutRef.current);
      }
    };
  }, []);

  const getFieldCardClassName = (fieldKey: TenderFieldKey, filled: boolean) =>
    [
      'tender-field-card',
      filled ? 'tender-field-card--filled' : '',
      activeFieldKey === fieldKey ? 'tender-field-card--active' : '',
      recentFieldKey === fieldKey ? 'tender-field-card--recent' : '',
    ]
      .filter(Boolean)
      .join(' ');

  const renderFieldHelper = ({
    fieldLabel,
    placeholder,
    aiPrompt,
    hasValue,
    isGenerating,
  }: {
    fieldLabel: string;
    placeholder: string;
    aiPrompt?: string;
    hasValue: boolean;
    isGenerating: boolean;
  }) => {
    if (isGenerating) {
      return 'AI 正在生成内容，请稍候。';
    }
    return '';
  };

  return (
    <>
      {/* AI Error Alert */}
      {aiError && (
        <div className="mb-4 rounded-[12px] border border-[color-mix(in_oklch,var(--danger)_22%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm text-[color:var(--danger)]">
          {aiError}
        </div>
      )}
      <section className="tender-section-enter" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid gap-2">
          {section.fields.map((field) => {
            // Skip response deposit detail fields if not collecting (only for InternalBiddingDraft)
            const draftAny = draft as Record<string, string>;
            if (
              draftAny.responseDepositType !== 'collect' &&
              ['responseDepositAmount', 'responseDepositForm', 'responseDepositBankInfo', 'responseDepositOtherForm', 'responseDepositOtherRequirement', 'responseDepositNonRefundType', 'responseDepositNonRefundContent'].includes(field.key)
            ) {
              return null;
            }

            // Skip bank info field if not cash form
            if (
              draftAny.responseDepositForm !== 'cash' &&
              field.key === 'responseDepositBankInfo'
            ) {
              return null;
            }

            // Skip other form field if not other
            if (
              draftAny.responseDepositForm !== 'other' &&
              field.key === 'responseDepositOtherForm'
            ) {
              return null;
            }

            // Skip other requirement detail if type is none
            if (
              draftAny.responseDepositOtherRequirementType !== 'have' &&
              field.key === 'responseDepositOtherRequirement'
            ) {
              return null;
            }

            // Skip non-refund content field if type is none or not collecting
            if (
              (draftAny.responseDepositNonRefundType !== 'have' || draftAny.responseDepositType !== 'collect') &&
              field.key === 'responseDepositNonRefundContent'
            ) {
              return null;
            }

            // Skip non-refund type field if not collecting
            if (
              draftAny.responseDepositType !== 'collect' &&
              field.key === 'responseDepositNonRefundType'
            ) {
              return null;
            }

            // Skip performance deposit detail fields if not collecting
            if (
              draftAny.performanceDepositType !== 'collect' &&
              ['performanceDepositAmount', 'performanceDepositForm', 'performanceDepositOtherForm'].includes(field.key)
            ) {
              return null;
            }

            // Skip other form field for performance deposit if not other
            if (
              draftAny.performanceDepositForm !== 'other' &&
              field.key === 'performanceDepositOtherForm'
            ) {
              return null;
            }

            const value = draft[field.key as keyof ReadyTenderDraft] as string;
            const hasValue = value.trim().length > 0;
            const isFavorite = favoriteStates[field.key] ?? false;
            const isGenerating = generatingStates[field.key] ?? false;
            const helperText = renderFieldHelper({
              fieldLabel: field.label,
              placeholder: field.placeholder,
              aiPrompt: field.aiPrompt,
              hasValue,
              isGenerating,
            });
            const commonClassName =
              'tender-field-input';

            // Handle composite field (like projectDuration with type selector)
            if (field.composite) {
              const typeValue = draft[field.composite.typeKey as keyof ReadyTenderDraft] as string;
              // "datetime" = explicit datetime-type field (datetime-local input)
              // "date" = legacy date-only composite (plain date input)
              // "month" = month-only composite (month input)
              const isDateType = typeValue === 'date' || typeValue === 'month' || typeValue === 'datetime';
              const isDatetimeType = typeValue === 'datetime';
              // Compute HTML input type and display value for datetime-local
              const inputType = isDatetimeType ? 'datetime-local' : (isDateType ? typeValue : 'text');
              const displayValue = isDatetimeType ? chineseDatetimeToISO(value) : value;
              // For contractSubcontracting: hide input when type is "none" (不允许)
              // For consortiumForm: hide input when type is "reject" (不接受)
              // For submissionRequirements: hide input when type is "none" (无)
              const isNoneType = typeValue === 'none';
              const isRejectType = typeValue === 'reject';
              const shouldHideInput = (field.key === 'contractSubcontracting' && isNoneType) || (field.key === 'consortiumForm' && isRejectType) || (field.key === 'submissionRequirements' && isNoneType);

              // For composite fields with "none" type, consider as filled when type is selected
              // For contractSubcontracting and submissionRequirements, selecting "none" means completed
              const isCompletedByNoneType = (field.key === 'contractSubcontracting' || field.key === 'submissionRequirements') && isNoneType;
              const effectiveHasValue = hasValue || isCompletedByNoneType;

              // Hide field actions for submissionRequirements when type is "none"
              const shouldHideActions = field.key === 'submissionRequirements' && isNoneType;

              return (
                <label key={field.key} className={getFieldCardClassName(field.key, effectiveHasValue)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.82rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                        {field.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!shouldHideActions && (
                        <TenderFieldActions
                          fieldKey={field.key}
                          currentValue={value}
                          isFavorite={isFavorite}
                          isGenerating={isGenerating}
                          fieldTypeValue={typeValue}
                          onSampleOpen={() =>
                            handleSampleOpenLocal(field.key, field.label)
                          }
                          onFavoriteToggle={() =>
                            handleFavoriteToggle(field.key, value)
                          }
                          onAiGenerate={() =>
                            handleAiGenerate(
                              field.key,
                              field.label,
                              value,
                              field.aiPrompt,
                            )
                          }
                        />
                      )}
                      <span
                        className={[
                          'rounded-[5px] px-2.5 py-1 text-[10px] font-semibold transition-all duration-200',
                          typeValue
                            ? 'bg-[rgba(92,181,150,0.1)] text-[rgba(78,150,124,1)]'
                            : 'bg-[rgba(230,129,102,0.1)] text-[rgba(199,108,83,1)]',
                        ].join(' ')}
                      >
                        {typeValue ? '已选择' : '待选择'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex items-center">
                      <select
                        value={typeValue || ""}
                        onChange={(event) => onChange(field.composite!.typeKey, event.target.value)}
                        className="w-32 shrink-0 rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] hover:border-[oklch(0.6_0.04_258_/_0.35)]"
                      >
                        <option value="" disabled>
                          请选择
                        </option>
                        {field.composite.typeOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {!typeValue ? (
                      <div className="flex-1 flex items-center">
                        <div className="tender-field-static w-full">
                          请先选择
                        </div>
                      </div>
                    ) : shouldHideInput ? (
                      <div className="flex-1 flex items-center">
                        <div className="tender-field-static w-full">
                          无需填写
                        </div>
                      </div>
                    ) : field.multiline ? (
                      <textarea
                        value={formatTextareaDisplay(value)}
                        onChange={(event) => {
                          const normalizedValue = event.target.value.replace(/\n+/g, '\n');
                          onChange(field.key, normalizedValue);
                          markFieldEdited(field.key);
                        }}
                        onBlur={(event) => {
                          const content = event.target.value;
                          if (content.trim()) {
                            saveManualSample(field.key, content);
                          }
                          setActiveFieldKey((current) => (current === field.key ? null : current));
                        }}
                        onFocus={() => {
                          onFieldFocus?.(field.key);
                          setActiveFieldKey(field.key);
                        }}
                        placeholder={field.placeholder}
                        className={`${commonClassName} tender-field-input--textarea min-h-[168px] flex-1`}
                      />
                    ) : (
                      <div className="h-[48px] flex-1">
                        <input
                          ref={(el) => {
                            if (isDateType && el) {
                              dateInputRefs.current[field.key] = el;
                            }
                          }}
                          type={inputType}
                          value={displayValue}
                          onChange={(event) => {
                            if (isDateType) {
                              const raw = event.target.value;
                              const stored = isDatetimeType ? isoDatetimeToChinese(raw) : raw;
                              handleDateChange(field.key, stored);
                            } else {
                              onChange(field.key, event.target.value);
                              markFieldEdited(field.key);
                            }
                          }}
                          onKeyDown={(event) => {
                            // Press Tab to fill "另行通知" for fields with that placeholder
                            if (event.key === 'Tab' && field.placeholder === '另行通知' && !value.trim()) {
                              event.preventDefault();
                              onChange(field.key, '另行通知');
                              markFieldEdited(field.key);
                            }
                          }}
                          onFocus={() => {
                            onFieldFocus?.(field.key);
                            setActiveFieldKey(field.key);
                          }}
                          onBlur={() => setActiveFieldKey((current) => (current === field.key ? null : current))}
                          placeholder={isDatetimeType ? '选择日期时间' : isDateType ? '选择日期' : field.placeholder}
                          className={`${commonClassName} h-full w-full`}
                        />
                      </div>
                    )}
                  </div>
                </label>
              );
            }

            // Handle toggle field (yes/no selection)
            if (field.toggle) {
              const typeFieldKey = field.typeKey;
              const typeValue = typeFieldKey ? (draft as Record<string, string>)[typeFieldKey] : undefined;
              const hasTypeSelected = typeValue !== undefined && typeValue !== '';

              // 只有当 typeKey 存在时，才使用 typeValue 来判断选中状态
              // 如果没有 typeKey，则使用原来的逻辑（通过 value 判断）
              let isYes: boolean;
              let isNo: boolean;

              if (typeFieldKey) {
                // 有 typeKey 时，完全依赖 typeValue 来判断
                isYes = typeValue === 'yes';
                isNo = typeValue === 'no';
              } else {
                // 没有 typeKey 时，使用原来的逻辑
                isYes = value === field.toggle.yesValue;
                isNo = field.toggle.noValue !== undefined && value === field.toggle.noValue;
              }

              const hasSelected = isYes || isNo;

              return (
                <div key={field.key} className={getFieldCardClassName(field.key, hasSelected)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.82rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                        {field.label}
                      </span>
                    </div>
                    <span
                      className={[
                        'rounded-[5px] px-2.5 py-1 text-[10px] font-semibold transition-all duration-200',
                        hasSelected
                          ? 'bg-[rgba(92,181,150,0.1)] text-[rgba(78,150,124,1)]'
                          : 'bg-[rgba(230,129,102,0.1)] text-[rgba(199,108,83,1)]',
                      ].join(' ')}
                    >
                      {hasSelected ? '已选择' : '待选择'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (typeFieldKey) {
                          onChange(typeFieldKey, 'yes');
                        }
                        onChange(field.key, field.toggle!.yesValue);
                      }}
                      className={[
                        'tender-segment-button',
                        isYes ? 'tender-segment-button--active' : '',
                      ].join(' ')}
                    >
                      {field.toggle.yesLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeFieldKey) {
                          onChange(typeFieldKey, 'no');
                        }
                        onChange(field.key, field.toggle!.noValue || '');
                      }}
                      className={[
                        'tender-segment-button',
                        isNo ? 'tender-segment-button--active' : '',
                      ].join(' ')}
                    >
                      {field.toggle.noLabel}
                    </button>
                  </div>
                </div>
              );
            }

            // Handle select field (multiple choice)
            if (field.select) {
              const selectedOption = field.select.options.find(opt => opt.value === value);

              return (
                <div key={field.key} className={getFieldCardClassName(field.key, Boolean(selectedOption))}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.82rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                        {field.label}
                      </span>
                    </div>
                    <span
                      className={[
                        'rounded-[5px] px-2.5 py-1 text-[10px] font-semibold transition-all duration-200',
                        selectedOption
                          ? 'bg-[rgba(92,181,150,0.1)] text-[rgba(78,150,124,1)]'
                          : 'bg-[rgba(230,129,102,0.1)] text-[rgba(199,108,83,1)]',
                      ].join(' ')}
                    >
                      {selectedOption ? '已选择' : '待选择'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {field.select.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(field.key, opt.value)}
                        className={[
                          'tender-segment-button',
                          value === opt.value ? 'tender-segment-button--active' : '',
                        ].join(' ')}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }

            // Handle quotationType field (text/table selection)
            if (field.quotationType) {
              const typeKey = 'quotationLetterType' as TenderFieldKey;
              const typeValue = (draft[typeKey as keyof ReadyTenderDraft] as string) || 'text';
              const isText = typeValue === 'text';
              const isTable = typeValue === 'table';

              // Get table data from quotationLetterTable field or parse from JSON string
              let tableData: TableData | null = null;
              if (isTable) {
                // First try to get from quotationLetterTable field
                const draftWithTable = draft as { quotationLetterTable?: TableDataType };
                if (draftWithTable.quotationLetterTable) {
                  tableData = draftWithTable.quotationLetterTable;
                } else if (value.trim()) {
                  // Fallback to parsing from JSON string for backward compatibility
                  try {
                    tableData = JSON.parse(value);
                  } catch {
                    tableData = null;
                  }
                }
              }
              if (isTable && !tableData) {
                tableData = createDefaultQuotationTable();
              }

              return (
                <div key={field.key} className={getFieldCardClassName(field.key, (isText && value.trim().length > 0) || isTable)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.82rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                        {field.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TenderFieldActions
                        fieldKey={field.key}
                        currentValue={isText ? value : (tableData ? JSON.stringify(tableData) : '')}
                        isFavorite={isFavorite}
                        isGenerating={isGenerating}
                        fieldTypeValue={isTable ? 'table' : 'text'}
                        onSampleOpen={() =>
                          handleSampleOpenLocal(field.key, field.label)
                        }
                        onFavoriteToggle={() => {
                          if (isText) {
                            handleFavoriteToggle(field.key, value);
                          } else if (tableData) {
                            // For table type, serialize to JSON string
                            handleFavoriteToggle(field.key, JSON.stringify(tableData));
                          }
                        }}
                        onAiGenerate={() => {
                          if (isText) {
                            handleAiGenerate(field.key, field.label, value, field.aiPrompt);
                          }
                          // Table type: AI generation is disabled, but the button remains visible
                        }}
                      />
                      <span
                        className={[
                          'rounded-[5px] px-2.5 py-1 text-[10px] font-semibold transition-all duration-200',
                          (isText && value.trim()) || (isTable && tableData)
                            ? 'bg-[rgba(92,181,150,0.1)] text-[rgba(78,150,124,1)]'
                            : 'bg-[rgba(230,129,102,0.1)] text-[rgba(199,108,83,1)]',
                        ].join(' ')}
                      >
                        {((isText && value.trim()) || (isTable && tableData)) ? '已填写' : '待填写'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {field.quotationType.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          onChange(typeKey, opt.value);
                          // Initialize empty table when switching to table mode
                          if (opt.value === 'table' && onTableChange) {
                            const draftWithTable = draft as { quotationLetterTable?: TableDataType };
                            if (!draftWithTable.quotationLetterTable) {
                              onTableChange(createDefaultQuotationTable());
                            }
                          }
                        }}
                        className={[
                          'tender-segment-button',
                          typeValue === opt.value ? 'tender-segment-button--active' : '',
                        ].join(' ')}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {isText && (
                    <textarea
                      value={value}
                      onChange={(e) => onChange(field.key, e.target.value)}
                      onBlur={(e) => {
                        // 保存人工输入的样本
                        const content = e.target.value;
                        if (content.trim()) {
                          saveManualSample(field.key, content);
                        }
                      }}
                      onFocus={() => onFieldFocus?.(field.key)}
                      placeholder="请输入报价函内容"
                      className="min-h-[168px] rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)] hover:border-[oklch(0.6_0.04_258_/_0.35)] resize-y"
                    />
                  )}
                  {isTable && tableData && (
                    <QuotationTableEditor
                      value={tableData}
                      onChange={(data) => {
                        if (onTableChange) {
                          onTableChange(data);
                        }
                      }}
                    />
                  )}
                </div>
              );
            }

            return (
              <div key={field.key} className={getFieldCardClassName(field.key, hasValue)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.82rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                      {field.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <TenderFieldActions
                      fieldKey={field.key}
                      currentValue={value}
                      isFavorite={isFavorite}
                      isGenerating={isGenerating}
                      isContactField={field.key === 'contactName'}
                      onSampleOpen={() =>
                        handleSampleOpenLocal(field.key, field.label)
                      }
                      onFavoriteToggle={() =>
                        handleFavoriteToggle(field.key, value)
                      }
                      onAiGenerate={() =>
                        handleAiGenerate(
                          field.key,
                          field.label,
                          value,
                          field.aiPrompt,
                        )
                      }
                      onContactOpen={() => setContactPickerOpen(true)}
                    />
                    <span
                      className={[
                        'rounded-[5px] px-2.5 py-1 text-[10px] font-semibold transition-all duration-200',
                        hasValue
                          ? 'bg-[rgba(92,181,150,0.1)] text-[rgba(78,150,124,1)]'
                          : 'bg-[rgba(230,129,102,0.1)] text-[rgba(199,108,83,1)]',
                      ].join(' ')}
                    >
                      {hasValue ? '已填写' : '待补充'}
                    </span>
                  </div>
                </div>
                {field.key === 'coverDate' ? (
                  <CoverDateSelector
                    value={value}
                    onChange={(newValue) => onChange(field.key, newValue)}
                    onFocus={() => {
                      onFieldFocus?.(field.key);
                      setActiveFieldKey(field.key);
                    }}
                    onBlur={() => setActiveFieldKey((current) => (current === field.key ? null : current))}
                  />
                ) : field.multiline ? (
                  <div className="relative">
                    <textarea
                      value={formatTextareaDisplay(value)}
                      onChange={(event) => {
                        // Convert display format back to storage format (remove extra newlines)
                        const normalizedValue = event.target.value.replace(/\n+/g, '\n');
                        onChange(field.key, normalizedValue);
                        markFieldEdited(field.key);
                      }}
                      onBlur={(event) => {
                        const content = event.target.value;
                        if (content.trim()) {
                          saveManualSample(field.key, content);
                        }
                        setActiveFieldKey((current) => (current === field.key ? null : current));
                      }}
                      onFocus={() => {
                        onFieldFocus?.(field.key);
                        setActiveFieldKey(field.key);
                      }}
                      placeholder={field.placeholder}
                      className={`${commonClassName} tender-field-input--textarea`}
                    />
                    {/* Only show character count for non-composite multiline fields */}
                    {!field.composite && !field.toggle && (
                      <div className="absolute bottom-2 right-3 text-[10px] text-[color:var(--muted-foreground)]">
                        {value.length} 字
                      </div>
                    )}
                  </div>
                ) : (
                  <input
                    ref={(el) => {
                      if ((field.type === 'date' || field.type === 'month') && el) {
                        dateInputRefs.current[field.key] = el;
                      }
                    }}
                    type={field.type ?? 'text'}
                    value={value}
                    onChange={(event) => {
                      if (field.type === 'date' || field.type === 'month') {
                        handleDateChange(field.key, event.target.value);
                      } else if (field.key === 'contactName') {
                        handleContactNameChange(event.target.value);
                        markFieldEdited(field.key);
                      } else if (field.key === 'maxPrice') {
                        handleMaxPriceChange(event.target.value);
                        markFieldEdited(field.key);
                      } else {
                        onChange(field.key, event.target.value);
                        markFieldEdited(field.key);
                      }
                    }}
                    onKeyDown={(event) => {
                      // Press Tab to fill "另行通知" for fields with that placeholder
                      if (event.key === 'Tab' && field.placeholder === '另行通知' && !value.trim()) {
                        event.preventDefault();
                        onChange(field.key, '另行通知');
                        markFieldEdited(field.key);
                      }
                    }}
                    onBlur={(event) => {
                      const content = event.target.value;
                      if (content.trim() && field.type !== 'date' && field.type !== 'month' && !['contactName', 'contactEmail', 'contactPhone', 'maxPrice'].includes(field.key)) {
                        saveManualSample(field.key, content);
                      }
                      setActiveFieldKey((current) => (current === field.key ? null : current));
                    }}
                    onFocus={() => {
                      onFieldFocus?.(field.key);
                      setActiveFieldKey(field.key);
                    }}
                    placeholder={field.placeholder}
                    className={commonClassName}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {sampleDrawerState && !onSampleOpen && (
        <TenderFieldSampleDialog
          isOpen={sampleDrawerState.isOpen}
          fieldKey={sampleDrawerState.fieldKey}
          fieldLabel={sampleDrawerState.fieldLabel}
          onSelect={handleSampleSelect}
          onClose={handleSampleClose}
        />
      )}

      {contactPickerOpen && hasContactFields && (
        <ContactPickerDialog
          isOpen={contactPickerOpen}
          onSelect={handleContactSelect}
          onClose={() => setContactPickerOpen(false)}
        />
      )}
    </>
  );
}