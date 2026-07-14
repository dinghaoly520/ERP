'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCategoryTree } from '@/lib/hooks/use-category-tree';
import { findNode, getNodePath, type CategoryNode } from '@/lib/category-tree-utils';

interface Props {
  value?: number | null;
  onChange?: (categoryId: number | null, node?: CategoryNode) => void;
  placeholder?: string;
  className?: string;
}

export function CategoryTreeSelect({ value, onChange, placeholder = '选择品类', className = '' }: Props) {
  const { tree } = useCategoryTree();
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedNode = value ? findNode(tree, value) : null;
  const displayPath = selectedNode ? getNodePath(tree, value!).map(n => n.name).join(' > ') : '';

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const renderNode = (node: CategoryNode, depth: number) => {
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = node.children?.length > 0;
    return (
      <div key={node.id}>
        <button
          type="button"
          className={`w-full text-left px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5 transition-colors ${
            value === node.id ? 'bg-[rgba(96,139,239,0.12)] text-[var(--accent)] font-semibold' : 'hover:bg-[rgba(96,139,239,0.06)]'
          }`}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => { onChange?.(node.id, node); setOpen(false); }}
        >
          {hasChildren ? (
            <span onClick={e => { e.stopPropagation(); toggleExpand(node.id); }} className="p-0.5">
              <ChevronRight size={12} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </span>
          ) : <span className="w-4" />}
          {node.name}
        </button>
        {isExpanded && hasChildren && node.children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen(!open)} className="neu-input w-full text-left text-sm flex items-center justify-between gap-2">
        <span className={selectedNode ? 'text-[var(--foreground)] truncate' : 'text-[var(--muted-foreground)]'}>
          {displayPath || placeholder}
        </span>
        <ChevronDown size={14} className={`transition-transform text-[var(--muted-foreground)] flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto neu-card rounded-xl p-1">
          {tree.length === 0 ? <p className="text-xs text-[var(--muted-foreground)] text-center py-4">暂无品类</p> : tree.map(n => renderNode(n, 0))}
        </div>
      )}
    </div>
  );
}
