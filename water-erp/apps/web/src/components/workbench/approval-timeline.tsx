'use client';

import { CheckCircle2, CircleDot, XCircle } from 'lucide-react';

/**
 * C2 通用审批流转时间线（收窄路线图）：单条审批请求的提交→审批链可视化。
 * 输入事件数组（按时间升序传入），适用于任何有 留痕字段的审批实体
 * （SupplierChangeRecord / PasswordChangeRequest / ProfileChangeRequest …）。
 */

export interface ApprovalTimelineEvent {
  actor?: string | null;
  action: string;
  time?: string | null;
  note?: string | null;
  outcome?: 'pending' | 'approved' | 'rejected';
}

export function ApprovalTimeline({ events, compact }: { events: ApprovalTimelineEvent[]; compact?: boolean }) {
  if (events.length === 0) return null;
  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {events.map((e, i) => {
        const icon =
          e.outcome === 'approved' ? <CheckCircle2 size={13} className="text-emerald-600" /> :
          e.outcome === 'rejected' ? <XCircle size={13} className="text-[var(--danger)]" /> :
          <CircleDot size={13} className="text-[var(--muted-foreground)]" />;
        return (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-medium text-[var(--foreground)]">{e.action}</span>
                {e.actor && <span className="text-[var(--muted-foreground)]">{e.actor}</span>}
                {e.time && (
                  <span className="font-mono tabular-nums text-[10px] text-[var(--muted-foreground)]">
                    {new Date(e.time).toLocaleString('zh-CN', { hour12: false })}
                  </span>
                )}
              </div>
              {e.note && (
                <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]" title={e.note}>
                  {e.note}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
