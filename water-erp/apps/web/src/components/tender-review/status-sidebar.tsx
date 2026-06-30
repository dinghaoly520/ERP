'use client';

import { useTenderReview } from './tender-review-context';
import {
  BarChart3,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  FileText,
  Loader2,
} from 'lucide-react';
import { STATUS_COLORS } from '@/lib/types/tender-review';

export default function StatusSidebar() {
  const { stats, recentReviews, runningTasks, loading } = useTenderReview();

  return (
    <div className="panel-surface rounded-[20px] h-full flex flex-col overflow-hidden">
      {/* Stats section */}
      <div className="p-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-[var(--foreground)]">今日统计</h3>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatCard
            icon={<FileText className="h-3.5 w-3.5" />}
            label="今日审查"
            value={stats.totalReviews}
            color="text-[var(--accent)]"
          />
          <StatCard
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            label="通过"
            value={stats.passedCount}
            color="text-[rgba(92,181,150,1)]"
          />
          <StatCard
            icon={<XCircle className="h-3.5 w-3.5" />}
            label="违规"
            value={stats.failedCount}
            color="text-[rgba(230,129,102,1)]"
          />
          <StatCard
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="警告"
            value={stats.warningCount}
            color="text-[rgba(234,188,110,1)]"
          />
        </div>
      </div>

      {/* Running tasks */}
      {runningTasks.length > 0 && (
        <div className="p-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
            <h4 className="text-xs font-medium text-[var(--foreground)]">进行中</h4>
          </div>
          <div className="space-y-1.5">
            {runningTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 p-2 rounded-[10px] bg-[var(--accent)]/5">
                <Loader2 className="h-3 w-3 animate-spin text-[var(--accent)]" />
                <span className="text-xs text-[var(--foreground)] truncate flex-1">
                  {task.documentName}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent reviews */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <h4 className="text-xs font-medium text-[var(--foreground)]">最近审查</h4>
        </div>

        {loading.tasks ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
          </div>
        ) : recentReviews.length === 0 ? (
          <div className="text-center py-4 text-[var(--muted-foreground)] text-xs">
            暂无审查记录
          </div>
        ) : (
          <div className="space-y-1.5">
            {recentReviews.map((task) => (
              <div key={task.id} className="p-2 rounded-[10px] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[var(--foreground)] truncate flex-1">
                    {task.documentName}
                  </span>
                  <span className={`text-[10px] ${STATUS_COLORS[task.status]}`}>
                    {task.status === 'completed' ? '✓' : task.status === 'failed' ? '✗' : '○'}
                  </span>
                </div>
                {task.status === 'completed' && (
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--muted-foreground)]">
                    <span className="text-[rgba(92,181,150,1)]">{task.passedCount}</span>
                    <span>/</span>
                    <span className="text-[rgba(230,129,102,1)]">{task.failedCount}</span>
                    <span>/</span>
                    <span className="text-[rgba(234,188,110,1)]">{task.warningCount}</span>
                  </div>
                )}
                <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                  {new Date(task.createdAt).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  return (
    <div className="p-2 rounded-[10px] bg-white/[0.02]">
      <div className={`flex items-center gap-1 ${color}`}>
        {icon}
        <span className="text-lg font-semibold">{value}</span>
      </div>
      <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{label}</div>
    </div>
  );
}
