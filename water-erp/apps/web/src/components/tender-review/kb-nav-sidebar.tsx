'use client';

import { useTenderReview } from './use-tender-review';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import type { ReviewTask } from '@/lib/types/tender-review';

/**
 * 右侧统计侧栏（单态）：今日统计 + 进行中 + 最近审查。
 * 2026-11-18 排版重做：统计改三行大数字（label 左/彩色圆点/数字右）取代三格横排，
 * 全栏间距放宽；知识库列表管理在中心视图（hero 右上「知识库」入口）。
 */
export default function KbNavSidebar({ width = 384 }: { width?: number }) {
  const { stats, recentReviews, setSelectedReportTask, setActiveTab } = useTenderReview();
  const todayLabel = new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

  // 记录按「今日 / 非今日」拆分（2026-11-19 用户裁定）：今日的挂在「今日审查」统计下方，
  // 非今日的归「最近审查」小节；时间显示随之分化——今日只显 HH:mm，非今日带月日
  const now = new Date();
  const isToday = (iso: string) => {
    const d = new Date(iso);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };
  const todayReviews = recentReviews.filter((t) => isToday(t.createdAt));
  const earlierReviews = recentReviews.filter((t) => !isToday(t.createdAt)).slice(0, 5);

  return (
    <div className="wb-panel rounded-[24px] tender-section-enter-delay-1 h-full flex flex-col overflow-hidden"
      style={{ width: `${width}px` }}>
      <div className="px-3.5 py-2.5 shrink-0" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.16)' }}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold tracking-[0.06em] text-[color:var(--foreground)]">今日审查</h3>
          <span className="text-[10px] tabular-nums text-[color:var(--muted-foreground)]">{todayLabel}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* 今日统计：三格横排（2026-11-18 还原） */}
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
          <div className="mt-4 flex items-center gap-2 rounded-[10px] bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-3.5 py-2.5">
            <AlertTriangle className="h-4 w-4 text-[color:var(--warning)]" />
            <span className="text-xs text-[color:var(--warning)]">{stats.warningCount} 个警告</span>
          </div>
        )}

        {/* 今日审查记录——挂在统计下方，只显 HH:mm（「今日」语义已由面板名表达） */}
        {todayReviews.length > 0 && (
          <div className="mt-4 space-y-2">
            {todayReviews.map((task) => (
              <ReviewRecordButton
                key={task.id}
                task={task}
                timeText={new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                onSelect={setSelectedReportTask}
                onOpenReports={() => setActiveTab('reports')}
              />
            ))}
          </div>
        )}

        {/* 非今日记录——「最近审查」小节（无历史记录时整节隐藏） */}
        {earlierReviews.length > 0 && (
          <div className="mt-5">
            <div
              className="pb-2 text-[11px] font-semibold tracking-[0.06em] text-[color:var(--foreground)] border-b"
              style={{ borderColor: 'oklch(0.6 0.04 258 / 0.16)' }}
            >
              最近审查
            </div>
            <div className="mt-2.5 space-y-2">
              {earlierReviews.map((task) => (
                <ReviewRecordButton
                  key={task.id}
                  task={task}
                  timeText={new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  onSelect={setSelectedReportTask}
                  onOpenReports={() => setActiveTab('reports')}
                />
              ))}
            </div>
          </div>
        )}

        {/* 全空兜底 */}
        {todayReviews.length === 0 && earlierReviews.length === 0 && (
          <div className="mt-4 text-xs text-[color:var(--muted-foreground)] text-center py-6">
            暂无审查记录
          </div>
        )}
      </div>
    </div>
  );
}

/** 审查记录行（今日/最近两节共用）：完成态可点进报告，失败/进行中态置灰 */
function ReviewRecordButton({ task, timeText, onSelect, onOpenReports }: {
  task: ReviewTask;
  timeText: string;
  onSelect: (task: ReviewTask) => void;
  onOpenReports: () => void;
}) {
  return (
    <button
      onClick={() => {
        if (task.status === 'completed') {
          onSelect(task);
          onOpenReports();
        }
      }}
      disabled={task.status !== 'completed'}
      className={`w-full flex items-center gap-2.5 p-2.5 rounded-[10px] transition-colors ${
        task.status === 'completed'
          ? 'cursor-pointer hover:bg-[color-mix(in_oklch,var(--muted)_25%,transparent)]'
          : 'cursor-not-allowed opacity-60'
      }`}
    >
      {task.status === 'completed' ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[color:var(--success)]" />
      ) : (
        <XCircle className="h-3.5 w-3.5 shrink-0 text-[color:var(--danger)]" />
      )}
      <div className="flex-1 min-w-0 text-left">
        <div className="text-xs text-[color:var(--foreground)] truncate">{task.documentName}</div>
        <div className="mt-0.5 text-[10px] text-[color:var(--muted-foreground)] flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {timeText}
        </div>
      </div>
    </button>
  );
}
