'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Clipboard, ShieldCheck, UserCircle, ScrollText, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ExpertStatistics, ExpertProject, User } from '@/lib/types';

export default function ExpertDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<ExpertStatistics | null>(null);
  const [projects, setProjects] = useState<ExpertProject[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.allSettled([
      fetch('/api/auth/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(setUser),
      api.get<ExpertStatistics>('/expert/statistics').then(setStats).catch((e) => toast.error(`加载统计数据失败: ${e.message}`)),
      api.get<ExpertProject[]>('/expert/projects').then(setProjects).catch((e) => toast.error(`加载项目列表失败: ${e.message}`)),
    ]).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const isProjectActive = (stage: string) => stage === 'OPENING' || stage === 'EVALUATING';
  const activeProjects = projects.filter(p => isProjectActive(p.project.stage));
  const totalProjectCount = projects.length;
  const pendingCount = stats?.pendingProjects ?? 0;

  const kpis = [
    {
      label: '待核验', value: pendingCount, sub: '未完成身份核验',
      sig: 'var(--warning)', sigLabel: '待处理', Icon: ShieldCheck,
      path: '/projects',
    },
    {
      label: '评审中', value: activeProjects.length, sub: '开评标进行中',
      sig: 'var(--accent-strong)', sigLabel: '进行中', Icon: Clipboard,
      path: '/projects?filter=reviewable',
    },
    {
      label: '已完成', value: stats?.completedProjects ?? 0, sub: '累计评审项目',
      sig: 'var(--success)', sigLabel: '已归档', Icon: CheckCircle,
      path: '/projects?filter=archived',
    },
  ];

  return (
    <div className="space-y-5">
      {/* 页面标题卡片 */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UserCircle size={18} strokeWidth={1.5} /></div>
            <div>
              <div className="page-hero__title">欢迎，{user?.displayName || '专家'}</div>
              <div className="page-hero__sub">在线开标 · 专家评审 · 过程留痕</div>
            </div>
          </div>
          <div className="page-hero__right">
            <span className="page-hero__stat page-hero__stat--info">共 {totalProjectCount} 个项目</span>
            {pendingCount > 0 && (
              <span className="page-hero__stat page-hero__stat--warn">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" />
                {pendingCount} 待核验
              </span>
            )}
            <button onClick={load} disabled={loading} className="neu-btn-xs is-square !h-[30px] !w-[30px]" title="刷新">
              <RefreshCw size={14} strokeWidth={1.6} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="wb-section-rule" />

        {/* KPI 指标瓷片 — 可点击跳转至评审项目页对应筛选 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {loading
            ? kpis.map(k => (
                <div key={k.label} className="kpi-card animate-pulse p-3">
                  <div className="h-2.5 w-14 rounded bg-[oklch(0.55_0.03_258/0.12)]" />
                  <div className="mt-2 h-6 w-10 rounded bg-[oklch(0.55_0.03_258/0.12)]" />
                </div>
              ))
            : kpis.map(k => (
                <div
                  key={k.label}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(k.path)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(k.path); } }}
                  className="kpi-card cursor-pointer flex flex-col gap-1.5 p-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                      <k.Icon size={13} strokeWidth={1.7} />
                      {k.label}
                    </span>
                    <span className="kpi-signal text-[9px] font-bold" style={{ '--s': k.sig } as React.CSSProperties}>
                      <span className="kpi-signal-dot" />
                      {k.sigLabel}
                    </span>
                  </div>
                  <span className="text-[1.7rem] font-black leading-none tracking-[-0.04em] tabular-nums text-[var(--foreground)]">{k.value}</span>
                  <span className="text-[10px] font-medium text-[var(--muted-foreground)]">{k.sub}</span>
                </div>
              ))}
        </div>
      </div>

      {/* 快捷操作 + 评审须知 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_336px]">
        <div className="neu-card-static p-5">
          <h3 className="mb-4 text-[0.95rem] font-bold text-[var(--foreground)]">快捷操作</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '查看全部项目', desc: '评审项目管理', path: '/projects', Icon: Clipboard },
              { label: '个人信息', desc: '资料查看与维护', path: '/profile', Icon: UserCircle },
            ].map(action => (
              <button key={action.path} onClick={() => router.push(action.path)} className="exp-action-tile">
                <span className="exp-action-tile-icon"><action.Icon size={18} strokeWidth={1.6} /></span>
                <span className="text-sm font-bold text-[var(--foreground)]">{action.label}</span>
                <span className="text-xs text-[var(--muted-foreground)]">{action.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="neu-card-static p-5">
          <h3 className="mb-2 flex items-center gap-2 text-[0.95rem] font-bold text-[var(--foreground)]">
            <ScrollText size={16} strokeWidth={1.6} className="text-[var(--accent-strong)]" />
            评审须知
          </h3>
          <ul className="space-y-0.5 text-sm text-[var(--muted-foreground)]">
            {[
              '评审前需完成身份核验与回避确认',
              '独立评审，不得与其他专家商议',
              '所有评分需给出客观理由',
              '评分提交后不可随意修改',
              '评审全程留痕，受监督审计',
            ].map(t => (
              <li key={t} className="exp-list-item">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-strong)]" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
