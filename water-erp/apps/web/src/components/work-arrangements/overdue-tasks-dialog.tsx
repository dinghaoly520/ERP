'use client';

import { useState, useEffect } from 'react';
import {
  Clock3,
  CheckCheck,
  XCircle,
  ArrowUpRight,
  AlertTriangle,
} from 'lucide-react';
import { Modal } from '@/components/workbench';
import {
  WORK_ARRANGEMENT_STATUS_LABELS,
  WORK_ARRANGEMENT_URGENCY_LABELS,
  type WorkArrangementItem,
  type WorkArrangementStatus,
} from '@/lib/types/work-arrangements';

// ── 样式映射 ──

const urgencyStyles: Record<string, { bg: string; text: string; border: string }> = {
  CRITICAL: {
    bg: 'bg-[rgba(239,68,68,0.12)]',
    text: 'text-[rgba(239,68,68,1)]',
    border: 'border-[rgba(239,68,68,0.25)]',
  },
  HIGH: {
    bg: 'bg-[rgba(249,115,22,0.12)]',
    text: 'text-[rgba(249,115,22,1)]',
    border: 'border-[rgba(249,115,22,0.25)]',
  },
  MEDIUM: {
    bg: 'bg-[rgba(234,179,8,0.12)]',
    text: 'text-[rgba(202,138,4,1)]',
    border: 'border-[rgba(234,179,8,0.25)]',
  },
  LOW: {
    bg: 'bg-[rgba(140,140,140,0.1)]',
    text: 'text-[rgba(140,140,140,0.9)]',
    border: 'border-[rgba(140,140,140,0.2)]',
  },
};

const statusStyles: Record<WorkArrangementStatus, { bg: string; text: string; border: string }> = {
  TODO: {
    bg: 'bg-[rgba(140,140,140,0.12)]',
    text: 'text-[rgba(140,140,140,1)]',
    border: 'border-[rgba(140,140,140,0.25)]',
  },
  IN_PROGRESS: {
    bg: 'bg-[rgba(96,139,239,0.12)]',
    text: 'text-[rgba(96,139,239,1)]',
    border: 'border-[rgba(96,139,239,0.25)]',
  },
  BLOCKED: {
    bg: 'bg-[rgba(230,129,102,0.12)]',
    text: 'text-[rgba(230,129,102,1)]',
    border: 'border-[rgba(230,129,102,0.25)]',
  },
  COMPLETED: {
    bg: 'bg-[rgba(92,181,150,0.12)]',
    text: 'text-[rgba(92,181,150,1)]',
    border: 'border-[rgba(92,181,150,0.25)]',
  },
  CANCELLED: {
    bg: 'bg-[rgba(140,140,140,0.12)]',
    text: 'text-[rgba(140,140,140,0.8)]',
    border: 'border-[rgba(140,140,140,0.25)]',
  },
};

// ── 辅助函数 ──

function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

// ── 组件 ──

interface OverdueTasksDialogProps {
  open: boolean;
  overdueTasks: WorkArrangementItem[];
  onClose: () => void;
  onStatusUpdate: (id: string, status: WorkArrangementStatus) => Promise<void>;
  onPostpone: (id: string) => Promise<void>;
  onViewDetails: (id: string) => void;
}

