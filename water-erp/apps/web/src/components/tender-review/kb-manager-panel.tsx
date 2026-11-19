'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTenderReview, useKnowledgeBaseOps } from './use-tender-review';
import {
  Database,
  Plus,
  ChevronRight,
  FileText,
  Shield,
  Trash2,
  Loader2,
  Share2,
} from 'lucide-react';
import type { KnowledgeBase } from '@/lib/types/tender-review';

/**
 * 知识库管理中心视图（2026-11-18）：自右栏 KbNavSidebar 二态隐藏页升格为中心视图，
 * 入口 = hero 右上「知识库」按钮。行点击=选中（联动审查执行表单），展开=维护操作。
 * 展开区按语义两组分立（2026-11-19）：左组进入类（文件/规则管理）+管理类（共享），
 * 右组危险类（删除）弹性分隔；文件/规则管理为下级子页，进入后由 hero 第二行
 * KbContextBar 承载返回与子页互切——展开态 expandedIds 由父级常驻组件持有，
 * 子页往返不丢（回列表原位展开）。
 */
export default function KbManagerPanel({ expandedIds, onExpandedIdsChange }: {
  expandedIds: Set<string>;
  onExpandedIdsChange: (ids: Set<string>) => void;
}) {
  const { knowledgeBases, selectedKbId, setSelectedKbId, setActiveTab, loading, currentUser } = useTenderReview();
  const { remove, create, update } = useKnowledgeBaseOps();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newShared, setNewShared] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const kb = await create(newName.trim(), newDesc.trim() || undefined, newShared);
      setSelectedKbId(kb.id);
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      setNewShared(false);
    } catch (err) {
      // Error already handled in hook
      console.error('Create KB error:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleExpand = (kb: KnowledgeBase) => {
    const newSet = new Set(expandedIds);
    if (newSet.has(kb.id)) {
      newSet.delete(kb.id);
    } else {
      newSet.add(kb.id);
      setSelectedKbId(kb.id); // 展开即选中（联动审查执行表单）
    }
    onExpandedIdsChange(newSet);
  };

  return (
    <div className="space-y-3">
      {/* 头部：新建入口 */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="neu-btn-soft !h-[34px]"
        >
          <Plus size={14} />新建知识库
        </button>
      </div>

      {/* 新建表单 */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="neu-tile overflow-hidden p-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="知识库名称"
                className="workbench-input w-full sm:max-w-[280px]"
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="描述（可选）"
                className="workbench-input w-full sm:flex-1"
              />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-[color:var(--muted-foreground)]">
                <input
                  type="checkbox"
                  checked={newShared}
                  onChange={(e) => setNewShared(e.target.checked)}
                  className="h-3 w-3 accent-[color:var(--accent)]"
                />
                共享给所有人（他人可使用、不可编辑）
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="neu-btn-soft !h-[30px] !px-3.5 !text-xs"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !newName.trim()}
                  className="neu-btn-primary !h-[30px] !px-3.5 !text-xs"
                >
                  {creating ? <Loader2 size={13} className="animate-spin" /> : null}
                  {creating ? '创建中…' : '创建'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 列表 */}
      {loading.kbs ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[color:var(--accent)]" />
        </div>
      ) : knowledgeBases.length === 0 ? (
        <div className="py-10 text-center text-xs text-[color:var(--muted-foreground)]">
          <Database className="mx-auto mb-2 h-8 w-8 opacity-30" />
          暂无知识库——点击右上「新建知识库」创建第一个
        </div>
      ) : (
        <div className="space-y-1.5">
          {knowledgeBases.map((kb) => (
            <KbManagerItem
              key={kb.id}
              kb={kb}
              canEdit={kb.ownerId === currentUser?.id || currentUser?.role === 'admin'}
              isSelected={selectedKbId === kb.id}
              isExpanded={expandedIds.has(kb.id)}
              deleteConfirm={deleteConfirmId === kb.id}
              onToggleExpand={() => handleToggleExpand(kb)}
              onToggleShare={() => void update(kb.id, { isShared: !kb.isShared }).catch(() => { /* toast 已在 hook 内处理 */ })}
              onViewFiles={() => {
                setSelectedKbId(kb.id);
                setActiveTab('files');
              }}
              onViewRules={() => {
                setSelectedKbId(kb.id);
                setActiveTab('rules');
              }}
              onDelete={() => setDeleteConfirmId(kb.id)}
              onConfirmDelete={() => {
                void remove(kb.id).catch((err) => console.error('Delete KB error:', err));
                // 同步清出展开态，防残留指向已删库
                const next = new Set(expandedIds);
                next.delete(kb.id);
                onExpandedIdsChange(next);
                setDeleteConfirmId(null);
              }}
              onCancelDelete={() => setDeleteConfirmId(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface KbManagerItemProps {
  kb: KnowledgeBase;
  canEdit: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  deleteConfirm: boolean;
  onToggleExpand: () => void;
  onToggleShare: () => void;
  onViewFiles: () => void;
  onViewRules: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function KbManagerItem({
  kb,
  canEdit,
  isSelected,
  isExpanded,
  deleteConfirm,
  onToggleExpand,
  onToggleShare,
  onViewFiles,
  onViewRules,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
}: KbManagerItemProps) {
  return (
    <div className={`neu-tile overflow-hidden ${isSelected ? 'is-accent' : ''}`}>
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
      >
        <Database className={`h-4 w-4 shrink-0 ${isSelected ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted-foreground)]'}`} />
        <div className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] ${isSelected ? 'font-semibold text-[color:var(--accent)]' : 'font-medium text-[color:var(--foreground)]'}`}>
            {kb.name}
            {kb.isShared && (
              <span className="ml-1.5 inline-block rounded-full bg-[color-mix(in_oklch,var(--accent)_15%,transparent)] px-1.5 py-px align-middle text-[9px] font-medium text-[color:var(--accent)]">共享</span>
            )}
          </span>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums tracking-[0.02em] text-[color:var(--muted-foreground)]">
            <span>{kb._count.files} 文件</span>
            <span>{kb._count.rules} 规则</span>
            {kb.description && <span className="min-w-0 flex-1 truncate">· {kb.description}</span>}
          </div>
        </div>
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[color:var(--muted-foreground)] transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 pb-3"
          >
            {canEdit ? (
              deleteConfirm ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-3 py-2.5">
                  <span className="text-xs font-medium text-[color:var(--danger)]">确定删除该知识库？文件与规则将一并移除。</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={onConfirmDelete} className="neu-btn-xs is-danger">确认删除</button>
                    <button type="button" onClick={onCancelDelete} className="neu-btn-xs">取消</button>
                  </div>
                </div>
              ) : (
                /* 两组分立（2026-11-19）：左组 进入类+管理类，右组 危险类——弹性空隙视觉隔离 */
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={onViewFiles} className="neu-btn-xs"><FileText className="h-3 w-3" />文件管理</button>
                    <button type="button" onClick={onViewRules} className="neu-btn-xs"><Shield className="h-3 w-3" />规则管理</button>
                    <button type="button" onClick={onToggleShare} className="neu-btn-xs">
                      <Share2 className="h-3 w-3" />{kb.isShared ? '取消共享' : '设为共享'}
                    </button>
                  </div>
                  <button type="button" onClick={onDelete} className="neu-btn-xs is-danger shrink-0"><Trash2 className="h-3 w-3" />删除</button>
                </div>
              )
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={onViewFiles} className="neu-btn-xs"><FileText className="h-3 w-3" />文件管理</button>
                  <button type="button" onClick={onViewRules} className="neu-btn-xs"><Shield className="h-3 w-3" />规则管理</button>
                </div>
                <span className="shrink-0 text-[10px] text-[color:var(--muted-foreground)]">只读 · 他人共享的知识库</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
