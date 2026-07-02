'use client';

import { useState, useEffect } from 'react';
import {
  FileSearch,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  Search,
  CircleStop,
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchReviewTasks, deleteReviewTask, stopReviewTask } from '@/lib/api/review';
import type { ReviewTask } from '@/lib/types/tender-review';
import { STATUS_COLORS } from '@/lib/types/tender-review';
import TaskReportView from './task-report-view';

export default function ReportPanel() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<ReviewTask | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    try {
      const data = await fetchReviewTasks();
      setTasks(data);
    } catch {
      toast.error('加载审查记录失败');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (selectedTask) {
    return (
      <TaskReportView
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <h3 className="text-lg font-semibold text-[var(--foreground)] shrink-0">审查报告</h3>
        <div className="flex-1" />
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索文档名称..."
            className="w-full h-8 pl-8 pr-3 text-sm rounded-lg bg-white/[0.04] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/40 focus:outline-none focus:border-[var(--accent)]/30 transition-colors"
          />
        </div>
      </div>

      {(() => {
        const filtered = search.trim()
          ? tasks.filter((t) =>
              t.documentName.toLowerCase().includes(search.trim().toLowerCase()),
            )
          : tasks;
        return filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--muted-foreground)]">
            <FileSearch className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>{search.trim() ? '未找到匹配的审查记录' : '暂无审查记录'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((task) => {
            const report = task.results as any;
            const totalIssues = report
              ? (report.generalResults
                  ? report.generalResults.reduce((sum: number, s: any) => sum + s.issues.length, 0)
                  : (report.criticalIssues?.length || 0) + (report.warnings?.length || 0))
                + (report.llmFreeIssues?.length || 0)
              : 0;
            const resolvedIssues = report
              ? (report.generalResults
                  ? report.generalResults.reduce(
                      (sum: number, s: any) =>
                        sum + s.issues.filter((i: any) => i.status === 'accepted' || i.status === 'rejected').length,
                      0,
                    )
                  : [...(report.criticalIssues || []), ...(report.warnings || [])].filter(
                      (i: any) => i.status === 'accepted' || i.status === 'rejected',
                    ).length)
                + (report.llmFreeIssues?.filter((i: any) => i.status === 'accepted' || i.status === 'rejected').length || 0)
              : 0;
            const progress = totalIssues > 0 ? Math.round((resolvedIssues / totalIssues) * 100) : 0;
            const allResolved = totalIssues > 0 && resolvedIssues >= totalIssues;

            return (
              <div
                key={task.id}
                onClick={() => task.status === 'completed' && setSelectedTask(task)}
                className={`w-full panel-surface rounded-[16px] p-4 text-left
                  hover:bg-white/[0.03] transition-colors
                  ${task.status === 'completed' ? 'cursor-pointer' : task.status === 'failed' ? 'cursor-default opacity-60' : 'cursor-not-allowed opacity-60'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium ${STATUS_COLORS[task.status]}`}>
                      {task.status === 'completed' ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : task.status === 'failed' ? (
                        <XCircle className="h-4 w-4" />
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                    </span>
                    <div>
                      <div className="text-sm font-medium text-[var(--foreground)] flex items-center gap-2">
                        {task.documentName}
                        {allResolved && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(92,181,150,0.12)] text-[rgba(92,181,150,1)] font-semibold">
                            已完成
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--muted-foreground)] flex items-center gap-2 mt-0.5">
                        <span>{task.reviewMode === 'strict' ? '严格审查' : '通用审查'}</span>
                        <Clock className="h-3 w-3" />
                        <span>{new Date(task.createdAt).toLocaleString('zh-CN')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {task.status === 'completed' && (
                      <>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-[rgba(92,181,150,1)]">{task.passedCount} 通过</span>
                          <span className="text-[rgba(230,129,102,1)]">{task.failedCount} 违规</span>
                          <span className="text-[rgba(234,188,110,1)]">{task.warningCount} 警告</span>
                        </div>
                        {totalIssues > 0 && (
                          <div className="flex items-center gap-2 ml-2">
                            <div className="w-16 h-1 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[rgba(92,181,150,1)]"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-[var(--muted-foreground)]">{resolvedIssues}/{totalIssues}</span>
                          </div>
                        )}
                      </>
                    )}
                    {task.status === 'running' || task.status === 'pending' ? (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
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
                        }}
                        className="p-1 rounded-md text-[var(--muted-foreground)]/40 hover:text-[rgba(230,129,102,1)] hover:bg-[rgba(230,129,102,0.12)] transition-colors"
                      >
                        <span className="relative inline-flex items-center justify-center">
                          <span className="absolute w-2.5 h-2.5 rounded-full bg-white" />
                          <CircleStop className="h-3.5 w-3.5 relative" />
                        </span>
                      </button>
                    ) : (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm('确定删除该审查记录？')) return;
                          try {
                            await deleteReviewTask(task.id);
                            setTasks((prev) => prev.filter((t) => t.id !== task.id));
                            toast.success('已删除');
                          } catch {
                            toast.error('删除失败');
                          }
                        }}
                        className="p-1 rounded-md text-[var(--muted-foreground)]/40 hover:text-[rgba(230,129,102,1)] hover:bg-[rgba(230,129,102,0.12)] transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        );
      })()}
    </div>
  );
}
