'use client';

import { History, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchMyActivities, AUDIT_ACTION_LABELS, type AuditLogItem } from '@/lib/api/audit-log';

function formatShortDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '未知';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '未知'; }
}

export function TabActivityLog() {
  const [activities, setActivities] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = await fetchMyActivities({ limit: expanded ? 50 : 5 });
        setActivities(result.items);
      } catch {
        setActivities([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [expanded]);

  const displayItems = expanded ? activities : activities.slice(0, 5);

  return (
    <div className="neu-card-static p-5">
      <h3 className="neu-section-heading">操作日志</h3>

      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" />正在加载...
        </div>
      ) : activities.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
          <History size={32} strokeWidth={1.2} />暂无操作记录
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            {displayItems.map((item) => (
              <div key={item.id} className="neu-content-block rounded-xl border border-white/50 bg-white/42 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">
                    {AUDIT_ACTION_LABELS[item.action] ?? item.action}
                  </span>
                  <span className="shrink-0 text-xs text-[color:var(--muted-foreground)]">
                    {formatShortDateTime(item.createdAt)}
                  </span>
                </div>
                {item.details && Object.keys(item.details).length > 0 && (
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    目标: {item.resourceType}
                    {item.ipAddress && <span className="ml-3">IP: {item.ipAddress}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {activities.length > 5 && !expanded && (
            <button type="button" onClick={() => setExpanded(true)}
              className="neu-btn-soft mt-4 w-full justify-center text-sm">
              查看全部 ({activities.length} 条)
            </button>
          )}
          {expanded && activities.length > 5 && (
            <button type="button" onClick={() => setExpanded(false)}
              className="neu-btn-soft mt-4 w-full justify-center text-sm">
              收起
            </button>
          )}
        </>
      )}
    </div>
  );
}
