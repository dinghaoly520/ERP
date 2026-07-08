'use client';

import { useRef, useState } from 'react';
import { X, FileUp, Check, AlertTriangle, HelpCircle } from 'lucide-react';
import type { ReadyTenderDocumentType, TenderFieldKey, TenderSectionKey } from '@/lib/types/tender-write';
import type {
  ImportAutofillResult,
  ImportAutofillFieldResult,
} from '@/lib/types/tender-write-import';
import { importAutofill } from '@/lib/api/tender-write-import';

const ACCEPT_STRING = '.docx,.pdf,.md,.txt';

// ---------------------------------------------------------------------------
// Section grouping helper
// ---------------------------------------------------------------------------

type SectionGroup = {
  sectionKey: TenderSectionKey;
  sectionTitle: string;
  fields: ImportAutofillFieldResult[];
};

function groupBySection(
  fields: ImportAutofillFieldResult[],
): SectionGroup[] {
  const map = new Map<TenderSectionKey, SectionGroup>();
  for (const f of fields) {
    let group = map.get(f.sectionKey as TenderSectionKey);
    if (!group) {
      group = {
        sectionKey: f.sectionKey as TenderSectionKey,
        sectionTitle: f.sectionTitle,
        fields: [],
      };
      map.set(f.sectionKey as TenderSectionKey, group);
    }
    group.fields.push(f);
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: ImportAutofillFieldResult['status'] }) {
  if (status === 'recognized') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <Check size={12} /> 高置信
      </span>
    );
  }
  if (status === 'low_confidence') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700">
        <AlertTriangle size={12} /> 低置信
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
      <HelpCircle size={12} /> 未识别
    </span>
  );
}

// ---------------------------------------------------------------------------
// Field card
// ---------------------------------------------------------------------------

