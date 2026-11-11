'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ClipboardList, Building2, FileText, MessageSquare, Calendar, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import type { ExpertProject } from '@/lib/types';
import { ProjectOverviewModal, isActiveProjectStage } from '@/components/project-overview-modal';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

export default function ExpertProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ExpertProject[]>([]);
  const [filter, setFilter] = useState<'reviewable' | 'archived' | 'all'>('reviewable');
  const [loading, setLoading] = useState(true);
  const [overviewProject, setOverviewProject] = useState<ExpertProject | null>(null);

  useEffect(() => {
    // 支持 ?filter=reviewable|archived|all 预选 tab
    const params = new URLSearchParams(window.location.search);
    const f = params.get('filter');
    if (f === 'reviewable' || f === 'archived' || f === 'all') setFilter(f);
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get<ExpertProject[]>('/expert/projects')
      .then(setProjects)
      .catch((e) => toast.error(`加载项目列表失败: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  const filtered = projects.filter(ep => {
    const s = ep.project.stage;
    if (filter === 'reviewable') return isActiveProjectStage(s);
    if (filter === 'archived') return s === 'ARCHIVED';
    return true;
  });

  // single-pass count instead of separate .filter() passes
  const statusCounts = useMemo(() => {
    let all = 0, reviewable = 0, archived = 0;
    for (const ep of projects) {
      all++;
      const s = ep.project.stage;
      if (isActiveProjectStage(s)) reviewable++;
      else if (s === 'ARCHIVED') archived++;
    }
    return { all, reviewable, archived };
  }, [projects]);

  const filterTabs = [
    { key: 'reviewable' as const, label: '评审中' },
    { key: 'archived' as const, label: '已归档' },
    { key: 'all' as const, label: '全部' },
  ];

  const handleCardClick = (ep: ExpertProject) => {
    if (isActiveProjectStage(ep.project.stage)) {
      router.push(`/evaluate/${ep.project.id}`);
    } else {
      setOverviewProject(ep);
    }
  };

  return (
    <div className="space-y-5">
      {/* 页面标题卡片 + 筛选 tab */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ClipboardList size={17} strokeWidth={1.5} /></div>
            <div>
              <div className="page-hero__title">评审项目</div>
              <div className="page-hero__sub">分配给您的招投标项目 · 身份核验 · 回避确认 · 独立打分</div>
            </div>
          </div>
          <div className="page-hero__right">
            <span className="page-hero__stat page-hero__stat--info">共 {statusCounts.all} 个</span>
          </div>
        </div>

        <div className="wb-section-rule" />
      </div>

      {/* ═══ 工具行：状态分段切换（hero 下方独立一行；:3002 公告类型切换同款——
           内凹轨道需置于页面底色上呈现，白瓷 hero 渐变底会洗掉轨道对比度）═══ */}
      <div className="flex flex-wrap items-center gap-4">
        <div
          className="neu-segment"
          role="group"
          aria-label="项目筛选"
          data-count="3"
          data-index={String(filterTabs.findIndex(f => f.key === filter))}
        >
          <span className="neu-segment-thumb" aria-hidden="true" />
          {filterTabs.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className="neu-segment-btn"
              aria-pressed={filter === f.key}
            >
              {f.label}
              <span className="neu-segment-count">{statusCounts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="neu-card-static p-12 text-center">
          <ClipboardList size={40} strokeWidth={1} className="mx-auto mb-3 animate-pulse text-[oklch(0.75_0.02_258)]" />
          <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="neu-card-static p-12 text-center">
          <ClipboardList size={46} strokeWidth={1} className="mx-auto mb-4 text-[oklch(0.75_0.02_258)]" />
          <h3 className="mb-2 text-lg font-bold text-[var(--foreground)]">
            {filter === 'reviewable' ? '暂无评审中项目' : filter === 'archived' ? '暂无已归档项目' : '暂无项目'}
          </h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            {filter === 'reviewable' ? '请等待管理端启动开标，评审中项目将显示在这里' : '暂无匹配的项目'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(ep => {
            const active = isActiveProjectStage(ep.project.stage);
            const done = ep.progress >= 100;
            const sc = STAGE_COLOR[ep.project.stage] || 'var(--muted-foreground)';

            return (
              <div key={ep.id}
                role="button" tabIndex={0}
                onClick={() => handleCardClick(ep)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(ep); } }}
                className={`${
                  active ? 'neu-card' : 'neu-card-static opacity-60'
                } cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-strong)]`}
              >
                <div className="p-6">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="exp-code-chip shrink-0">{ep.project.projectCode}</span>
                      <h3 className="truncate text-base font-bold tracking-tight text-[var(--foreground)]">{ep.project.name}</h3>
                      {active && <span className="exp-live-dot" style={{ '--c': sc } as React.CSSProperties} />}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {/* Expert status badges — only show for active projects */}
                      {active && !ep.signedIn && (
                        <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>待核验</span>
                      )}
                      {active && ep.signedIn && !ep.avoidanceConfirmed && (
                        <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>待回避确认</span>
                      )}
                      {done && (
                        <span className="exp-pill" style={{ '--c': 'var(--success)' } as React.CSSProperties}>已完成</span>
                      )}
                      {active && ep.signedIn && ep.avoidanceConfirmed && !done && (
                        <span className="exp-pill" style={{ '--c': 'var(--accent-strong)' } as React.CSSProperties}>评审中</span>
                      )}
                      {/* Stage badge — always shown, color-coded via STAGE_COLOR */}
                      <span className="exp-pill" style={{ '--c': sc } as React.CSSProperties}>
                        {STAGE_LABEL[ep.project.stage] || ep.project.stage}
                      </span>
                    </div>
                  </div>

                  <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm text-[var(--muted-foreground)]">
                    <span className="flex items-center gap-1.5">
                      <Building2 size={14} strokeWidth={1.5} />
                      {ep.project.suppliers?.length ?? 0} 家投标单位
                    </span>
                    <span className="flex items-center gap-1.5">
                      <FileText size={14} strokeWidth={1.5} />
                      {ep.project.scoreItems?.length ?? 0} 项评分
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MessageSquare size={14} strokeWidth={1.5} />
                      {ep.project._count?.clarifications ?? 0} 条澄清
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar size={14} strokeWidth={1.5} />
                      开标：{new Date(ep.project.openTime).toLocaleDateString('zh-CN')}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="exp-bar flex-1">
                      <i style={{
                        width: `${ep.progress}%`,
                        '--bar': done ? 'var(--success)' : active ? sc : 'var(--muted-foreground)',
                      } as React.CSSProperties} />
                    </div>
                    <span className={`w-11 text-right text-sm font-bold tabular-nums ${
                      done ? 'text-[var(--success)]' : active ? 'text-[var(--accent-strong)]' : 'text-[var(--muted-foreground)]'
                    }`}>
                      {ep.progress}%
                    </span>
                  </div>
                </div>

                <hr className="wb-section-rule" />
                <div className="flex items-center justify-between rounded-b-[20px] bg-[oklch(0.985_0.005_258/0.5)] px-6 py-3">
                  <span className="text-xs text-[var(--muted-foreground)]">专业领域：{ep.major || '综合评审'}</span>
                  {active ? (
                    <span className="text-sm font-bold text-[var(--accent-strong)]">进入评审 →</span>
                  ) : (
                    <span className="flex items-center gap-1 text-sm font-bold text-[var(--muted-foreground)]">
                      <Lock size={12} strokeWidth={1.5} />
                      查看概要
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Overview Modal for inactive projects（#155：抽出公共组件，与 profile 页评审记录行共用） */}
      <ProjectOverviewModal data={overviewProject} onClose={() => setOverviewProject(null)} />
    </div>
  );
}
