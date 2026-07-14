'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Loader2,
  ClipboardCheck,
  FolderKanban,
  CheckCircle2,
  CalendarDays,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';
import { fetchMyActivities, AUDIT_ACTION_LABELS, type AuditLogItem } from '@/lib/api/audit-log';
import { fetchWorkArrangements } from '@/lib/api/work-arrangements';
import { fetchProjectManagementList } from '@/lib/api/project-management';
import { useNotifications } from '@/lib/hooks/use-notifications';
import type { WorkArrangementItem } from '@/lib/types/work-arrangements';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/** Derive monthly approval count from work arrangements (COMPLETED in current month) */
function countMonthCompleted(items: WorkArrangementItem[]): number {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return items.filter(
    (i) => i.status === 'COMPLETED' && i.completedAt && new Date(i.completedAt) >= monthStart,
  ).length;
}

/** Count this week's tasks (created this week) */
function countWeekCreated(items: WorkArrangementItem[]): number {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  weekStart.setHours(0, 0, 0, 0);
  return items.filter((i) => new Date(i.createdAt) >= weekStart).length;
}

/** Completion rate: completed / total non-cancelled in current month */
function completionRate(items: WorkArrangementItem[]): number {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthItems = items.filter(
    (i) => new Date(i.createdAt) >= monthStart && i.status !== 'CANCELLED',
  );
  if (monthItems.length === 0) return 0;
  const completed = monthItems.filter((i) => i.status === 'COMPLETED').length;
  return Math.round((completed / monthItems.length) * 100);
}

/** Daily trend — count COMPLETED tasks by day for the last 7 days */
function dailyTrend(items: WorkArrangementItem[]): { day: string; count: number; max: number }[] {
  const days: { day: string; count: number }[] = [];
  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setDate(end.getDate() + 1);
    const count = items.filter(
      (item) =>
        item.status === 'COMPLETED' &&
        item.completedAt &&
        new Date(item.completedAt) >= d &&
        new Date(item.completedAt) < end,
    ).length;
    days.push({ day: dayLabels[d.getDay()], count });
  }
  const max = Math.max(...days.map((d) => d.count), 1);
  return days.map((d) => ({ ...d, max }));
}

export function TabWorkOverview() {
  const [activities, setActivities] = useState<AuditLogItem[] | null>(null);
  const [items, setItems] = useState<WorkArrangementItem[] | null>(null);
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { derivedTodo } = useNotifications();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [actRes, taskRes, projRes] = await Promise.all([
          fetchMyActivities({ limit: 5 }),
          fetchWorkArrangements({ scope: 'ALL', includeCompleted: true }),
          fetchProjectManagementList('ACTIVE'),
        ]);
        if (!cancelled) {
          setActivities(actRes.items);
          setItems(taskRes);
          setProjectCount(projRes.length);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    if (!items) return null;
    const monthlyCompleted = countMonthCompleted(items);
    const weekCreated = countWeekCreated(items);
    const rate = completionRate(items);
    const notificationTotal =
      derivedTodo.supplierPending + derivedTodo.priceReview + derivedTodo.expiringQualifications;
    const approvalTotal = monthlyCompleted + notificationTotal; // completed + pending = total handled
    return { monthlyCompleted, notificationTotal, approvalTotal, weekCreated, rate };
  }, [items, derivedTodo]);

  const trend = useMemo(() => (items ? dailyTrend(items) : []), [items]);

  if (loading) {
    return (
      <div className="wb-panel flex min-h-[320px] flex-1 items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
        <Loader2 size={18} className="animate-spin" />正在加载工作数据...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {/* ═══ KPI 卡片行 ═══ */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {/* 本月审批处理 */}
        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eef2ff]">
              <ClipboardCheck size={15} className="text-[#6366f1]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
              本月审核
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black tabular-nums text-[#18243a]">
              {stats?.approvalTotal ?? '-'}
            </span>
            <span className="text-[11px] text-[color:var(--muted-foreground)]">项</span>
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">
            {stats ? `已完成${stats.monthlyCompleted} · 待处理${stats.notificationTotal}` : '-'}
          </span>
        </div>

        {/* 参与项目 */}
        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0f9ff]">
              <FolderKanban size={15} className="text-[#0ea5e9]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
              活跃项目
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black tabular-nums text-[#18243a]">
              {projectCount ?? '-'}
            </span>
            <span className="text-[11px] text-[color:var(--muted-foreground)]">个</span>
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">
            当前进行中的采购项目
          </span>
        </div>

        {/* 完成率 */}
        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0fdf4]">
              <CheckCircle2 size={15} className="text-[#11a874]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
              任务完成率
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black tabular-nums text-[#18243a]">
              {stats ? `${stats.rate}%` : '-'}
            </span>
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">
            本月创建任务的完成比例
          </span>
        </div>

        {/* 本周工作量 */}
        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fffbeb]">
              <CalendarDays size={15} className="text-[#f59e0b]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
              本周新建
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black tabular-nums text-[#18243a]">
              {stats?.weekCreated ?? '-'}
            </span>
            <span className="text-[11px] text-[color:var(--muted-foreground)]">项</span>
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">
            本周新增的工作任务
          </span>
        </div>
      </div>

      {/* ═══ 近期趋势 + 最近操作 ═══ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 趋势图 */}
        <div className="neu-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
              <TrendingUp size={13} />
              近期完成任务
            </div>
            <span className="text-[10px] text-[color:var(--muted-foreground)]">近7日</span>
          </div>
          <div className="mt-4 flex items-end justify-between gap-1.5" style={{ height: 80 }}>
            {trend.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full max-w-[28px] rounded-t-md transition-all"
                  style={{
                    height: `${Math.max((d.count / d.max) * 64, d.count > 0 ? 6 : 0)}px`,
                    backgroundColor:
                      d.count === d.max && d.count > 0
                        ? 'var(--accent)'
                        : 'rgba(96,139,239,0.35)',
                  }}
                />
                <span className="text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
                  {d.day}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 最近操作 */}
        <div className="neu-card flex flex-col p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
              <ArrowRight size={13} />
              最近操作
            </div>
            <span className="text-[10px] text-[color:var(--muted-foreground)]">最近5条</span>
          </div>
          {activities && activities.length > 0 ? (
            <div className="mt-3 flex flex-1 flex-col divide-y divide-[#eef3f8]">
              {activities.map((act) => (
                <div key={act.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <span className="text-[12px] font-semibold text-[#18243a]">
                      {AUDIT_ACTION_LABELS[act.action] ?? act.action}
                    </span>
                    {act.resourceType && (
                      <span className="ml-1.5 text-[10px] text-[#8a99ad]">
                        {act.resourceType}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
                    <span className="text-[10px] tabular-nums text-[#8a99ad]">
                      {formatDate(act.createdAt)}
                    </span>
                    <span className="text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
                      {formatTime(act.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[11px] text-[color:var(--muted-foreground)]">
              暂无操作记录
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
