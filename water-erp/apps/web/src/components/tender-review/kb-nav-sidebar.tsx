'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTenderReview, useKnowledgeBaseOps } from './use-tender-review';
import {
  Database,
  Plus,
  ChevronRight,
  Shield,
  Trash2,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import type { KnowledgeBase } from '@/lib/types/tender-review';

type PanelState = 'stats' | 'kb-list';

interface KbNavSidebarProps {
  width?: number;
}

export default function KbNavSidebar({ width = 384 }: KbNavSidebarProps) {
  const { knowledgeBases, selectedKbId, setSelectedKbId, setActiveTab, loading, stats, recentReviews, runningTasks, setSelectedReportTask } = useTenderReview();
  const { remove, create } = useKnowledgeBaseOps();
  const [panelState, setPanelState] = useState<PanelState>('stats');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const selectedKb = knowledgeBases.find(kb => kb.id === selectedKbId);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const kb = await create(newName.trim(), newDesc.trim() || undefined);
      setSelectedKbId(kb.id);
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
    } catch (err) {
      // Error already handled in hook
      console.error('Create KB error:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteKb = async (kbId: string) => {
    try {
      await remove(kbId);
      setDeleteConfirmId(null);
    } catch (err) {
      console.error('Delete KB error:', err);
    }
  };

  const handleViewFiles = (kbId: string) => {
    setSelectedKbId(kbId);
    setActiveTab('files');
  };

  const handleViewRules = (kbId: string) => {
    setSelectedKbId(kbId);
    setActiveTab('rules');
  };

  // Stats view (default)
  if (panelState === 'stats') {
    return (
      <div className="wb-panel rounded-[20px] h-full flex flex-col overflow-hidden"
        style={{ width: `${width}px` }}>
        {/* Header */}
        <div className="p-3 shrink-0" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <h3 className="text-sm font-semibold text-[color:var(--foreground)]">今日统计</h3>
        </div>

        {/* Stats content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Today stats */}
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-[10px] text-center" style={{background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}>
                <div className="text-lg font-bold text-[color:var(--foreground)]">{stats.totalReviews}</div>
                <div className="text-[10px] text-[color:var(--muted-foreground)]">审查数</div>
              </div>
              <div className="p-2.5 rounded-[10px] text-center" style={{background:"color-mix(in oklch,var(--success) 10%,transparent)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.5), 2px 2px 4px oklch(0.55 0.03 258 / 0.06)"}}>
                <div className="text-lg font-bold text-[color:var(--success)]">{stats.passedCount}</div>
                <div className="text-[10px] text-[color:var(--success)]/70">通过</div>
              </div>
              <div className="p-2.5 rounded-[10px] text-center" style={{background:"color-mix(in oklch,var(--danger) 8%,transparent)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.5), 2px 2px 4px oklch(0.55 0.03 258 / 0.06)"}}>
                <div className="text-lg font-bold text-[color:var(--danger)]">{stats.failedCount}</div>
                <div className="text-[10px] text-[color:var(--danger)]/70">违规</div>
              </div>
            </div>
          </div>

          {/* Warning count */}
          {stats.warningCount > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-[10px] bg-[color-mix(in_oklch,var(--warning)_10%,transparent)]">
              <AlertTriangle className="h-4 w-4 text-[color:var(--warning)]" />
              <span className="text-xs text-[color:var(--warning)]">{stats.warningCount} 个警告</span>
            </div>
          )}

          {/* Running tasks */}
          {runningTasks.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-[color:var(--muted-foreground)]">进行中</div>
              {runningTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2 p-2 rounded-[10px] bg-[color-mix(in_oklch,var(--accent-soft)_30%,transparent)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--accent)]" />
                  <span className="text-xs text-[color:var(--foreground)] truncate">{task.documentName}</span>
                </div>
              ))}
            </div>
          )}

          {/* Recent reviews */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-[color:var(--muted-foreground)]">最近审查</div>
            {recentReviews.length === 0 ? (
              <div className="text-xs text-[color:var(--muted-foreground)] text-center py-4">
                暂无审查记录
              </div>
            ) : (
              <div className="space-y-1.5">
                {recentReviews.slice(0, 5).map((task) => (
                  <button
                    key={task.id}
                    onClick={() => {
                      if (task.status === 'completed') {
                        setSelectedReportTask(task);
                        setActiveTab('reports');
                      }
                    }}
                    disabled={task.status !== 'completed'}
                    className={`w-full flex items-center gap-2 p-2 rounded-[8px] transition-colors ${
                      task.status === 'completed'
                        ? 'cursor-pointer hover:bg-[color-mix(in_oklch,var(--muted)_25%,transparent)]'
                        : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--success)]" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-[color:var(--danger)]" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[color:var(--foreground)] truncate">{task.documentName}</div>
                      <div className="text-[10px] text-[color:var(--muted-foreground)] flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer: KB button */}
        <div className="p-3 shrink-0" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <button
            onClick={() => setPanelState('kb-list')}
            className="neu-btn-soft w-full flex items-center justify-center gap-2 !rounded-[10px] !h-[36px]"
          >
            <Database className="h-3.5 w-3.5" />
            知识库
          </button>
        </div>
      </div>
    );
  }

  // KB list view
  return (
    <div className="wb-panel rounded-[20px] w-96 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 shrink-0" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPanelState('stats')}
            className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回统计
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="p-1.5 rounded-lg text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
            title="新建知识库"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Create new KB form */}
        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 space-y-1.5"
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="知识库名称"
                className="workbench-input w-full !h-[32px] !text-xs"
              />
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="描述（可选）"
                rows={1}
                className="neu-input w-full !min-h-[36px] !text-xs !p-1.5 resize-none"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={handleCreate}
                  disabled={creating || !newName.trim()}
                  className="neu-btn-primary flex-1 !rounded-[8px] !h-[30px] !text-xs"
                >
                  {creating ? '...' : '创建'}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-[8px] px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  取消
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* KB List */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading.kbs ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
          </div>
        ) : knowledgeBases.length === 0 ? (
          <div className="text-center py-8 text-[var(--muted-foreground)] text-xs">
            <Database className="h-8 w-8 mx-auto mb-2 opacity-30" />
            暂无知识库
          </div>
        ) : (
          <div className="space-y-1">
            {knowledgeBases.map((kb) => (
              <KbNavItem
                key={kb.id}
                kb={kb}
                isSelected={selectedKbId === kb.id}
                isExpanded={expandedIds.has(kb.id)}
                deleteConfirm={deleteConfirmId === kb.id}
                onToggleExpand={() => {
                  const newSet = new Set(expandedIds);
                  if (newSet.has(kb.id)) newSet.delete(kb.id);
                  else {
                    newSet.add(kb.id);
                    setSelectedKbId(kb.id); // 同时选中
                  }
                  setExpandedIds(newSet);
                }}
                onViewFiles={() => handleViewFiles(kb.id)}
                onViewRules={() => handleViewRules(kb.id)}
                onDelete={() => setDeleteConfirmId(kb.id)}
                onConfirmDelete={() => handleDeleteKb(kb.id)}
                onCancelDelete={() => setDeleteConfirmId(null)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface KbNavItemProps {
  kb: KnowledgeBase;
  isSelected: boolean;
  isExpanded: boolean;
  deleteConfirm: boolean;
  onToggleExpand: () => void;
  onViewFiles: () => void;
  onViewRules: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function KbNavItem({
  kb,
  isSelected,
  isExpanded,
  deleteConfirm,
  onToggleExpand,
  onViewFiles,
  onViewRules,
  onDelete,
  onConfirmDelete,
  onCancelDelete
}: KbNavItemProps) {
  return (
    <div className={`rounded-[10px] overflow-hidden ${isSelected ? 'bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/30' : ''}`}>
      {/* KB header */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-[color-mix(in_oklch,var(--muted)_20%,transparent)] transition-colors"
      >
        <Database className={`h-4 w-4 shrink-0 ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--muted-foreground)]'}`} />
        <div className="min-w-0 flex-1">
          <span className={`text-xs truncate block ${isSelected ? 'text-[var(--foreground)] font-medium' : 'text-[var(--foreground)]'}`}>
            {kb.name}
          </span>
          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-[var(--muted-foreground)]">
            <span>{kb._count.files} 文件</span>
            <span>{kb._count.rules} 规则</span>
          </div>
        </div>
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {/* Expanded actions */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-2.5 pb-2 space-y-1"
          >
            <button
              onClick={onViewFiles}
              className="flex items-center justify-center gap-1.5 w-full rounded-[8px] px-2.5 py-1.5 text-xs font-medium
                bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
            >
              <FileText className="h-3 w-3" />
              文件管理
            </button>
            <button
              onClick={onViewRules}
              className="flex items-center justify-center gap-1.5 w-full rounded-[8px] px-2.5 py-1.5 text-xs font-medium
                bg-[color-mix(in_oklch,var(--muted)_20%,transparent)] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[color-mix(in_oklch,var(--muted)_35%,transparent)] transition-colors"
            >
              <Shield className="h-3 w-3" />
              规则管理
            </button>
            <button
              onClick={onDelete}
              className="flex items-center justify-center gap-1.5 w-full rounded-[8px] px-2.5 py-1.5 text-xs font-medium
                bg-[rgba(230,129,102,0.12)] text-[rgba(230,129,102,1)] hover:bg-[rgba(230,129,102,0.2)] transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              删除知识库
            </button>
            {deleteConfirm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-2 p-3 rounded-[10px] bg-[rgba(230,129,102,0.12)] border border-[rgba(230,129,102,0.2)] mt-2"
              >
                <span className="text-sm font-medium text-[rgba(230,129,102,1)] text-center">确定删除？</span>
                <div className="flex gap-2">
                  <button onClick={onConfirmDelete} className="neu-btn-soft is-danger flex-1 !rounded-[8px] !h-[32px] !text-xs">确认</button>
                  <button onClick={onCancelDelete} className="neu-btn-soft flex-1 !rounded-[8px] !h-[32px] !text-xs">取消</button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}