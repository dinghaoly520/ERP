'use client';

import { useTenderReview } from './use-tender-review';
import {
  Database,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
} from 'lucide-react';

/**
 * 右侧统计侧栏（2026-11-18 收缩为单态）：今日统计 + 进行中 + 最近审查。
 * 知识库列表管理已升格为中心视图（kb-manager-panel，hero 右上「知识库」按钮入口），
 * 原二态切换与底部「知识库」按钮随之移除。
 */
export default function KbNavSidebar({ width = 384 }: { width?: number }) {
  const { stats, recentReviews, runningTasks, setSelectedReportTask, setActiveTab } = useTenderReview();
  const todayLabel = new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

  return (
    <div className="wb-panel rounded-[24px] tender-section-enter-delay-1 h-full flex flex-col overflow-hidden"
      style={{ width: `${width}px` }}>
      <div className="px-3 py-1.5 shrink-0" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.16)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="rounded-[4px] bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-1.5 py-0.5 text-[9px] font-medium text-[color:var(--accent)]">今日</span>
            <h3 className="text-xs font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">审查统计</h3>
          </div>
          <span className="text-[10px] tabular-nums text-[color:var(--muted-foreground)]">{todayLabel}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="neu-tile is-accent p-2.5 text-center">
            <div className="text-[1.1rem] font-black tabular-nums tracking-[-0.04em] leading-none text-[color:var(--accent)]">{stats.totalReviews}</div>
            <div className="text-[10px] tracking-[0.08em] text-[color:var(--foreground)] mt-1">审查数</div>
          </div>
          <div className="neu-tile is-success p-2.5 text-center">
            <div className="text-[1.1rem] font-black tabular-nums tracking-[-0.04em] leading-none text-[color:var(--success)]">{stats.passedCount}</div>
            <div className="text-[10px] tracking-[0.08em] text-[color:var(--success)]/80 mt-1">通过</div>
          </div>
          <div className="neu-tile is-danger p-2.5 text-center">
            <div className="text-[1.1rem] font-black tabular-nums tracking-[-0.04em] leading-none text-[color:var(--danger)]">{stats.failedCount}</div>
            <div className="text-[10px] tracking-[0.08em] text-[color:var(--danger)]/80 mt-1">违规</div>
          </div>
        </div>

        {stats.warningCount > 0 && (
          <div className="flex items-center gap-2 p-2 rounded-[10px] bg-[color-mix(in_oklch,var(--warning)_10%,transparent)]">
            <AlertTriangle className="h-4 w-4 text-[color:var(--warning)]" />
            <span className="text-xs text-[color:var(--warning)]">{stats.warningCount} 个警告</span>
          </div>
        )}

        {runningTasks.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--foreground)]">进行中</div>
            {runningTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 p-2 rounded-[10px] bg-[color-mix(in_oklch,var(--accent-soft)_30%,transparent)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--accent)]" />
                <span className="text-xs text-[color:var(--foreground)] truncate">{task.documentName}</span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--foreground)]">最近审查</div>
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

        <div className="pt-1 text-center text-[10px] text-[color:var(--muted-foreground)]/70 flex items-center justify-center gap-1">
          <Database className="h-3 w-3" />
          知识库管理已移至页面右上「知识库」
        </div>
      </div>
    </div>
  );
}
