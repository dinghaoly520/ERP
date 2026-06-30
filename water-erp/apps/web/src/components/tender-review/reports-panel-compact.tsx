'use client';

import { useState, useEffect } from 'react';
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
import { fetchReviewTasks, stopReviewTask, deleteReviewTask } from '@/lib/api/review';
import type { ReviewTask, ReviewReport } from '@/lib/types/tender-review';
import { STATUS_COLORS } from '@/lib/types/tender-review';
import ReportViewCombined from './report-view-combined';
import { useTenderReview } from './tender-review-context';

export default function ReportsPanelCompact() {
  const { selectedReportTask, setSelectedReportTask, refreshTasks } = useTenderReview();
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [localSelectedTask, setLocalSelectedTask] = useState<ReviewTask | null>(null);

  // Determine which task to show: context-selected takes priority
  const selectedTask = selectedReportTask ?? localSelectedTask;

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    try {
      const data = await fetchReviewTasks();
      setTasks(data);
    } catch {
      // Error handled silently
    } finally {
      setLoading(false);
    }
  }

  async function handleStop(task: ReviewTask) {
    if (!confirm('确定停止该审查任务？')) return;
    try {
      await stopReviewTask(task.id);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: 'failed' as const } : t,
        ),
      );
      toast.success('已停止');
    } catch {
      toast.error('停止失败');
    }
  }

  async function handleDelete(task: ReviewTask) {
    if (!confirm('确定删除该审查记录？')) return;
    try {
      await deleteReviewTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      toast.success('已删除');
    } catch {
      toast.error('删除失败');
    }
  }

  if (loading) {
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
          loadTasks();
          refreshTasks();
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
              className={`p-2.5 rounded-[12px] bg-white/[0.02] hover:bg-white/[0.04] transition-colors
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
                      <span className="text-[rgba(92,181,150,1)]">{task.passedCount}</span>
                      <span className="text-[rgba(230,129,102,1)]">{task.failedCount}</span>
                      <span className="text-[rgba(234,188,110,1)]">{task.warningCount}</span>
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
                      className="p-1 rounded-md text-[var(--muted-foreground)]/40 hover:text-[rgba(230,129,102,1)] hover:bg-[rgba(230,129,102,0.12)] transition-colors"
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
    </div>
  );
}