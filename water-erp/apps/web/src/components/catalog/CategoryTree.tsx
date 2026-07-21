'use client';

import { RefreshCw, Plus } from 'lucide-react';
import type { CategoryNode } from '@/lib/category-tree-utils';
import { CategoryTreeNode } from './CategoryTreeNode';

interface Props {
  tree: CategoryNode[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  selectedId?: number | null;
  onSelect?: (node: CategoryNode) => void;
  onEdit?: (node: CategoryNode) => void;
  onDelete?: (node: CategoryNode) => void;
  onToggleStatus?: (node: CategoryNode) => void;
  onMove?: (node: CategoryNode) => void;
  onAddRoot?: () => void;
  onAddChild?: (parentNode: CategoryNode) => void;
  onConfigureAttrs?: (node: CategoryNode) => void;
}

export function CategoryTree({
  tree, loading, error, onRefresh,
  selectedId, onSelect, onEdit, onDelete, onToggleStatus, onMove, onAddRoot, onAddChild, onConfigureAttrs,
}: Props) {
  return (
    <div className="wb-panel flex flex-col h-full overflow-hidden">
      <div className="wb-panel-header" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.16)' }}>
        <span className="text-sm font-semibold text-[var(--foreground)]">品类树</span>
        <div className="flex items-center gap-1">
          {onAddRoot && <button onClick={onAddRoot} aria-label="新增根节点" className="neu-btn-xs is-success" title="新增根节点"><Plus size={14} /></button>}
          {onRefresh && <button onClick={onRefresh} disabled={loading} aria-label="刷新品类树" className="neu-btn-xs" title="刷新"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2" role="tree" aria-label="品类树">
        {loading ? (
          <div className="flex items-center justify-center py-12"><RefreshCw size={20} className="animate-spin text-[var(--muted-foreground)]" /><span className="sr-only">加载中</span></div>
        ) : error ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--danger)]" role="alert">{error}</div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-sm text-[var(--muted-foreground)]">暂无品类节点</p>
            {onAddRoot && <button onClick={onAddRoot} className="neu-btn-xs is-info">创建根节点</button>}
          </div>
        ) : (
          tree.map(node => (
            <CategoryTreeNode key={node.id} node={node} depth={0}
              selectedId={selectedId} onSelect={onSelect} onEdit={onEdit}
              onDelete={onDelete} onToggleStatus={onToggleStatus} onMove={onMove}
              onAddChild={onAddChild} onConfigureAttrs={onConfigureAttrs} />
          ))
        )}
      </div>
    </div>
  );
}
