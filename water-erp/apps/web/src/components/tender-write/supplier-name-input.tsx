'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, Loader2, Hash } from 'lucide-react';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}

/**
 * 供应商名称自动补全输入框（直接采购）。
 * 输入部分内容时从供应商库（已审核通过）检索匹配供应商，下拉选择后填入完整名称。
 */
export function SupplierNameInput({
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  className,
}: Props) {
  const [candidates, setCandidates] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef('');

  // 点击外部关闭
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const searchSuppliers = (query: string) => {
    const q = query.trim();
    if (!q) {
      setCandidates([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    getSupplierList({ search: q, status: 'APPROVED', pageSize: 10 })
      .then((res) => {
        // 防止过期响应覆盖（输入已变）
        if (lastQueryRef.current !== q) return;
        setCandidates(res.items ?? []);
        setOpen(true);
        setHighlightIndex(-1);
      })
      .catch(() => {
        if (lastQueryRef.current === q) {
          setCandidates([]);
          setOpen(false);
        }
      })
      .finally(() => {
        if (lastQueryRef.current === q) setLoading(false);
      });
  };

  const handleChange = (v: string) => {
    onChange(v);
    lastQueryRef.current = v.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchSuppliers(v), 300);
  };

  const handleSelect = (supplier: Supplier) => {
    onChange(supplier.name);
    setOpen(false);
    setCandidates([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || candidates.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % candidates.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? candidates.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (highlightIndex >= 0 && highlightIndex < candidates.length) {
        e.preventDefault();
        handleSelect(candidates[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          onFocus?.();
          // 已有值且有关键字时重新展开
          if (value.trim()) {
            searchSuppliers(value);
          }
        }}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
      />

      {/* 下拉候选 */}
      {open && (
        <div className="tender-popup absolute left-0 right-0 top-full z-50 mt-2 max-h-[260px] overflow-y-auto rounded-[14px] p-1.5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-[color:var(--muted-foreground)]">
              <Loader2 size={14} className="animate-spin" />
              检索供应商…
            </div>
          ) : candidates.length === 0 ? (
            <div className="py-6 text-center text-sm text-[color:var(--muted-foreground)]">
              未找到匹配的已入库供应商
            </div>
          ) : (
            candidates.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelect(s)}
                onMouseEnter={() => setHighlightIndex(idx)}
                className={`flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-150 ${
                  idx === highlightIndex
                    ? 'bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]'
                    : 'hover:bg-[color-mix(in_oklch,var(--accent)_5%,transparent)]'
                }`}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]"
                  style={{
                    background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                    boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)',
                  }}
                >
                  <Building2 size={13} className="text-[var(--accent)]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">
                    {s.name}
                  </div>
                  {s.classification?.name && (
                    <div className="truncate text-[11px] text-[color:var(--muted-foreground)]">
                      {s.classification.name}
                    </div>
                  )}
                </div>
                {s.supplierNo && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium tabular-nums text-[color:var(--muted-foreground)]">
                    <Hash size={9} strokeWidth={1.8} />
                    {s.supplierNo}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
