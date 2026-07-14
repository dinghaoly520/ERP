'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.id;
  const isInactive = node.status === 'INACTIVE';

  return (
    <div className="select-none">
      <div
        className={`neu-tree-node group flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer transition-colors ${
          isSelected ? 'bg-[rgba(96,139,239,0.12)] text-[var(--accent)]' : 'hover:bg-[rgba(96,139,239,0.06)]'
        } ${isInactive ? 'opacity-50' : ''}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => { if (hasChildren) setExpanded(!expanded); onSelect?.(node); }}
      >
        <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
          {hasChildren && (
            <motion.div animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
              <ChevronRight size={14} className="text-[var(--muted-foreground)]" />
            </motion.div>
          )}
        </span>
        {hasChildren
          ? (expanded ? <FolderOpen size={15} className="text-[var(--accent)]" /> : <Folder size={15} className="text-[var(--muted-foreground)]" />)
          : <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--muted-foreground)] flex-shrink-0" />}
        <span className={`text-sm font-medium truncate ${isSelected ? 'font-semibold' : ''}`}>{node.name}</span>
        {node.code && <span className="text-[10px] text-[var(--muted-foreground)] font-mono ml-auto hidden group-hover:inline">{node.code}</span>}
        <div className="relative ml-auto hidden group-hover:flex items-center" onClick={e => e.stopPropagation()}>
          <button onClick={() => setMenuOpen(!menuOpen)} className="p-0.5 rounded hover:bg-[rgba(96,139,239,0.1)]">
            <MoreHorizontal size={14} className="text-[var(--muted-foreground)]" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 w-36 neu-card p-1 rounded-xl shadow-lg">
              <button onClick={() => { onAddChild?.(node); setMenuOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-[rgba(96,139,239,0.08)]">新增子节点</button>
              <button onClick={() => { onEdit?.(node); setMenuOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-[rgba(96,139,239,0.08)]">编辑</button>
              {node.isLeaf && <button onClick={() => { onConfigureAttrs?.(node); setMenuOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-[rgba(96,139,239,0.08)]">属性模板</button>}
              <button onClick={() => { onToggleStatus?.(node); setMenuOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-[rgba(96,139,239,0.08)]">{isInactive ? '启用' : '停用'}</button>
              <div className="border-t border-[var(--border-color)] my-0.5" />
              <button onClick={() => { onDelete?.(node); setMenuOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50">删除</button>
            </div>
          )}
        </div>
      </div>
      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}>
            {node.children.map(child => (
              <CategoryTreeNode key={child.id} node={child} depth={depth + 1}
                selectedId={selectedId} onSelect={onSelect} onEdit={onEdit}
                onDelete={onDelete} onToggleStatus={onToggleStatus}
                onAddChild={onAddChild} onConfigureAttrs={onConfigureAttrs} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
