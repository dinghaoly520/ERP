'use client';

import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronRight, Folder, FolderOpen, MoreHorizontal } from 'lucide-react';
import type { CategoryNode } from '@/lib/category-tree-utils';

interface Props {
  node: CategoryNode;
  depth?: number;
  selectedId?: number | null;
  onSelect?: (node: CategoryNode) => void;
  onEdit?: (node: CategoryNode) => void;
  onDelete?: (node: CategoryNode) => void;
  onToggleStatus?: (node: CategoryNode) => void;
  onAddChild?: (parentNode: CategoryNode) => void;
  onConfigureAttrs?: (node: CategoryNode) => void;
}

export function CategoryTreeNode({
  node, depth = 0, selectedId, onSelect,
  onEdit, onDelete, onToggleStatus, onAddChild, onConfigureAttrs,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.id;
  const isInactive = node.status === 'INACTIVE';

  // 操作菜单：外部点击 / Esc 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenuOpen(false); rowRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  // 树键盘导航（WAI-ARIA tree 模式：roving tabindex）
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (menuOpen) return;
    const focusVisible = () => Array.from(document.querySelectorAll('[role="treeitem"]')) as HTMLElement[];
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (hasChildren) setExpanded(x => !x);
        onSelect?.(node);
        break;
      case 'ArrowRight':
        if (hasChildren && !expanded) { e.preventDefault(); setExpanded(true); }
        break;
      case 'ArrowLeft':
        if (hasChildren && expanded) { e.preventDefault(); setExpanded(false); }
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const all = focusVisible();
        const idx = all.indexOf(rowRef.current!);
        if (idx === -1) return;
        all[e.key === 'ArrowDown' ? idx + 1 : idx - 1]?.focus();
        break;
      }
      case 'Home':
      case 'End': {
        e.preventDefault();
        const all = focusVisible();
        (e.key === 'Home' ? all[0] : all[all.length - 1])?.focus();
        break;
      }
    }
  };

  return (
    <div className="select-none">
      <div
        ref={rowRef}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={isSelected}
        tabIndex={isSelected ? 0 : -1}
        onKeyDown={onKeyDown}
        className={`neu-tree-node group flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          isSelected ? 'bg-[var(--accent-tint-strong)] text-[var(--accent)]' : 'hover:bg-[var(--accent-tint)]'
        } ${isInactive ? 'opacity-50' : ''}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => { if (hasChildren) setExpanded(!expanded); onSelect?.(node); }}
      >
        <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center" aria-hidden>
          {hasChildren && (
            <ChevronRight size={14} className={`text-[var(--muted-foreground)] transition-transform ${expanded ? 'rotate-90' : ''}`} />
          )}
        </span>
        {hasChildren
          ? (expanded ? <FolderOpen size={15} className="text-[var(--accent)]" /> : <Folder size={15} className="text-[var(--muted-foreground)]" />)
          : <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--muted-foreground)] flex-shrink-0" aria-hidden />}
        <span className={`text-sm font-medium truncate ${isSelected ? 'font-semibold' : ''}`}>{node.name}</span>
        {node.code && <span className="text-[10px] text-[var(--muted-foreground)] font-mono ml-auto hidden group-hover:inline">{node.code}</span>}
        <div ref={menuRef} className="relative ml-auto hidden group-hover:flex items-center" onClick={e => e.stopPropagation()}>
          <button onClick={() => setMenuOpen(!menuOpen)} aria-haspopup="true" aria-expanded={menuOpen} aria-label={`「${node.name}」操作`} className="p-0.5 rounded hover:bg-[var(--accent-tint)]">
            <MoreHorizontal size={14} className="text-[var(--muted-foreground)]" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 w-36 neu-card p-1 rounded-xl">
              <button onClick={() => { onAddChild?.(node); setMenuOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-[var(--accent-tint)]">新增子节点</button>
              <button onClick={() => { onEdit?.(node); setMenuOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-[var(--accent-tint)]">编辑</button>
              {node.isLeaf && <button onClick={() => { onConfigureAttrs?.(node); setMenuOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-[var(--accent-tint)]">属性模板</button>}
              <button onClick={() => { onToggleStatus?.(node); setMenuOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-[var(--accent-tint)]">{isInactive ? '启用' : '停用'}</button>
              <div className="border-t border-[var(--border-color)] my-0.5" />
              <button onClick={() => { onDelete?.(node); setMenuOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]">删除</button>
            </div>
          )}
        </div>
      </div>
      {expanded && hasChildren && (
        <div role="group">
          {node.children.map(child => (
            <CategoryTreeNode key={child.id} node={child} depth={depth + 1}
              selectedId={selectedId} onSelect={onSelect} onEdit={onEdit}
              onDelete={onDelete} onToggleStatus={onToggleStatus}
              onAddChild={onAddChild} onConfigureAttrs={onConfigureAttrs} />
          ))}
        </div>
      )}
    </div>
  );
}
