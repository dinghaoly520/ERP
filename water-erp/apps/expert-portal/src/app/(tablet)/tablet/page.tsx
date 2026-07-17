'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Clock } from 'lucide-react';
import { api } from '@/lib/api';
import type { ExpertProject } from '@/lib/types';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

/**
 * 开始打分落地页（无线隔离）
 *
 * 仅展示评标项目列表 + 开始打分按钮。
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
        <h1 className="text-xl font-black text-[oklch(0.18_0.012_265)]">评标项目</h1>
        <p className="mt-1 text-sm text-[oklch(0.55_0.01_264)]">
          选择项目进入开始打分界面
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-2xl border border-[oklch(0.91_0.006_264)] bg-white/70 p-5"
            >
              <div className="mb-3 h-5 w-20 rounded bg-[oklch(0.94_0.004_264)]" />
              <div className="mb-2 h-4 w-48 rounded bg-[oklch(0.94_0.004_264)]" />
              <div className="h-4 w-32 rounded bg-[oklch(0.94_0.004_264)]" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[oklch(0.91_0.006_264)] bg-white/70 py-16 text-center">
          <Clock size={48} strokeWidth={1} className="mb-4 text-[oklch(0.80_0.006_264)]" />
          <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)]">暂无评审任务</h3>
          <p className="mt-1 text-sm text-[oklch(0.55_0.01_264)]">
            当您被分配为评审专家时，任务将显示在这里
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* 进行中的项目 */}
          {activeProjects.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-bold text-[#11a874]">
                进行中 · {activeProjects.length} 个
              </h2>
              <div className="space-y-3">
                {activeProjects.map((ep) => {
                  const sc = STAGE_COLOR[ep.project.stage] || '#5a6d8a';
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
              <h2 className="mb-3 text-sm font-bold text-[oklch(0.55_0.01_264)]">
                其他 · {inactiveProjects.length} 个
              </h2>
              <div className="space-y-2 opacity-60">
                {inactiveProjects.map((ep) => {
                  const sc = STAGE_COLOR[ep.project.stage] || '#5a6d8a';
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
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onEvaluate : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEvaluate?.(); } } : undefined}
      className={`rounded-2xl border border-[oklch(0.91_0.006_264)] bg-white/70 p-5 transition ${
        clickable ? 'cursor-pointer hover:border-[#bfdbfe] hover:shadow-sm active:scale-[0.99]' : ''
      }`}
    >
      {/* 头部：编号 + 名称 + 阶段 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-lg bg-[#eff6ff]/50 px-3 py-1 text-sm font-semibold text-[#064ea2]">
            {ep.project.projectCode}
          </span>
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-bold text-[oklch(0.18_0.012_265)]">
              {ep.project.name}
            </h3>
            {!disabled && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                  style={{ backgroundColor: sc }}
                />
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ backgroundColor: sc }}
                />
              </span>
            )}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ color: sc, backgroundColor: sc + '18' }}
        >
          {STAGE_LABEL[ep.project.stage] || ep.project.stage}
        </span>
      </div>

      {/* 统计信息 */}
      <div className="mb-3 flex items-center gap-6 text-sm text-[oklch(0.55_0.01_264)]">
        <span>投标单位：{ep.project.suppliers?.length ?? 0} 家</span>
        <span>评分项：{ep.project.scoreItems?.length ?? 0} 项</span>
      </div>

      {/* 进度条 */}
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[oklch(0.94_0.004_264)]">
          <div
            className="h-full rounded-full bg-[#064ea2]/60 transition-all duration-500"
            style={{ width: `${ep.progress}%` }}
          />
        </div>
        <span className="w-12 text-right text-xs font-semibold text-[#064ea2]">
          {ep.progress}%
        </span>

        {ep.progress >= 100 && (
          <span className="shrink-0 rounded bg-emerald-50/80 px-2 py-0.5 text-xs font-semibold text-emerald-600">
            已完成
          </span>
        )}
        {!ep.signedIn && (
          <span className="shrink-0 rounded bg-amber-50/80 px-2 py-0.5 text-xs font-semibold text-amber-600">
            待核验
          </span>
        )}
      </div>
    </div>
  );
}
