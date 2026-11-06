'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  CircleStop,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { stopReviewTask, deleteReviewTask } from '@/lib/api/review';
import type { ReviewTask, ReviewReport } from '@/lib/types/tender-review';
import { STATUS_COLORS } from '@/lib/types/tender-review';
import ReportViewCombined from './report-view-combined';
import { useTenderReview } from './tender-review-context';
import { useConfirm } from '@/components/workbench/use-confirm';

export default function ReportsPanelCompact() {
  // 2026-11-06 修复：改吃 context 真源 tasks（provider 2s 轮询驱动）——
  // 原实现本地自拉且仅挂载时加载一次，任务完成后列表永卡「执行中」需手动 F5
  const { tasks, loading: ctxLoading, selectedReportTask, setSelectedReportTask, refreshTasks } = useTenderReview();
  const { confirm, dialog } = useConfirm();
  const [localSelectedTask, setLocalSelectedTask] = useState<ReviewTask | null>(null);

  // Determine which task to show: context-selected takes priority
  const selectedTask = selectedReportTask ?? localSelectedTask;

  async function handleStop(task: ReviewTask) {
    if (!(await confirm({ message: '确定停止该审查任务？', danger: true }))) return;
    try {
      await stopReviewTask(task.id);
      await refreshTasks();
      toast.success('已停止');
    } catch {
      toast.error('停止失败');
    }
  }

  async function handleDelete(task: ReviewTask) {
    if (!(await confirm({ message: '确定删除该审查记录？', danger: true }))) return;
    try {
      await deleteReviewTask(task.id);
      await refreshTasks();
      toast.success('已删除');
    } catch {
      toast.error('删除失败');
    }
  }

  if (ctxLoading.tasks) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (selectedTask) {
    return (
      <ReportViewCombined
        task={selectedTask}
        onBack={() => {
          setSelectedReportTask(null);
          setLocalSelectedTask(null);
          void refreshTasks();
        }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="text-xs text-[var(--muted-foreground)] shrink-0">
        {tasks.length} 条审查记录
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted-foreground)] text-xs">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
          暂无审查报告
        </div>
      ) : (
        <div className="flex-1 min-h-0 space-y-1.5 overflow-y-auto pr-1">
          {tasks.map((task) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`p-2.5 rounded-[12px] hover:bg-[color-mix(in_oklch,var(--muted)_20%,transparent)] transition-colors
                ${task.status === 'completed' ? 'cursor-pointer' : task.status === 'failed' ? 'opacity-60' : 'opacity-60'}`}
              onClick={() => task.status === 'completed' && setLocalSelectedTask(task)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className={`text-xs ${STATUS_COLORS[task.status]}`}>
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : task.status === 'failed' ? (
                      <XCircle className="h-3.5 w-3.5" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                  </span>
                  <span className="text-xs text-[var(--foreground)] truncate">
                    {task.documentName}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {task.status === 'completed' && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[var(--success)]">{task.passedCount}</span>
                      <span className="text-[var(--danger)]">{task.failedCount}</span>
                      <span className="text-[var(--warning)]">{task.warningCount}</span>
                    </div>
                  )}
                  {task.status === 'running' || task.status === 'pending' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStop(task);
                      }}
                      className="p-1 rounded-md text-[var(--muted-foreground)]/40 hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
                      title="停止任务"
                    >
                      <CircleStop className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(task);
                      }}
                      className="p-1 rounded-md text-[var(--muted-foreground)]/40 hover:text-[var(--danger)] hover:bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] transition-colors"
                      title="删除记录"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--muted-foreground)]">
                <Clock className="h-2.5 w-2.5" />
                <span>{new Date(task.createdAt).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}</span>
                <span>·</span>
                <span>{task.reviewMode === 'strict' ? '严格审查' : '通用审查'}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      {dialog}
    </div>
  );
}