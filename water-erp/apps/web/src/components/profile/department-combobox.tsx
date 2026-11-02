'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

/**
 * 部门联想输入（typeahead，2026-11-02）：触发器即输入框——workbench-input 内凹单框
 * （与表单其他字段完全一致，无框内嵌套），聚焦/输入时浮出本公司部门候选面板
 * （面板视觉对齐 SearchSelect 规范：145° 瓷片渐变 + 方向性双影、portal 挂 body、
 * 视口翻转）。可打字过滤、可键盘选、可自由输入新部门（提交侧找/建本公司部门）。
 */
export function DepartmentCombobox({
  value,
  onChange,
  options,
  placeholder = '选择或输入部门',
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
  placeholder?: string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const text = value.trim();
  const filtered = options
    .filter((d) => !text || d.name.includes(text))
    .sort((a, b) => (a.name === text ? -1 : b.name === text ? 1 : 0)); // 精确匹配置顶（当前值白瓷片）
  const exact = filtered.some((d) => d.name === text);
  // 候选视图：过滤名单 + 「新建并使用」自定义行（输入非名单词时）
  const rows: Array<{ kind: 'option' | 'custom'; name: string }> = filtered.map((d) => ({ kind: 'option' as const, name: d.name }));
  if (text && !exact) rows.push({ kind: 'custom', name: text });

  const place = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const POP_H = 240;
    const flip = r.bottom + POP_H + 8 > window.innerHeight && r.top > POP_H + 16;
    setRect({ top: flip ? r.top - POP_H - 8 : r.bottom + 8, left: r.left, width: Math.max(r.width, 240) });
  };

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        setHighlight(0);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (rows.length ? (h + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (rows.length ? (h - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[highlight];
      if (row) pick(row.name);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={anchorRef} className="relative flex-1">
      {/* 触发器=输入框本体：workbench-input 内凹单框，与表单其他字段一致（无嵌套框） */}
      <div className="relative">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => {
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={64}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className="workbench-input h-[36px] w-full pr-8 text-[13px]"
        />
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </div>
      {open && rect &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: rect.top,
              left: rect.left,
              width: rect.width,
              zIndex: 700,
              maxHeight: 240,
              overflowY: 'auto',
              borderRadius: 16,
              padding: '4px 6px 6px',
              background: 'linear-gradient(145deg, oklch(1 0 0) 0%, oklch(0.965 0.012 258) 100%)',
              boxShadow:
                '6px 6px 18px oklch(0.55 0.03 258 / 0.16), -3px -3px 10px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.9)',
            }}
          >
            {rows.map((row, i) => {
              const active = i === highlight;
              const isCurrent = row.kind === 'option' && row.name === text;
              if (row.kind === 'custom') {
                return (
                  <button
                    key={`custom:${row.name}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(row.name)}
                    className="flex w-full items-center gap-1.5 rounded-[8px] px-2.5 py-[7px] text-left text-xs font-bold text-[var(--accent)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]"
                    style={{ background: 'color-mix(in oklch, var(--accent) 4%, transparent)' }}
                  >
                    <span
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] text-[13px] font-black leading-none"
                      style={{ background: 'color-mix(in oklch, var(--accent) 12%, transparent)' }}
                    >
                      +
                    </span>
                    新建并使用「{row.name}」
                  </button>
                );
              }
              return (
                <button
                  key={row.name}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(row.name)}
                  className={`mb-0.5 flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-[7px] text-left text-xs transition-colors ${
                    isCurrent
                      ? 'font-bold text-[var(--accent)]'
                      : `text-[color:var(--foreground)] ${active ? 'bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]' : ''}`
                  }`}
                  style={
                    isCurrent
                      ? {
                          background: 'oklch(1 0 0)',
                          boxShadow:
                            'inset 0 1px 0 oklch(1 0 0 / 0.95), 2px 2px 6px oklch(0.55 0.03 258 / 0.16), -1px -1px 2px oklch(1 0 0 / 0.9)',
                        }
                      : undefined
                  }
                >
                  <span className="truncate">{row.name}</span>
                  {isCurrent && <Check size={12} strokeWidth={2.6} className="shrink-0" />}
                </button>
              );
            })}
            {rows.length === 0 && (
              <div className="px-2 py-2 text-center text-[10px] text-[color:var(--muted-foreground)]">
                本公司暂无部门记录，直接输入即为新建
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
