"use client";

import { FileX2 } from 'lucide-react';
import type { ProjectDeletionRecord } from '@/lib/types/project-management';

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '—';
}

/** 终止时间（2026-11-12 用户口径：标签改名、行恒显）——新流程取 terminatedAt；
 *  存量迁移行（未终止即移除的旧数据）回退取 recycledAt，防整行消失。 */
function terminateTimeOf(r: ProjectDeletionRecord) {
  return r.terminatedAt ?? r.recycledAt ?? null;
}

/** 终止时简报（2026-11-12）：AI 项目简报优先（按需生成，多数项目无）；无则兜底
 *  「终止时所在阶段 + 终止原因」——新流程记录两项必有，保证每条记录都有简报可显。 */
function briefOf(r: ProjectDeletionRecord) {
  if (r.analysisSummary) return r.analysisSummary;
  if (r.terminatedStage || r.terminationReason) {
    return `终止时处于「${r.terminatedStage ?? '未记录'}」阶段；终止原因：${r.terminationReason ?? '未记录'}`;
  }
  return null;
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
              <div className="text-[13px] font-semibold leading-snug text-[color:var(--foreground)]">
                {r.title}
                {r.projectCode ? (
                  <span className="ml-2 font-mono text-[10px] font-bold text-[color:var(--accent-strong)]">{r.projectCode}</span>
                ) : null}
              </div>
              <div className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">
                {r.requesterDepartment} · {r.requesterName} · {r.procurementMethod}
              </div>
              {/* 终止时简报（2026-11-12 用户裁定）：AI 简报优先、无则终止阶段+原因兜底；超两行截断 */}
              {(() => {
                const brief = briefOf(r);
                return brief ? (
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-[color:var(--muted-foreground)]" title={brief}>
                    <span className="font-semibold text-[color:var(--foreground)]">终止时简报：</span>
                    {brief}
                  </div>
                ) : null;
              })()}
            </div>
            <div className="text-xs tabular-nums text-[color:var(--muted-foreground)]">
              {terminateTimeOf(r) ? <div>终止时间：{fmtDate(terminateTimeOf(r))}</div> : null}
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
