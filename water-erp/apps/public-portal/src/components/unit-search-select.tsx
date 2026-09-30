'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { SASAC_UNITS } from '@/lib/sasac-units';

/**
 * 集团单位选择器（2026-09-30 自 :3005 login/unit-search-select 完全复刻移植）：
 * 62 家全级次企业名单 + 首行搜索。
 *  面板 = 145° 白→浅灰渐变瓷片 + 方向性双影（无外框线）+ 视口翻转；
 *  搜索区 = sticky 贴顶（外层无顶 padding 防滚动透字）+ 内凹小输入 + hairline 分隔；
 *  当前值 = 白瓷片凸起 + 品牌蓝粗体 + 对勾（与 neu-tab v2 激活语义统一）；选项 hover 品牌蓝淡染。
 * 触发器 44px 对齐 .neu-input；样式类 .uss-* 见 globals.css 尾部。
 */
export function UnitSearchSelect({
  value,
  onChange,
  placeholder = '选择或输入单位名称',
  allowCustom = true,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 允许手输不在名单中的单位；目标必须是集团单位时关闭 */
  allowCustom?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const options = SASAC_UNITS.map((u) => u.name);
  const text = (q || '').trim().toLowerCase();
  const filtered = options.filter((o) => !text || o.toLowerCase().includes(text));
  const current = value;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchorRef.current?.contains(t)) { setOpen(false); setQ(''); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setQ(''); } };
    const onScrollAway = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return; // 面板内部滚动不关闭（铁律②）
      setOpen(false); setQ('');
    };
    const away = () => { setOpen(false); setQ(''); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollAway, true); // 原生 capture（铁律④）
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollAway, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const pick = (v: string) => { setOpen(false); setQ(''); onChange(v); };
  const POP_H = 248;

  return (
    <div ref={anchorRef} className={`relative ${className}`}>
      {/* 触发器：内凹（44px），打开态底色提亮 + chevron 旋转 */}
      <button
        type="button"
        onClick={() => {
          if (!open) {
            const r = anchorRef.current?.getBoundingClientRect();
            if (r) {
              const flip = r.bottom + POP_H + 8 > window.innerHeight && r.top > POP_H + 16; // 下方放不下且上方够 → 向上弹
              setRect({ top: flip ? r.top - POP_H - 8 : r.bottom + 8, left: r.left, width: Math.max(r.width, 220) });
            }
          }
          setOpen((o) => !o);
        }}
        className={`uss-trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择单位"
      >
        <span className={`uss-value ${current ? '' : 'is-empty'}`}>{current || placeholder}</span>
        <ChevronDown size={14} strokeWidth={2} className="uss-chev" />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          role="listbox"
          className="uss-panel"
          style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 700, maxHeight: POP_H }}
        >
          {/* 搜索区：sticky 贴顶（外层无顶 padding），内凹小输入 + 图标 + hairline 分隔 */}
          <div className="uss-search-wrap">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)]" />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索单位…"
                className="uss-search-input"
              />
            </div>
            {allowCustom && text && !filtered.includes(q.trim()) && (
              <button type="button" onClick={() => pick(q.trim())} className="uss-custom">
                使用自定义名称「{q.trim()}」
              </button>
            )}
          </div>
          {/* 当前值：白瓷片凸起 + 品牌蓝粗体 + 对勾 */}
          {current && filtered.includes(current) ? (
            <button type="button" role="option" aria-selected onClick={() => pick(current)}
              className="uss-opt is-current">
              <span className="uss-opt-label">{current}</span>
              <Check size={12} strokeWidth={2.6} className="shrink-0" />
            </button>
          ) : null}
          {current && !filtered.includes(current) ? (
            <button type="button" role="option" onClick={() => pick(current)} className="uss-opt">
              {current}（当前值，不在名单）
            </button>
          ) : null}
          {filtered.filter((o) => o !== current).map((o) => (
            <button key={o} type="button" role="option" aria-selected={false} onClick={() => pick(o)} className="uss-opt">
              {o}
            </button>
          ))}
          {filtered.length === 0 && <div className="uss-empty">无匹配单位</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}
