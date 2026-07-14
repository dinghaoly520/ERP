'use client';

import { History, Loader2, LogIn, LogOut, KeyRound, Settings, FileEdit, Eye, Activity } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchMyActivities, AUDIT_ACTION_LABELS, type AuditLogItem } from '@/lib/api/audit-log';

function formatShortDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '未知';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '未知'; }
}

function formatFullDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '未知';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return '未知'; }
}

/** Action → icon + accent color */
const ACTION_META: Record<string, { icon: LucideIcon; color: string }> = {
  LOGIN:                   { icon: LogIn,      color: '#5cb596' },
  LOGOUT:                  { icon: LogOut,     color: '#8c8c8c' },
  PASSWORD_CHANGE_REQUEST:  { icon: KeyRound,   color: '#e68166' },
  PASSWORD_CHANGE_APPROVED: { icon: KeyRound,   color: '#5cb596' },
  PASSWORD_CHANGE_REJECTED: { icon: KeyRound,   color: '#e68166' },
  PASSWORD_RESET_REQUEST:   { icon: KeyRound,   color: '#e68166' },
  PASSWORD_RESET_APPROVED:  { icon: KeyRound,   color: '#5cb596' },
  PASSWORD_RESET_REJECTED:  { icon: KeyRound,   color: '#e68166' },
  SETTINGS_UPDATE:          { icon: Settings,   color: '#608bef' },
  PROFILE_UPDATE:           { icon: FileEdit,   color: '#608bef' },
};

const DEFAULT_META = { icon: Eye, color: '#8c8c8c' };

export function TabActivityLog() {
  const [activities, setActivities] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = await fetchMyActivities({ limit: expanded ? 200 : 10 });
        setActivities(result.items);
        setTotal(result.total);
      } catch {
        setActivities([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [expanded]);

  const displayItems = expanded ? activities : activities.slice(0, 10);

  // Statistics
  const stats = useMemo(() => {
    const loginCount = activities.filter((a) => a.action === 'LOGIN').length;
    const recentLogins = activities
      .filter((a) => a.action === 'LOGIN')
      .slice(0, 1);
    return { loginCount, recentLogins, totalActions: total };
  }, [activities, total]);

  return (
    <div className="flex flex-col gap-5 overflow-y-auto">
      {/* Statistics bar — matches workbench metric grid */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="kpi-card px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
            登录次数
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums tracking-[-0.03em] text-[color:var(--foreground)]">
            {stats.loginCount}
          </div>
          <div className="mt-0.5 text-[11px] text-[color:var(--muted-foreground)]">当前会话可见</div>
        </div>

        <div className="kpi-card px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
            最近登录
          </div>
          <div className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
            {stats.recentLogins.length > 0
              ? formatShortDateTime(stats.recentLogins[0].createdAt)
              : '暂无记录'
            }
          </div>
          {stats.recentLogins.length > 0 && stats.recentLogins[0].ipAddress && (
            <div className="mt-0.5 text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
              IP: {stats.recentLogins[0].ipAddress}
            </div>
          )}
        </div>

        <div className="kpi-card px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
            操作总数
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums tracking-[-0.03em] text-[color:var(--foreground)]">
            {stats.totalActions}
          </div>
          <div className="mt-0.5 text-[11px] text-[color:var(--muted-foreground)]">系统内全部操作</div>
        </div>
      </div>

      {/* Activity timeline */}
      <div className="wb-panel flex flex-1 flex-col p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Activity size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          完整操作历程
        </h3>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
            <Loader2 size={18} className="animate-spin" />正在加载操作记录...
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-[color:var(--muted-foreground)]">
            <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
              <History size={24} strokeWidth={1.4} className="text-[color:var(--muted-foreground)]" />
            </div>
            <div className="text-center">
              <div className="font-medium text-[color:var(--foreground)]">暂无操作记录</div>
              <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">登录后即开始记录你在系统中的所有操作</div>
            </div>
          </div>
        ) : (
          <>
            {/* Group by date */}
            <div className="mt-5">
              {groupByDate(displayItems).map(([dateLabel, items]) => (
                <div key={dateLabel} className="mb-5">
                  <div className="mb-2 flex items-center gap-2.5">
                    <div className="h-px flex-1"
                      style={{ background: 'linear-gradient(90deg, oklch(0.6 0.04 258 / 0.2), transparent)' }}
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
                      {dateLabel}
                    </span>
                  </div>
                  <div className="space-y-0">
                    {items.map((item) => {
                      const meta = ACTION_META[item.action] ?? DEFAULT_META;
                      const ActionIcon = meta.icon;
                      const isLoginEvent = item.action === 'LOGIN';

                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="wb-list-item"
                          style={{ '--item-accent': meta.color } as React.CSSProperties}
                        >
                          <div className="flex items-center gap-3 pr-3">
                            <div
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                              style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                            >
                              <ActionIcon size={14} strokeWidth={1.7} />
                            </div>

                            <div className="min-w-0 flex-1 text-left">
                              <div className="text-[13px] font-semibold text-[color:var(--foreground)]">
                                {AUDIT_ACTION_LABELS[item.action] ?? item.action}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[color:var(--muted-foreground)]">
                                {item.ipAddress && (
                                  <>
                                    <span className="font-mono text-[10px]">{item.ipAddress}</span>
                                    <span className="text-[color:var(--muted-foreground)]/40">·</span>
                                  </>
                                )}
                                <span>{formatFullDateTime(item.createdAt)}</span>
                                {isLoginEvent && <span className="font-medium text-[color:var(--success)]">✓ 成功</span>}
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
                </div>
              ))}
            </div>

            {/* Expand/collapse */}
            {total > 10 && (
              <div className="flex justify-center border-t border-[rgba(96,139,239,0.1)] pt-4">
                {!expanded ? (
                  <button type="button" onClick={() => setExpanded(true)}
                    className="text-[13px] font-medium text-[color:var(--accent)] transition-colors hover:text-[color:var(--accent-strong)]">
                    查看全部 {total} 条记录
                  </button>
                ) : (
                  <button type="button" onClick={() => setExpanded(false)}
                    className="text-[13px] font-medium text-[color:var(--muted-foreground)] transition-colors hover:text-[color:var(--foreground)]">
                    收起
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Group audit items by date (今天 / 昨天 / 具体日期) */
function groupByDate(items: AuditLogItem[]): [string, AuditLogItem[]][] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups = new Map<string, AuditLogItem[]>();

  for (const item of items) {
    const date = new Date(item.createdAt);
    const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    let label: string;
    if (itemDay.getTime() === today.getTime()) {
      label = '今天';
    } else if (itemDay.getTime() === yesterday.getTime()) {
      label = '昨天';
    } else {
      label = date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
    }

    const existing = groups.get(label);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(label, [item]);
    }
  }

  return Array.from(groups.entries());
}
