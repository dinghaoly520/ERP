'use client';

import { History, Loader2, LogIn, LogOut, KeyRound, Settings, FileEdit, Eye, FileText, Bell } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchMyActivities, AUDIT_ACTION_LABELS, type AuditLogItem } from '@/lib/api/audit-log';

function formatShortDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '未知';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '未知'; }
}

/** Action → icon + accent color mapping (matches workbench status color pattern) */
const ACTION_META: Record<string, { icon: LucideIcon; color: string }> = {
  LOGIN:                  { icon: LogIn,      color: '#5cb596' },
  LOGOUT:                 { icon: LogOut,     color: '#8c8c8c' },
  PASSWORD_CHANGE_REQUEST: { icon: KeyRound,   color: '#e68166' },
  PASSWORD_CHANGE_APPROVED:{ icon: KeyRound,   color: '#5cb596' },
  PASSWORD_CHANGE_REJECTED:{ icon: KeyRound,   color: '#e68166' },
  PASSWORD_RESET_REQUEST: { icon: KeyRound,    color: '#e68166' },
  PASSWORD_RESET_APPROVED: { icon: KeyRound,   color: '#5cb596' },
  PASSWORD_RESET_REJECTED: { icon: KeyRound,   color: '#e68166' },
  SETTINGS_UPDATE:         { icon: Settings,  color: '#608bef' },
  PROFILE_UPDATE:          { icon: FileEdit,   color: '#608bef' },
};

const DEFAULT_META = { icon: Eye, color: '#8c8c8c' };

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
    <div className="wb-panel p-6">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
        <History size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
        操作日志
      </h3>

      {loading ? (
        <div className="flex min-h-[280px] items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" />正在加载操作记录...
        </div>
      ) : activities.length === 0 ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 text-sm text-[color:var(--muted-foreground)]">
          <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
            <History size={24} strokeWidth={1.4} className="text-[color:var(--muted-foreground)]" />
          </div>
          <div className="text-center">
            <div className="font-medium text-[color:var(--foreground)]">暂无操作记录</div>
            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">你的操作将会显示在这里</div>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-0">
            {displayItems.map((item) => {
              const meta = ACTION_META[item.action] ?? DEFAULT_META;
              const ActionIcon = meta.icon;

              return (
                <button
                  key={item.id}
                  type="button"
                  className="wb-list-item"
                  style={{ '--item-accent': meta.color } as React.CSSProperties}
                >
                  <div className="flex items-center gap-3 pr-3">
                    {/* Action icon in colored well */}
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                      style={{
                        backgroundColor: `${meta.color}18`,
                        color: meta.color,
                      }}
                    >
                      <ActionIcon size={14} strokeWidth={1.7} />
                    </div>

                    <div className="min-w-0 flex-1 text-left">
                      <div className="text-[13px] font-semibold text-[color:var(--foreground)]">
                        {AUDIT_ACTION_LABELS[item.action] ?? item.action}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[color:var(--muted-foreground)]">
                        <span>{item.resourceType}</span>
                        {item.ipAddress && (
                          <>
                            <span className="text-[color:var(--muted-foreground)]/40">·</span>
                            <span className="font-mono text-[10px]">{item.ipAddress}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
                      {formatShortDateTime(item.createdAt)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Expand/collapse toggle */}
          <div className="mt-3 flex justify-center">
            {activities.length > 5 && !expanded && (
              <button type="button" onClick={() => setExpanded(true)}
                className="text-[13px] font-medium text-[color:var(--accent)] transition-colors hover:text-[color:var(--accent-strong)]">
                查看全部 {activities.length} 条记录
              </button>
            )}
            {expanded && activities.length > 5 && (
              <button type="button" onClick={() => setExpanded(false)}
                className="text-[13px] font-medium text-[color:var(--muted-foreground)] transition-colors hover:text-[color:var(--foreground)]">
                收起
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
