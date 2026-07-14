'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Loader2,
  Zap,
  TrendingUp,
  Star,
  Target,
  Clock,
  Calendar,
  Award,
  Sun,
  Moon,
  Coffee,
} from 'lucide-react';
import { fetchMyActivities, type AuditLogItem } from '@/lib/api/audit-log';
import { fetchWorkArrangements } from '@/lib/api/work-arrangements';
import type { WorkArrangementItem } from '@/lib/types/work-arrangements';

// ── 时间分析工具 ──

const APPROVAL_ACTIONS = new Set([
  'SUPPLIER_APPROVE', 'SUPPLIER_REJECT', 'SUPPLIER_RETURN',
  'PRICE_APPROVE', 'PRICE_REJECT', 'PRICE_RETURN',
  'PASSWORD_REQUEST_APPROVE',
]);

function hourToPeriod(h: number): { label: string; icon: typeof Sun } {
  if (h >= 6 && h < 10) return { label: '清晨', icon: Coffee };
  if (h >= 10 && h < 12) return { label: '上午', icon: Sun };
  if (h >= 12 && h < 14) return { label: '午后', icon: Sun };
  if (h >= 14 && h < 18) return { label: '下午', icon: Clock };
  return { label: '晚间', icon: Moon };
}

function dayLabel(d: number): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d];
}

// ── 洞察计算 ──

interface PortraitData {
  totalApprovals: number;
  avgResponseHours: number;
  peakPeriod: string;
  peakDay: string;
  totalTasks: number;
  completedTasks: number;
  completionStreak: number;
  monthlyRank: string;
  domainFocus: { label: string; pct: number }[];
}

function computePortrait(
  activities: AuditLogItem[],
  items: WorkArrangementItem[],
): PortraitData {
  // 审批统计
  const approvalActs = activities.filter((a) => APPROVAL_ACTIONS.has(a.action));

  // 平均响应时间（审批操作的相邻时间差）
  let totalGap = 0;
  let gapCount = 0;
  const hourCounts: number[] = new Array(24).fill(0);
  const dayCounts: number[] = new Array(7).fill(0);

  const sorted = [...approvalActs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  for (let i = 1; i < sorted.length; i++) {
    const gap =
      (new Date(sorted[i].createdAt).getTime() -
        new Date(sorted[i - 1].createdAt).getTime()) /
      3600000;
    if (gap < 72) {
      totalGap += gap;
      gapCount++;
    }
  }

  for (const act of approvalActs) {
    const d = new Date(act.createdAt);
    hourCounts[d.getHours()]++;
    dayCounts[d.getDay()]++;
  }

  // 峰值时段
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  const peakDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
  const peakPeriod = hourToPeriod(peakHour);

  // 任务完成率
  const completed = items.filter((i) => i.status === 'COMPLETED');
  const total = items.filter((i) => i.status !== 'CANCELLED').length;

  // 完成连续天数（从今天往回数）
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setDate(end.getDate() + 1);
    const dayItems = items.filter(
      (i) => i.status === 'COMPLETED' && i.completedAt && new Date(i.completedAt) >= d && new Date(i.completedAt) < end,
    );
    if (dayItems.length > 0) streak++;
    else break;
  }

  // 每月排名（基于完成数 — 模拟评估，实际无对比数据）
  const monthlyRank = completed.length > 15 ? '高效产出者' : completed.length > 8 ? '稳定推进者' : '稳步积累中';

  // 领域聚焦
  const typeLabels: Record<string, string> = {
    APPROVAL: '审批处理', FOLLOW_UP: '项目跟进', WRITING: '文档撰写',
    COMMUNICATION: '沟通协调', REVIEW: '审核审查', MEETING: '会议研讨',
    ARCHIVE: '资料归档', RESEARCH: '调研分析',
  };
  const typeCounts: Record<string, number> = {};
  for (const item of items) {
    if (item.status !== 'CANCELLED') {
      typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
    }
  }
  const totalTyped = Object.values(typeCounts).reduce((s, v) => s + v, 0);
  const domainFocus = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => ({
      label: typeLabels[type] || type,
      pct: totalTyped > 0 ? Math.round((count / totalTyped) * 100) : 0,
    }));

  return {
    totalApprovals: approvalActs.length,
    avgResponseHours: gapCount > 0 ? Math.round((totalGap / gapCount) * 10) / 10 : 0,
    peakPeriod: peakPeriod.label,
    peakDay: dayLabel(peakDayIdx),
    totalTasks: total,
    completedTasks: completed.length,
    completionStreak: streak,
    monthlyRank,
    domainFocus,
  };
}

// ── 组件 ──

