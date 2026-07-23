'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ClipboardList, Building2, FileText, MessageSquare, Calendar, Clock, Lock, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { ExpertProject } from '@/lib/types';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

function isActive(stage: string) {
  return stage === 'OPENING' || stage === 'EVALUATING';
}

export default function ExpertProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ExpertProject[]>([]);
  const [filter, setFilter] = useState<'reviewable' | 'archived' | 'all'>('reviewable');
  const [loading, setLoading] = useState(true);
  const [overviewProject, setOverviewProject] = useState<ExpertProject | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<ExpertProject[]>('/expert/projects')
      .then(setProjects)
      .catch((e) => toast.error(`加载项目列表失败: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  // P3: Auto-focus modal close button when opened
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (overviewProject && modalCloseRef.current) {
      modalCloseRef.current.focus();
    }
  }, [overviewProject]);

  const filtered = projects.filter(ep => {
    const s = ep.project.stage;
    if (filter === 'reviewable') return isActive(s);
    if (filter === 'archived') return s === 'ARCHIVED';
    return true;
  });

  // P2: single-pass count instead of separate .filter() passes
  const statusCounts = useMemo(() => {
    let all = 0, reviewable = 0, archived = 0;
    for (const ep of projects) {
      all++;
      const s = ep.project.stage;
      if (isActive(s)) reviewable++;
      else if (s === 'ARCHIVED') archived++;
    }
    return { all, reviewable, archived };
  }, [projects]);

  const filterTabs = [
    { key: 'reviewable' as const, label: '可评审' },
    { key: 'archived' as const, label: '已归档' },
    { key: 'all' as const, label: '全部' },
  ];

  const handleCardClick = (ep: ExpertProject) => {
    if (isActive(ep.project.stage)) {
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

        <div className="relative z-[1]">
          <div className="neu-tab-bar flex-wrap">
            {filterTabs.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`neu-tab ${filter === f.key ? 'is-active' : ''}`}
              >
                {f.label}
                <span className="neu-tab-count">{statusCounts[f.key]}</span>
              </button>
            ))}
          </div>
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
            {filter === 'reviewable' ? '暂无可评审项目' : filter === 'archived' ? '暂无已归档项目' : '暂无项目'}
          </h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            {filter === 'reviewable' ? '请等待管理端启动开标，可评审项目将显示在这里' : '暂无匹配的项目'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(ep => {
            const active = isActive(ep.project.stage);
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

      {/* Overview Modal for inactive projects */}
      {overviewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog" aria-modal="true" aria-label="项目概要"
          onKeyDown={(e) => { if (e.key === 'Escape') { setOverviewProject(null); } }}>
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => setOverviewProject(null)} />
          <div className="exp-dialog w-full max-w-md">
            {/* 标题区 */}
            <div className="flex items-center justify-between gap-4 px-6 py-4">
              <div className="flex items-center gap-2">
                <Clock size={16} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
                <h3 className="text-base font-bold text-[var(--foreground)]">项目概要</h3>
              </div>
              <button ref={modalCloseRef} onClick={() => setOverviewProject(null)}
                className="neu-btn-xs is-square" aria-label="关闭">
                <X size={15} strokeWidth={1.6} />
              </button>
            </div>
            <hr className="wb-section-rule" />
            {/* 信息 */}
            <div className="space-y-4 px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="exp-user-chip-avatar !h-11 !w-11 !rounded-xl !text-base">
                  {overviewProject.project.name[0]}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-bold text-[var(--foreground)]">{overviewProject.project.name}</p>
                  <p className="font-mono text-xs text-[var(--muted-foreground)]">{overviewProject.project.projectCode}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="mb-1 text-xs text-[var(--muted-foreground)]">当前阶段</p>
                  <span className="exp-pill" style={{
                    '--c': STAGE_COLOR[overviewProject.project.stage] || 'var(--muted-foreground)',
                  } as React.CSSProperties}>
                    {STAGE_LABEL[overviewProject.project.stage] || overviewProject.project.stage}
                  </span>
                </div>
                <div>
                  <p className="mb-1 text-xs text-[var(--muted-foreground)]">投标单位</p>
                  <p className="font-semibold text-[var(--foreground)]">{overviewProject.project.suppliers?.length ?? 0} 家</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-[var(--muted-foreground)]">开标时间</p>
                  <p className="font-semibold text-[var(--foreground)]">
                    {new Date(overviewProject.project.openTime).toLocaleDateString('zh-CN')}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-[var(--muted-foreground)]">专业领域</p>
                  <p className="font-semibold text-[var(--foreground)]">{overviewProject.major || '综合评审'}</p>
                </div>
              </div>

              {overviewProject.project.stage === 'ARCHIVED' ? (
                <div className="exp-alert exp-alert--success flex items-start gap-2.5">
                  <ClipboardList size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[13px] font-bold">该项目已完成全部评审流程并归档</p>
                    <p className="mt-0.5 font-medium opacity-80">
                      归档期意味着招标及评审环节已经结束，所有评分与报告均已定稿。您可以在个人信息页查看您的评审记录。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="exp-alert exp-alert--warn flex items-start gap-2.5">
                  <Lock size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[13px] font-bold">该项目尚未进入开评标阶段</p>
                    <p className="mt-0.5 font-medium opacity-80">
                      请等待管理端启动开标。开标后，您将可以进入评审向导进行身份核验与专家打分。
                    </p>
                  </div>
                </div>
              )}
            </div>
            <hr className="wb-section-rule" />
            {/* 页脚 */}
            <div className="flex justify-end px-6 py-4">
              <button onClick={() => setOverviewProject(null)} className="neu-btn-soft h-[38px]">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
