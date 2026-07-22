'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useCategoryTree } from '@/lib/hooks/use-category-tree';
import { findNode, getNodePath, type CategoryNode } from '@/lib/category-tree-utils';

interface Props {
  value?: number | null;
  onChange?: (categoryId: number | null, node?: CategoryNode) => void;
  placeholder?: string;
  className?: string;
}

type FlatNode = { node: CategoryNode; depth: number; hasChildren: boolean; isExpanded: boolean };

/** 弹层顶部固定「根节点 / 清除选择」项的哨兵 id（品类 id 恒为正数，-1 不会冲突） */
const CLEAR_ID = -1;

/**
 * 品类树选择器（select-only combobox）：
 * - 触发器 role="combobox" + aria-expanded / aria-controls / aria-activedescendant
 * - 弹层 role="tree"，选项 role="treeitem"（aria-selected / aria-level / aria-expanded）
 * - 键盘：↑↓ 移动高亮，→ 展开 / ← 折叠或回父节点，Enter/Space 选中，Home/End 跳转，Esc 关闭
 */
export function CategoryTreeSelect({ value, onChange, placeholder = '选择品类', className = '' }: Props) {
  const { tree } = useCategoryTree();
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const listboxId = useId();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedNode = value ? findNode(tree, value) : null;
  const displayPath = selectedNode ? getNodePath(tree, value!).map(n => n.name).join(' > ') : '';

  /** 依展开状态扁平化当前可见节点，供键盘导航与渲染共用 */
  const flat = useMemo<FlatNode[]>(() => {
    const out: FlatNode[] = [];
    const walk = (nodes: CategoryNode[], depth: number) => {
      nodes.forEach(n => {
        const hasChildren = (n.children?.length ?? 0) > 0;
        const isExpanded = expandedIds.has(n.id);
        out.push({ node: n, depth, hasChildren, isExpanded });
        if (hasChildren && isExpanded) walk(n.children, depth + 1);
      });
    };
    walk(tree, 0);
    return out;
  }, [tree, expandedIds]);

  const parentOf = useMemo(() => {
    const map = new Map<number, number | null>();
    const walk = (nodes: CategoryNode[], parent: number | null) =>
      nodes.forEach(n => { map.set(n.id, parent); if (n.children?.length) walk(n.children, n.id); });
    walk(tree, null);
    return map;
  }, [tree]);

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const select = (node: CategoryNode) => { onChange?.(node.id, node); setOpen(false); };
  /** 清除选择（onChange(null)）：品类移动时即「留空为根节点」 */
  const selectClear = () => { onChange?.(null); setOpen(false); };

  /** 键盘导航用的完整序列：清除项固定置顶，其后为可见树节点 */
  const navIds = useMemo(() => [CLEAR_ID, ...flat.map(f => f.node.id)], [flat]);
  const optId = (id: number) => (id === CLEAR_ID ? `${listboxId}-opt-clear` : `${listboxId}-opt-${id}`);

  const setHighlight = (id: number | null) => {
    setHighlightId(id);
    if (id != null) optionRefs.current.get(id)?.scrollIntoView({ block: 'nearest' });
  };

  const moveHighlight = (delta: number) => {
    if (navIds.length === 0) return;
    const idx = navIds.indexOf(highlightId as number);
    const next = idx === -1 ? (delta > 0 ? 0 : navIds.length - 1) : Math.min(navIds.length - 1, Math.max(0, idx + delta));
    setHighlight(navIds[next]);
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
        setHighlightId(value ?? flat[0]?.node.id ?? null);
      }
      return;
    }
    const hi = flat.find(f => f.node.id === highlightId);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveHighlight(1); break;
      case 'ArrowUp': e.preventDefault(); moveHighlight(-1); break;
      case 'ArrowRight':
        e.preventDefault();
        if (hi?.hasChildren && !hi.isExpanded) toggleExpand(hi.node.id);
        else moveHighlight(1);
        break;
      case 'ArrowLeft': {
        e.preventDefault();
        if (hi?.hasChildren && hi.isExpanded) toggleExpand(hi.node.id);
        else if (hi) { const p = parentOf.get(hi.node.id); if (p != null) setHighlight(p); }
        break;
      }
      case 'Enter':
      case ' ': e.preventDefault(); if (highlightId === CLEAR_ID) selectClear(); else if (hi) select(hi.node); break;
      case 'Home': e.preventDefault(); if (navIds.length) setHighlight(navIds[0]); break;
      case 'End': e.preventDefault(); if (navIds.length) setHighlight(navIds[navIds.length - 1]); break;
      case 'Escape': e.preventDefault(); setOpen(false); break;
      case 'Tab': setOpen(false); break;
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button type="button" role="combobox" aria-haspopup="tree"
        aria-expanded={open} aria-controls={listboxId} aria-label={placeholder}
        aria-activedescendant={open && highlightId != null ? optId(highlightId) : undefined}
        onClick={() => { setOpen(!open); if (!open && highlightId == null) setHighlightId(value ?? flat[0]?.node.id ?? null); }}
        onKeyDown={onTriggerKeyDown}
        className="neu-input w-full text-left text-sm flex items-center justify-between gap-2">
        <span className={selectedNode ? 'text-[var(--foreground)] truncate' : 'text-[var(--muted-foreground)]'}>
          {displayPath || placeholder}
        </span>
        <ChevronDown size={14} className={`transition-transform text-[var(--muted-foreground)] flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={listboxId} role="tree" aria-label={placeholder} className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto neu-card rounded-xl p-1">
          {/* 固定置顶的清除项：品类移动「留空为根节点」、筛选/录入清除误选均靠它 */}
          <button type="button"
            ref={el => { if (el) optionRefs.current.set(CLEAR_ID, el); else optionRefs.current.delete(CLEAR_ID); }}
            id={optId(CLEAR_ID)}
            role="treeitem" aria-level={1} aria-selected={value == null} tabIndex={-1}
            aria-label="根节点 / 清除选择"
            className={`w-full text-left py-1.5 text-sm rounded-lg flex items-center gap-1.5 transition-colors ${
              value == null ? 'bg-[var(--accent-tint-strong)] text-[var(--accent)] font-semibold' : highlightId === CLEAR_ID ? 'bg-[var(--accent-tint)]' : 'hover:bg-[var(--accent-tint)]'
            }`}
            style={{ paddingLeft: '8px', paddingRight: '12px' }}
            onMouseEnter={() => setHighlightId(CLEAR_ID)}
            onClick={selectClear}>
            <X size={12} className="flex-shrink-0 text-[var(--muted-foreground)]" aria-hidden />
            <span className="truncate">根节点 / 清除选择</span>
          </button>
          {flat.length === 0
            ? <p className="text-xs text-[var(--muted-foreground)] text-center py-4">暂无品类</p>
            : flat.map(f => {
              const isHighlight = f.node.id === highlightId;
              const isSelected = value === f.node.id;
              return (
                <button key={f.node.id} type="button"
                  ref={el => { if (el) optionRefs.current.set(f.node.id, el); else optionRefs.current.delete(f.node.id); }}
                  id={`${listboxId}-opt-${f.node.id}`}
                  role="treeitem" aria-selected={isSelected} aria-level={f.depth + 1}
                  aria-expanded={f.hasChildren ? f.isExpanded : undefined}
                  tabIndex={-1}
                  className={`w-full text-left py-1.5 text-sm rounded-lg flex items-center gap-1.5 transition-colors ${
                    isSelected ? 'bg-[var(--accent-tint-strong)] text-[var(--accent)] font-semibold' : isHighlight ? 'bg-[var(--accent-tint)]' : 'hover:bg-[var(--accent-tint)]'
                  }`}
                  style={{ paddingLeft: `${f.depth * 16 + 8}px`, paddingRight: '12px' }}
                  onMouseEnter={() => setHighlightId(f.node.id)}
                  onClick={() => select(f.node)}>
                  {f.hasChildren ? (
                    <span onClick={e => { e.stopPropagation(); toggleExpand(f.node.id); }} className="p-0.5 cursor-pointer" aria-hidden>
                      <ChevronRight size={12} className={`transition-transform ${f.isExpanded ? 'rotate-90' : ''}`} />
                    </span>
                  ) : <span className="w-4" />}
                  <span className="truncate">{f.node.name}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
