"use client";

import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { PMI_STAGE_LABEL } from '@water-erp/shared';

/** 恢复目标态——与后端 restoreFromRecycleBin 三向按戳推断同口径（spec 2026-11-12 §4.3） */
export function restoreTargetLabel(item: Pick<ProjectManagementItem, 'terminatedAt' | 'archivedAt'>) {
  if (item.terminatedAt) return '已终止';
  if (item.archivedAt) return '已完成';
  return '进行中';
}

/** 「已移除」节简化卡（形态承接自退役回收站抽屉，spec 2026-11-12 §3.2-2）：
 *  不可点开详情；恢复按钮文案带恢复目标态；操作仅创建人可见。 */
export function RecycledProjectCard({
  item,
  submitting,
  canModify,
  onRestore,
  onDelete,
}: {
  item: ProjectManagementItem;
  submitting: boolean;
  canModify: boolean;
  onRestore: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}) {
  return (
    <article className="neu-card-static !rounded-[20px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[1.02rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
            {item.title}
          </div>
          <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            {item.requesterDepartment} · {item.requesterName}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-3 py-1 text-[11px] font-semibold text-[color:var(--warning)]">
          已移除
        </span>
      </div>

      <div className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">
            采购方式
          </div>
          <div className="mt-1 text-sm text-[color:var(--foreground)]">
            {item.procurementMethod || '待补充'}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">
            当前阶段
          </div>
          <div className="mt-1 text-sm text-[color:var(--foreground)]">
            {(item.currentRound ?? 1) > 1 ? `第 ${item.currentRound} 轮 · ` : ''}
            {PMI_STAGE_LABEL[item.currentStage] ?? item.currentStage}
          </div>
        </div>
        <div className="sm:col-span-2">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">
            移除时间
          </div>
          <div className="mt-1 text-sm tabular-nums text-[color:var(--foreground)]">
            {item.recycledAt
              ? new Date(item.recycledAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
              : '未记录（存量数据，恢复后重新移除可记录）'}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {canModify ? (
          <>
            <button
              type="button"
              onClick={() => onRestore(item.id)}
              disabled={submitting}
              className="neu-btn-soft"
            >
              <RotateCcw size={16} />
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {submitting ? '处理中...' : `恢复 · 回到${restoreTargetLabel(item)}`}
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              disabled={submitting}
              className="neu-btn-soft is-danger"
            >
              <Trash2 size={16} />
              {submitting ? '处理中...' : '彻底删除'}
            </button>
          </>
        ) : (
          <span className="inline-flex items-center text-xs text-[color:var(--muted-foreground)]">
            仅创建者可操作
          </span>
        )}
      </div>
    </article>
  );
}