export function OverdueTasksDialog({
  open,
  overdueTasks,
  onClose,
  onStatusUpdate,
  onPostpone,
  onViewDetails,
}: OverdueTasksDialogProps) {
  const [actionLoading, setActionLoading] = useState<
    Record<string, 'complete' | 'cancel' | 'postpone' | null>
  >({});

  // 全部逾期任务已解决 → 自动关闭
  useEffect(() => {
    if (overdueTasks.length === 0) {
      onClose();
    }
  }, [overdueTasks.length, onClose]);

  if (!open || overdueTasks.length === 0) return null;

  const handleComplete = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: 'complete' }));
    try {
      await onStatusUpdate(id, 'COMPLETED');
    } catch (error: unknown) {
      const { toast } = await import('sonner');
      toast.error('标记完成失败：' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: null }));
    }
  };

  const handleCancel = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: 'cancel' }));
    try {
      await onStatusUpdate(id, 'CANCELLED');
    } catch (error: unknown) {
      const { toast } = await import('sonner');
      toast.error('取消任务失败：' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: null }));
    }
  };

  const handlePostpone = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: 'postpone' }));
    try {
      await onPostpone(id);
    } catch (error: unknown) {
      const { toast } = await import('sonner');
      toast.error('推迟任务失败：' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: null }));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <AlertTriangle size={18} className="text-[color:var(--warning)]" />
          逾期任务提醒
        </span>
      }
      description={`以下 ${overdueTasks.length} 项任务已超过截止时间，请及时处理`}
      size="lg"
    >
      <div className="-mx-2 max-h-[50vh] overflow-y-auto divide-y divide-[#eef3f8]">
        {overdueTasks.map((item) => {
          const urgency = urgencyStyles[item.urgency] ?? urgencyStyles.MEDIUM;
          const status = statusStyles[item.status];
          const loading = actionLoading[item.id];

          return (
            <div
              key={item.id}
              className="flex flex-col gap-2.5 px-4 py-3.5 transition hover:bg-[var(--accent-soft)]/6"
            >
              {/* ── Row 1: 状态圆点 + 标题 ── */}
              <span className="flex items-center gap-2.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${status.bg}`}
                  style={{
                    boxShadow: `0 0 0 1px ${status.text.match(/rgba?\([^)]+\)/)?.[0] ?? 'currentColor'}`,
                  }}
                />
                <span className="min-w-0 flex-1 text-[13px] font-bold text-[#18243a] truncate">
                  {item.title}
                </span>
              </span>

              {/* ── Row 2: 截止日期 + 紧急程度 + 状态 ── */}
              <span className="ml-4.5 flex flex-wrap items-center gap-2">
                {/* 截止日期 */}
                <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(239,68,68,0.08)] px-2 py-0.5 text-[11px] font-medium text-[rgba(239,68,68,0.9)]">
                  <Clock3 size={10} />
                  {formatDateLabel(item.dueAt!)}
                </span>

                {/* 紧急程度 */}
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${urgency.bg} ${urgency.text} ${urgency.border}`}
                >
                  {WORK_ARRANGEMENT_URGENCY_LABELS[item.urgency]}
                </span>

                {/* 状态 */}
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${status.bg} ${status.text} ${status.border}`}
                >
                  {WORK_ARRANGEMENT_STATUS_LABELS[item.status]}
                </span>
              </span>

              {/* ── Row 3: 操作按钮 ── */}
              <span className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!!loading}
                  className="neu-btn-xs is-success"
                  onClick={() => handleComplete(item.id)}
                >
                  <CheckCheck size={11} />
                  <span>{loading === 'complete' ? '处理中...' : '标记完成'}</span>
                </button>

                <button
                  type="button"
                  disabled={!!loading}
                  className="neu-btn-xs is-danger"
                  onClick={() => handleCancel(item.id)}
                >
                  <XCircle size={11} />
                  <span>{loading === 'cancel' ? '处理中...' : '取消任务'}</span>
                </button>

                <button
                  type="button"
                  disabled={!!loading}
                  className="neu-btn-xs is-warning"
                  onClick={() => handlePostpone(item.id)}
                >
                  <Clock3 size={11} />
                  <span>{loading === 'postpone' ? '处理中...' : '推迟一天'}</span>
                </button>

                <button
                  type="button"
                  disabled={!!loading}
                  className="neu-btn-xs"
                  onClick={() => onViewDetails(item.id)}
                >
                  <ArrowUpRight size={11} />
                  <span>查看详情</span>
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
