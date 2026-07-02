'use client';

import { useMemo, useState } from 'react';
import { X, Check, AlertTriangle, HelpCircle } from 'lucide-react';
import type { TenderSectionKey } from '@/lib/types/tender-write';
import type {
  ImportAutofillResult,
  ImportAutofillFieldResult,
} from '@/lib/types/tender-write-import';

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

export function ImportAutofillReviewDialog({
  result,
  onConfirm,
  onCancel,
}: {
  result: ImportAutofillResult;
  onConfirm: (selectedFields: ImportAutofillFieldResult[]) => void;
  onCancel: () => void;
}) {
  const sections = useMemo(
    () => groupBySection(result.fields),
    [result.fields],
  );

  const fillableFields = useMemo(
    () =>
      new Set(
        result.fields
          .filter((f) => f.status !== 'not_found')
          .map((f) => f.key),
      ),
    [result.fields],
  );

  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(fillableFields);

  const toggleKey = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const recognizedCount = result.fields.filter(
    (f) => f.status === 'recognized',
  ).length;
  const lowConfCount = result.fields.filter(
    (f) => f.status === 'low_confidence',
  ).length;
  const notFoundCount = result.fields.filter(
    (f) => f.status === 'not_found',
  ).length;

  const handleConfirm = () => {
    const selected = result.fields.filter((f) => checkedKeys.has(f.key));
    onConfirm(selected);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[min(820px,92vw)] flex-col rounded-3xl border border-white/65 bg-white/95 shadow-[0_24px_64px_rgba(30,60,120,0.18)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              AI 识别结果
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {result.files.length} 个文件 · {recognizedCount} 个识别成功 ·{' '}
              {lowConfCount} 个低置信 · {notFoundCount} 个未识别
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
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

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
          <span className="text-xs text-slate-400">
            已选择 {checkedKeys.size} 个字段，确认后写入当前草稿
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-slate-200 bg-slate-50 px-5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              确认回填
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
