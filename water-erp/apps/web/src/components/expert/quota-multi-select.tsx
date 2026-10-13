'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/**
 * 配额选择弹层（2026-10-13 多选化；同日重构为注册公司选择器同款设计）：
 * 专家抽取「专业/公司」配额行与需求方代表公司选择共用。
 * 设计语言与 :3005 注册 UnitSearchSelect 同源：
 *  - 触发器 = neumorphic 内凹胶囊（打开态提亮 + chevron 旋转）；
 *  - 面板 = portal 下拉瓷片（145° 白→浅灰渐变 + 方向性双影 + 视口翻转），
 *    滚离视口/resize 自动收起（面板内部滚动不关）；
 *  - 搜索区 = sticky 贴顶内凹小输入 + hairline 分隔（多选态附「已选 N 项/清空」）；
 *  - 激活项 = 白瓷片凸起 + 品牌蓝粗体（与 neu-tab v2 激活语义统一）。
 * 受控组件：selected 为已选值数组（single 模式至多 1 项），onChange 回传完整新数组。
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
  single = false,
}: {
  options: QuotaMultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** 空选占位文案（「专业不限」/「选择公司」） */
  placeholder: string;
  title?: string;
  className?: string;
  /** 单选模式（需求方代表公司等）：点击即选中并收起，触发器显纯文本 */
  single?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const text = (q || '').trim().toLowerCase();
  const filtered = options.filter(o => !text || o.label.toLowerCase().includes(text) || o.value.toLowerCase().includes(text));

  // 外点 / Esc / 滚离视口 / resize 收起（面板内部滚动不关）
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchorRef.current?.contains(t)) { setOpen(false); setQ(''); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setQ(''); } };
    const onScrollAway = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false); setQ('');
    };
    const away = () => { setOpen(false); setQ(''); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollAway, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollAway, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);

  const labelOf = (v: string) => options.find(o => o.value === v)?.label ?? v;
  const toggle = (v: string) => {
    if (single) { onChange(selected[0] === v ? [] : [v]); setOpen(false); setQ(''); return; }
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  };
  const POP_H = 272;

  return (
    <div ref={anchorRef} className={`relative ${className ?? ''}`}>
      {/* 触发器：neumorphic 内凹（注册公司选择器同款）；多选=chips 行内可点删，单选=纯文本 */}
      <button
        type="button"
        title={title}
        onClick={() => {
          if (!open) {
            const r = anchorRef.current?.getBoundingClientRect();
            if (r) {
              const flip = r.bottom + POP_H + 8 > window.innerHeight && r.top > POP_H + 16; // 下方放不下且上方够 → 向上弹
              setRect({ top: flip ? r.top - POP_H - 8 : r.bottom + 8, left: r.left, width: Math.max(r.width, 220) });
            }
          }
          setOpen(o => !o);
        }}
        className="flex min-h-[38px] w-full flex-wrap items-center gap-1 rounded-[10px] px-2.5 py-1 text-left text-[13px] outline-none transition-all focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1"
        style={{
          background: open ? 'oklch(0.985 0.01 252)' : 'var(--surface)',
          border: 'none',
          boxShadow: 'inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.85)',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected.length === 0 ? (
          <span className="truncate text-[color:var(--muted-foreground)]">{placeholder}</span>
        ) : single ? (
          <span className="truncate font-semibold text-[var(--foreground)]">{labelOf(selected[0])}</span>
        ) : (
          selected.map(v => (
            <span
              key={v}
              role="button"
              tabIndex={-1}
              title={`${labelOf(v)}（点击移除）`}
              onClick={e => { e.stopPropagation(); toggle(v); }}
              className="inline-flex max-w-[180px] shrink-0 cursor-pointer items-center gap-0.5 rounded-full bg-[oklch(1_0_0)] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.95),1px_1px_3px_oklch(0.55_0.03_258/0.14),-1px_-1px_2px_oklch(1_0_0/0.9)] transition-colors hover:text-[color:var(--danger)]"
            >
              <span className="truncate">{labelOf(v)}</span>
              <X size={10} className="shrink-0 opacity-70" />
            </span>
          ))
        )}
        <ChevronDown size={13} strokeWidth={2} className={`ml-auto shrink-0 text-[color:var(--muted-foreground)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          role="listbox"
          aria-multiselectable={!single}
          style={{
            position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 700,
            maxHeight: POP_H, overflowY: 'auto', borderRadius: 16, padding: '0 6px 6px',
            background: 'linear-gradient(145deg, oklch(1 0 0) 0%, oklch(0.965 0.012 258) 100%)',
            boxShadow: '6px 6px 18px oklch(0.55 0.03 258 / 0.16), -3px -3px 10px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.9)',
          }}
        >
          {/* 搜索区：sticky 贴顶，内凹小输入 + 图标 + hairline 分隔；多选态附「已选 N 项 / 清空」 */}
          <div
            className="sticky top-0 z-10 mb-1 px-1 pb-1.5 pt-1.5"
            style={{
              background: 'linear-gradient(145deg, oklch(1 0 0) 0%, oklch(0.965 0.012 258) 100%)',
              borderRadius: '16px 16px 0 0',
              boxShadow: '0 2px 4px -2px oklch(0.55 0.03 258 / 0.18)',
            }}
          >
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
              <input
                ref={searchRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="搜索…"
                className="h-[34px] w-full rounded-[10px] pl-[30px] pr-2 text-[12.5px] text-[var(--foreground)] outline-none"
                style={{ background: 'var(--surface)', border: 'none', boxShadow: 'inset 2px 2px 5px oklch(0.55 0.03 258 / 0.12), inset -2px -2px 5px oklch(1 0 0 / 0.85)' }}
              />
            </div>
            {!single && selected.length > 0 && (
              <div className="mt-1 flex items-center justify-between px-1">
                <span className="text-[10px] text-[color:var(--muted-foreground)]">已选 {selected.length} 项</span>
                <button type="button" onClick={() => onChange([])} className="text-[10px] font-semibold text-[var(--accent)] hover:underline">清空</button>
              </div>
            )}
          </div>
          {filtered.map(o => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className={`mb-0.5 flex w-full items-center gap-2 rounded-[10px] px-2.5 py-[7px] text-left text-xs transition-colors ${on ? 'font-bold text-[var(--accent)]' : 'text-[color:var(--foreground)] hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]'}`}
                style={on ? { background: 'oklch(1 0 0)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.95), 2px 2px 6px oklch(0.55 0.03 258 / 0.16), -1px -1px 2px oklch(1 0 0 / 0.9)' } : undefined}
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                    on ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[oklch(0.55_0.04_258/0.35)]'
                  }`}
                >
                  {on && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="ml-auto pl-3 text-[10px] font-normal text-[color:var(--muted-foreground)]">{o.hint}</span>}
              </button>
            );
          })}
          {filtered.length === 0 && <div className="px-2 py-2 text-center text-[10px] text-[color:var(--muted-foreground)]">无匹配项</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}