function FieldCard({
  field,
  checked,
  onToggle,
}: {
  field: ImportAutofillFieldResult;
  checked: boolean;
  onToggle: () => void;
}) {
  const isFillable = field.status !== 'not_found';

  const borderClass =
    field.status === 'recognized'
      ? 'border-blue-200 bg-blue-50/40'
      : field.status === 'low_confidence'
        ? 'border-amber-200 bg-amber-50/40'
        : 'border-slate-200 bg-slate-50/60 opacity-75';

  return (
    <div className={`rounded-xl border p-3 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={!isFillable}
          onChange={onToggle}
          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-700">
              {field.label}
            </span>
            <StatusBadge status={field.status} />
          </div>
          {isFillable && field.value && (
            <div className="mt-1.5 text-sm font-semibold text-slate-900">
              {field.value}
            </div>
          )}
          {isFillable && field.source && (
            <div
              className={`mt-2 rounded-lg border p-2 text-xs leading-relaxed ${
                field.status === 'low_confidence'
                  ? 'border-amber-200 bg-amber-50/60 text-amber-800'
                  : 'border-blue-200 bg-blue-50/60 text-blue-800'
              }`}
            >
              <div>
                <strong>来源字段：</strong>
                {field.source.fileName} / {field.source.location} / &ldquo;
                {field.source.sourceField}&rdquo;
              </div>
              <div className="mt-1">
                <strong>原文摘录：</strong>
                {field.source.quote}
              </div>
              {field.source.reason && (
                <div className="mt-1">
                  <strong>低置信原因：</strong>
                  {field.source.reason}
                </div>
              )}
            </div>
          )}
          {!isFillable && (
            <div className="mt-1.5 text-xs text-slate-400">
              AI 未在上传文件中找到可用内容，不会回填。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function ImportAutofillDialog({
  documentType,
  onConfirm,
  onClose,
}: {
  documentType: ReadyTenderDocumentType;
  onConfirm: (selectedFields: ImportAutofillFieldResult[]) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportAutofillResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());

  const handleFileSelect = () => {
    inputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    e.target.value = '';

    // Check for .doc files
    const docFiles = selectedFiles.filter(
      (f) =>
        f.name.toLowerCase().endsWith('.doc') &&
        !f.name.toLowerCase().endsWith('.docx'),
    );
    if (docFiles.length > 0) {
      setError(
        `暂不支持 .doc 文件（${docFiles.map((f) => f.name).join('、')}），请另存为 .docx 后再上传。`,
      );
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await importAutofill(documentType, selectedFiles);
      setResult(res);
      // Default: check all fillable fields
      const fillable = new Set(
        res.fields
          .filter((f) => f.status !== 'not_found')
          .map((f) => f.key),
      );
      setCheckedKeys(fillable);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '分析失败，请稍后重试。',
      );
    } finally {
      setLoading(false);
    }
  };

  const toggleKey = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConfirm = () => {
    if (!result) return;
    const selected = result.fields.filter((f) => checkedKeys.has(f.key));
    onConfirm(selected);
  };

  const sections = result ? groupBySection(result.fields) : [];
  const recognizedCount = result?.fields.filter((f) => f.status === 'recognized').length ?? 0;
  const lowConfCount = result?.fields.filter((f) => f.status === 'low_confidence').length ?? 0;
  const notFoundCount = result?.fields.filter((f) => f.status === 'not_found').length ?? 0;

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--background)]/60 backdrop-blur-sm">
        <div className="flex max-h-[85vh] w-[min(820px,92vw)] flex-col rounded-3xl bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                导入文件自动填写
              </h2>
              {result && (
                <p className="mt-1 text-xs text-slate-500">
                  {result.files.length} 个文件 · {recognizedCount} 个识别成功 ·{' '}
                  {lowConfCount} 个低置信 · {notFoundCount} 个未识别
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT_STRING}
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={handleFileSelect}
                disabled={loading}
                className="neu-btn-soft"
              >
                <FileUp size={13} />
                {loading ? '分析中...' : result ? '重新上传' : '选择文件'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="neu-btn-xs"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Inline error message */}
          {error && !loading && (
            <div className="mx-6 mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
              <AlertTriangle size={14} className="shrink-0" />
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="shrink-0 text-red-400 hover:text-red-600"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Body */}
          {!result && !loading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-400">
                <FileUp size={28} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-slate-600">
                  上传资料文件，AI 将自动识别可填写的字段
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  支持 .docx / .pdf / .md / .txt，可上传多个文件
                </p>
              </div>
              <button
                type="button"
                onClick={handleFileSelect}
                className="neu-btn-primary"
              >
                <FileUp size={15} />
                选择文件开始分析
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-3 border-blue-200 border-t-blue-600" />
              <p className="text-sm text-slate-500">正在解析文件并调用 AI 识别，请稍候…</p>
            </div>
          )}

          {result && !loading && (
            <div className="flex min-h-0 flex-1">
              {/* Left sidebar */}
              <aside className="w-[160px] xl:w-[200px] shrink-0 overflow-y-auto border-r border-slate-100 p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  章节
                </div>
                <div className="flex flex-col gap-2">
                  {sections.map((section) => {
                    const recognized = section.fields.filter(
                      (f) => f.status !== 'not_found',
                    ).length;
                    const total = section.fields.length;
                    return (
                      <div
                        key={section.sectionKey}
                        className="rounded-lg border border-slate-150 bg-slate-50/60 px-3 py-2 text-xs"
                      >
                        <div className="font-medium text-slate-700">
                          {section.sectionTitle}
                        </div>
                        <div className="mt-0.5 text-slate-400">
                          {recognized}/{total} 已识别
                        </div>
                      </div>
                    );
                  })}
                </div>
              </aside>

              {/* Right field list */}
              <div className="flex-1 overflow-y-auto p-5">
                <div className="flex flex-col gap-6">
                  {sections.map((section) => (
                    <div key={section.sectionKey}>
                      <h3 className="mb-3 text-sm font-semibold text-slate-600">
                        {section.sectionTitle}
                      </h3>
                      <div className="flex flex-col gap-2">
                        {section.fields.map((field) => (
                          <FieldCard
                            key={field.key}
                            field={field}
                            checked={checkedKeys.has(field.key)}
                            onToggle={() => toggleKey(field.key)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          {result && !loading && (
            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
              <span className="text-xs text-slate-400">
                已选择 {checkedKeys.size} 个字段，确认后写入当前草稿
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="neu-btn-soft"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="neu-btn-primary"
                >
                  确认回填
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

    </>
  );
}
