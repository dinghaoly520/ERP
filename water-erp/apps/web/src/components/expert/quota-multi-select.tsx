'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

/**
 * 配额多选弹层（2026-10-13）：专家抽取「专业/公司」配额行的多选控件。
 * 专业/公司在同一配额行内支持多选（相近专业并桶、公司并集放行），
 * 空选=「不限」（专业不限/按池 scope），与后端 specialties/companyIds 并集语义对齐。
 * 受控组件：selected 为已选值数组，onChange 回传完整新数组。
 */
export interface QuotaMultiOption {
  value: string;
  label: string;
  /** 右侧补充说明（如「12人·库内」） */
  hint?: string;
}

export function QuotaMultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  title,
  className,
}: {
  options: QuotaMultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** 空选占位文案（「专业不限」/「不限公司」） */
  placeholder: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc 关闭弹层
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const labelOf = (v: string) => options.find(o => o.value === v)?.label ?? v;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={title}
        className="neu-input flex min-h-[36px] w-full flex-wrap items-center gap-1 text-left text-sm"
      >
        {selected.length === 0 ? (
          <span className="truncate text-[color:var(--muted-foreground)]">{placeholder}</span>
        ) : (
          selected.map(v => (
            <span
              key={v}
              role="button"
              tabIndex={-1}
              title={`${labelOf(v)}（点击移除）`}
              onClick={e => { e.stopPropagation(); toggle(v); }}
              className="inline-flex max-w-[180px] shrink-0 cursor-pointer items-center gap-0.5 rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] px-1.5 py-0.5 text-[11px] leading-none text-[var(--foreground)] transition-colors hover:bg-[color-mix(in_oklch,var(--danger,var(--muted-foreground))_18%,transparent)]"
            >
              <span className="truncate">{labelOf(v)}</span>
              <X size={10} className="shrink-0 opacity-60" />
            </span>
          ))
        )}
        <ChevronDown size={13} className={`ml-auto shrink-0 text-[color:var(--muted-foreground)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+4px)] z-50 max-h-[240px] w-max min-w-full overflow-y-auto rounded-xl border border-[oklch(0.55_0.04_258/0.18)] bg-[var(--background)] py-1 shadow-[0_8px_24px_oklch(0.55_0.04_258/0.18)]"
          role="listbox"
          aria-multiselectable
        >
          {options.map(o => {
            const on = selected.includes(o.value);
            return (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)]"
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                    on ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[oklch(0.55_0.04_258/0.35)]'
                  }`}
                >
                  {on && <Check size={10} strokeWidth={3} />}
                </span>
                <input type="checkbox" checked={on} onChange={() => toggle(o.value)} className="sr-only" />
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="ml-auto pl-3 text-[10px] text-[color:var(--muted-foreground)]">{o.hint}</span>}
              </label>
            );
          })}
          {options.length === 0 && <div className="px-3 py-2 text-xs text-[color:var(--muted-foreground)]">无可选项</div>}
        </div>
      )}
    </div>
  );
}