export function TabWorkPortrait() {
  const [activities, setActivities] = useState<AuditLogItem[] | null>(null);
  const [items, setItems] = useState<WorkArrangementItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [actRes, taskRes] = await Promise.all([
          fetchMyActivities({ limit: 200 }),
          fetchWorkArrangements({ scope: 'ALL', includeCompleted: true }),
        ]);
        if (!cancelled) {
          setActivities(actRes.items);
          setItems(taskRes);
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

  const portrait = useMemo(
    () => (activities && items ? computePortrait(activities, items) : null),
    [activities, items],
  );

  if (loading) {
    return (
      <div className="wb-panel flex min-h-[400px] flex-1 items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
        <Loader2 size={18} className="animate-spin" />正在分析你的工作风格...
      </div>
    );
  }

  if (!portrait || portrait.totalTasks === 0) {
    return (
      <div className="wb-panel flex min-h-[400px] flex-1 flex-col items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
        <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
          <Star size={24} className="text-[color:var(--accent)] opacity-40" />
        </div>
        <p>还没有足够的工作数据来生成画像</p>
        <p className="text-[11px]">完成一些任务和审批后，再回来看你的工作风格分析</p>
      </div>
    );
  }

  const p = portrait;
  const PeakIcon = hourToPeriod(0).icon; // will be overridden below

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {/* ═══ 头部叙事卡片 — 一句话总结 ═══ */}
      <div
        className="neu-card relative overflow-hidden p-5"
        style={{
          background: 'linear-gradient(135deg, rgba(96,139,239,0.06), rgba(96,139,239,0.02))',
        }}
      >
        <div className="absolute right-4 top-4 opacity-10">
          <Star size={64} strokeWidth={1} className="text-[color:var(--accent)]" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center rounded-[10px] px-2.5 py-0.5 text-[11px] font-bold"
              style={{ backgroundColor: 'rgba(96,139,239,0.12)', color: 'var(--accent)' }}
            >
              工作画像
            </span>
            <span className="text-[11px] text-[color:var(--muted-foreground)]">
              基于你的操作数据生成
            </span>
          </div>
          <p className="mt-3 max-w-[580px] text-[15px] leading-relaxed text-[#18243a]">
            你是一个
            <span className="font-bold text-[color:var(--accent)]">
              {p.monthlyRank}
            </span>
            。你最常活跃的时间是
            <span className="font-bold text-[color:var(--accent)]">{p.peakDay}</span>
            的<span className="font-bold text-[color:var(--accent)]">{p.peakPeriod}</span>
            ，至今已处理了
            <span className="font-bold text-[color:var(--accent)]">{p.totalApprovals} 次</span>
            审批和
            <span className="font-bold text-[color:var(--accent)]">{p.completedTasks} 项</span>
            任务。你的工作主要集中在
            {p.domainFocus.slice(0, 2).map((d, i) => (
              <span key={d.label}>
                {i > 0 && '和'}
                <span className="font-bold text-[color:var(--accent)]">
                  {d.label}
                </span>
              </span>
            ))}
            。你已连续
            <span className="font-bold text-[color:var(--accent)]">{p.completionStreak} 天</span>
            保持有完成的记录。
            {p.avgResponseHours > 0 && (
              <span>
                ，平均审批响应时间约
                <span className="font-bold text-[color:var(--accent)]">{p.avgResponseHours} 小时</span>
                。
              </span>
            )}
          </p>
        </div>
      </div>

      {/* ═══ 指标行 ═══ */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {/* 平均响应 */}
        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eef2ff]">
              <Zap size={15} className="text-[#6366f1]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
              平均响应
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black tabular-nums text-[#18243a]">
              {p.avgResponseHours > 0 ? p.avgResponseHours : '—'}
            </span>
            {p.avgResponseHours > 0 && (
              <span className="text-[11px] text-[color:var(--muted-foreground)]">小时</span>
            )}
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">
            {p.avgResponseHours > 0 ? '两次审批之间的间隔' : '暂无审批数据'}
          </span>
        </div>

        {/* 连续完成 */}
        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0fdf4]">
              <TrendingUp size={15} className="text-[#11a874]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
              连续完成
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black tabular-nums text-[#18243a]">
              {p.completionStreak}
            </span>
            <span className="text-[11px] text-[color:var(--muted-foreground)]">天</span>
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">
            每天至少完成一项任务
          </span>
        </div>

        {/* 活跃峰值 */}
        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fffbeb]">
              <Calendar size={15} className="text-[#f59e0b]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
              活跃峰值
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-black tabular-nums text-[#18243a]">
              {p.peakDay}
            </span>
            <span className="mx-0.5 text-[11px] text-[color:var(--muted-foreground)]">·</span>
            <span className="text-[13px] font-bold text-[#18243a]">
              {p.peakPeriod}
            </span>
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">
            你审批最频繁的时段
          </span>
        </div>

        {/* 领域聚焦 */}
        <div className="neu-card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5f3ff]">
              <Target size={15} className="text-[#7c3aed]" />
            </span>
            <span className="text-[11px] font-semibold text-[color:var(--muted-foreground)]">
              领域聚焦
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {p.domainFocus.slice(0, 2).map((d) => (
              <span
                key={d.label}
                className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                style={{
                  backgroundColor: 'rgba(96,139,239,0.1)',
                  color: 'var(--accent)',
                }}
              >
                {d.label}
              </span>
            ))}
          </div>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">
            你的主要工作类型
          </span>
        </div>
      </div>

      {/* ═══ 领域分布条 ═══ */}
      <div className="neu-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-[color:var(--accent)]">
            工作领域分布
          </p>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">
            共 {p.totalTasks} 项
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {p.domainFocus.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              <span className="w-[60px] flex-shrink-0 text-[12px] font-semibold text-[#18243a]">
                {d.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef3f8]">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${d.pct}%`,
                    background:
                      'linear-gradient(90deg, var(--accent-soft), var(--accent))',
                  }}
                />
              </div>
              <span className="w-[36px] flex-shrink-0 text-right text-[11px] tabular-nums font-bold text-[color:var(--accent)]">
                {d.pct}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ 底部标语 ═══ */}
      <div className="py-2 text-center">
        <p className="text-[11px] leading-relaxed text-[color:var(--muted-foreground)] italic opacity-60">
          数据越多，画像越精准。继续在工作台上推进任务，你的画像会自动更新。
        </p>
      </div>
    </div>
  );
}
