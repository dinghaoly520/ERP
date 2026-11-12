"use client";

import { FileX2 } from 'lucide-react';
import type { ProjectDeletionRecord } from '@/lib/types/project-management';

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '—';
}

/** 移除记录只读行（spec 2026-11-12 §9）：无任何操作按钮；空列表不渲染。
 *  弹层内使用时传 showHeader={false}（标题由弹层承担）。 */
export function DeletionRecordList({ records, showHeader = true }: { records: ProjectDeletionRecord[]; showHeader?: boolean }) {
  if (records.length === 0) return null;

  return (
    <section className="space-y-3">
      {showHeader ? (
        <div className="flex items-center gap-2">
          <FileX2 size={14} className="text-[color:var(--muted-foreground)]" />
          <h3 className="text-[13px] font-bold tracking-[0.02em] text-[color:var(--foreground)]">
            移除记录
          </h3>
          <span className="neu-segment-count">{records.length}</span>
          <span className="text-xs text-[color:var(--muted-foreground)]">数据已清，记录永存</span>
        </div>
      ) : null}
      <div className="wb-panel divide-y divide-[oklch(0.6_0.04_258/0.12)] overflow-hidden">
        {records.map((r) => (
          <div key={r.id} className="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">
                {r.title}
                {r.projectCode ? (
                  <span className="ml-2 font-mono text-[10px] font-bold text-[color:var(--accent-strong)]">{r.projectCode}</span>
                ) : null}
              </div>
              <div className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">
                {r.requesterDepartment} · {r.requesterName} · {r.procurementMethod}
                {r.terminatedAt ? ` · 曾于 ${fmtDate(r.terminatedAt)} 终止` : ''}
                {r.terminatedRoundNo ? `（台账轮次 #${r.terminatedRoundNo} 已随删）` : ''}
              </div>
            </div>
            <div className="text-xs tabular-nums text-[color:var(--muted-foreground)]">
              {r.recycledAt ? <div>移入回收：{fmtDate(r.recycledAt)}</div> : null}
              <div>移除时间：{fmtDate(r.deletedAt)}</div>
            </div>
            <div className="text-xs text-[color:var(--muted-foreground)] sm:text-right">
              操作人：{r.deletedByName}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
