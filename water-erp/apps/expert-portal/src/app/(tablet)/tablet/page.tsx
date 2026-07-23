'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Clock } from 'lucide-react';
import { api } from '@/lib/api';
import type { ExpertProject } from '@/lib/types';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

/**
 * 开始打分落地页（无线隔离 · cgzxui 新拟态）
 *
 * 仅展示评标项目列表 + 整卡点按进入打分。
 * 不含桌面端的统计卡片、侧边栏、快捷操作、评审须知。
 */
export default function TabletLandingPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ExpertProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<ExpertProject[]>('/expert/projects')
      .then(setProjects)
      .catch((e) => toast.error(`加载项目列表失败: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  const isProjectActive = (stage: string) => stage === 'OPENING' || stage === 'EVALUATING';
  const activeProjects = projects.filter((p) => isProjectActive(p.project.stage));
  const inactiveProjects = projects.filter((p) => !isProjectActive(p.project.stage));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[1.35rem] font-black tracking-[-0.01em] text-[var(--foreground)]">评标项目</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          选择项目进入开始打分界面
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="neu-card-static animate-pulse p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="h-6 w-24 rounded-lg bg-[oklch(0.55_0.03_258/0.12)]" />
                <div className="h-5 w-44 rounded bg-[oklch(0.55_0.03_258/0.12)]" />
              </div>
              <div className="mb-4 h-4 w-56 rounded bg-[oklch(0.55_0.03_258/0.1)]" />
              <div className="h-2 w-full rounded-full bg-[oklch(0.55_0.03_258/0.12)]" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="neu-card-static px-6 py-16 text-center">
          <Clock size={52} strokeWidth={1} className="mx-auto mb-4 text-[oklch(0.75_0.02_258)]" />
          <h3 className="text-lg font-bold text-[var(--foreground)]">暂无评审任务</h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            当您被分配为评审专家时，任务将显示在这里
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 进行中的项目 */}
          {activeProjects.length > 0 && (
            <section>
              <h2 className="mb-3.5 text-[1.05rem] font-bold tracking-[-0.01em] text-[var(--foreground)]">
                进行中 · {activeProjects.length} 个
              </h2>
              <div className="space-y-4">
                {activeProjects.map((ep) => {
                  const sc = STAGE_COLOR[ep.project.stage] || 'var(--muted-foreground)';
                  return (
                    <ProjectCard
                      key={ep.id}
                      ep={ep}
                      sc={sc}
                      onEvaluate={() => router.push(`/tablet/evaluate/${ep.project.id}`)}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {/* 其他项目 */}
          {inactiveProjects.length > 0 && (
            <section>
              <h2 className="mb-3.5 text-[1.05rem] font-bold tracking-[-0.01em] text-[var(--foreground)]">
                其他 · {inactiveProjects.length} 个
              </h2>
              <div className="space-y-3 opacity-60">
                {inactiveProjects.map((ep) => {
                  const sc = STAGE_COLOR[ep.project.stage] || 'var(--muted-foreground)';
                  return (
                    <ProjectCard
                      key={ep.id}
                      ep={ep}
                      sc={sc}
                      disabled
                    />
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

    </div>
  );
}

function ProjectCard({
  ep,
  sc,
  onEvaluate,
  disabled,
}: {
  ep: ExpertProject;
  sc: string;
  onEvaluate?: () => void;
  disabled?: boolean;
}) {
  const clickable = !disabled && !!onEvaluate;
  const done = ep.progress >= 100;
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onEvaluate : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEvaluate?.(); } } : undefined}
      className={`${clickable ? 'neu-card cursor-pointer' : 'neu-card-static'} p-6`}
    >
      {/* 头部：编号 + 名称 + 阶段 */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="exp-code-chip shrink-0">{ep.project.projectCode}</span>
          <div className="flex min-w-0 items-center gap-2.5">
            <h3 className="truncate text-[1.05rem] font-bold tracking-[-0.01em] text-[var(--foreground)]">
              {ep.project.name}
            </h3>
            {!disabled && (
              <span className="exp-live-dot" style={{ '--c': sc } as React.CSSProperties} />
            )}
          </div>
        </div>
        <span className="exp-pill shrink-0" style={{ '--c': sc } as React.CSSProperties}>
          {STAGE_LABEL[ep.project.stage] || ep.project.stage}
        </span>
      </div>

      {/* 统计信息 */}
      <div className="mb-4 flex items-center gap-7 text-sm text-[var(--muted-foreground)]">
        <span>投标单位：{ep.project.suppliers?.length ?? 0} 家</span>
        <span>评分项：{ep.project.scoreItems?.length ?? 0} 项</span>
      </div>

      {/* 进度条 */}
      <div className="flex items-center gap-3">
        <div className="exp-bar flex-1">
          <i style={{ width: `${ep.progress}%`, '--bar': done ? 'var(--success)' : sc } as React.CSSProperties} />
        </div>
        <span className="w-12 text-right text-sm font-bold tabular-nums text-[var(--accent-strong)]">
          {ep.progress}%
        </span>

        {done && (
          <span className="exp-pill shrink-0" style={{ '--c': 'var(--success)' } as React.CSSProperties}>
            已完成
          </span>
        )}
        {!ep.signedIn && (
          <span className="exp-pill shrink-0" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>
            待核验
          </span>
        )}
      </div>
    </div>
  );
}
