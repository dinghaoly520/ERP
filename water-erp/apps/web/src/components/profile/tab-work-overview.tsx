'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Loader2,
  ClipboardCheck,
  FolderKanban,
  CheckCircle2,
  CalendarDays,
  Sparkles,
} from 'lucide-react';
import { fetchWorkArrangements } from '@/lib/api/work-arrangements';
import { fetchProjectManagementList } from '@/lib/api/project-management';
import { useNotifications } from '@/lib/hooks/use-notifications';
import type { WorkArrangementItem } from '@/lib/types/work-arrangements';
import { TabWorkPortrait } from './tab-work-portrait';

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

export function TabWorkOverview() {
  const [items, setItems] = useState<WorkArrangementItem[] | null>(null);
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { derivedTodo } = useNotifications();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [taskRes, projRes] = await Promise.all([
          fetchWorkArrangements({ scope: 'ALL', includeCompleted: true }),
          fetchProjectManagementList('ACTIVE'),
        ]);
        if (!cancelled) {
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

  if (loading) {
    return (
      <div className="wb-panel flex min-h-[320px] flex-1 items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
        <Loader2 size={18} className="animate-spin" />正在加载工作数据...
      </div>
    );
  }

  // Check if there's any meaningful data to show
  const hasData = stats && (stats.approvalTotal > 0 || stats.weekCreated > 0 || (projectCount ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      {!hasData ? (
        /* ═══ 无数据时：引导卡片 ═══ */
        <div className="neu-card flex flex-col items-center gap-4 px-6 py-10 text-center">
          <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
            <Sparkles size={24} className="text-[color:var(--accent)]" />
          </div>
          <div>
            <p className="text-[15px] font-bold text-[#18243a]">开始你的工作之旅</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#5a6d8a]">
              还没有工作数据。前往
              <a href="/work-arrangements" className="mx-1 font-bold text-[color:var(--accent)] underline">工作台</a>
              创建你的第一个任务，处理供应商审批或价格复核。
            </p>
          </div>
        </div>
      ) : (
        /* ═══ KPI 卡片行 ═══ */
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="neu-card flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eef2ff]">
                <ClipboardCheck size={15} className="text-[#6366f1]" />
              </span>
              <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">本月审核</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black tabular-nums text-[#18243a]">{stats?.approvalTotal ?? '-'}</span>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">项</span>
            </div>
            <span className="text-[10px] text-[color:var(--muted-foreground)]">
              {stats ? `已完成${stats.monthlyCompleted} · 待处理${stats.notificationTotal}` : '-'}
            </span>
          </div>
          <div className="neu-card flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0f9ff]">
                <FolderKanban size={15} className="text-[#0ea5e9]" />
              </span>
              <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">活跃项目</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black tabular-nums text-[#18243a]">{projectCount ?? '-'}</span>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">个</span>
            </div>
            <span className="text-[10px] text-[color:var(--muted-foreground)]">当前进行中的采购项目</span>
          </div>
          <div className="neu-card flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0fdf4]">
                <CheckCircle2 size={15} className="text-[#11a874]" />
              </span>
              <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">任务完成率</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black tabular-nums text-[#18243a]">{stats ? `${stats.rate}%` : '-'}</span>
            </div>
            <span className="text-[10px] text-[color:var(--muted-foreground)]">本月创建任务的完成比例</span>
          </div>
          <div className="neu-card flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fffbeb]">
                <CalendarDays size={15} className="text-[#f59e0b]" />
              </span>
              <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">本周新建</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black tabular-nums text-[#18243a]">{stats?.weekCreated ?? '-'}</span>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">项</span>
            </div>
            <span className="text-[10px] text-[color:var(--muted-foreground)]">本周新增的工作任务</span>
          </div>
        </div>
      )}

      {/* ═══ 工作画像（原独立 tab，现合并到工作概览下方） ═══ */}
      <TabWorkPortrait />
    </div>
  );
}
