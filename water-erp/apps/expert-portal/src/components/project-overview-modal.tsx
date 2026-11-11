'use client';

// 项目只读概览弹窗（#155 修复抽出，2026-11-11）：projects 页卡片与 profile 页评审记录行共用。
// 活跃项目（OPENING/EVALUATING）应直接进评审工作区，此弹窗只服务「非活跃/只读」场景
// ——projects 页点未开标/已归档卡片、profile 页点非活跃评审记录行（不再误入 /evaluate 被弹回）。
import { useEffect, useRef } from 'react';
import { Clock, X, ClipboardList, Lock } from 'lucide-react';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

/** 结构化数据形状：projects 页 ExpertProject 与 profile 页评审记录行（assignment）均满足 */
export type ProjectOverviewData = {
  project: {
    name: string;
    projectCode?: string;
    stage: string;
    openTime?: string | Date | null;
    suppliers?: unknown[] | null;
  };
  major?: string | null;
};

/** 活跃项目谓词（#155 review 备注②收口）：「可进评审工作区」的唯一口径——
 *  projects 页卡片、profile 页评审记录行、evaluate 页向导守卫三处共用，防口径漂移复现 #155 类 bug。 */
export function isActiveProjectStage(stage: string) {
  return stage === 'OPENING' || stage === 'EVALUATING';
}

export function ProjectOverviewModal({ data, onClose }: { data: ProjectOverviewData | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (data && closeRef.current) closeRef.current.focus();
  }, [data]);

  if (!data) return null;
  const { project } = data;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-label="项目概要"
      onKeyDown={(e) => { if (e.key === 'Escape') { onClose(); } }}>
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="wb-modal-shell relative overflow-hidden w-full max-w-md">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2">
            <Clock size={16} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
            <h3 className="text-base font-bold text-[var(--foreground)]">项目概要</h3>
          </div>
          <button ref={closeRef} onClick={onClose}
            className="neu-btn-xs is-square" aria-label="关闭">
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>
        <hr className="wb-section-rule" />
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="exp-user-chip-avatar !h-11 !w-11 !rounded-xl !text-base">
              {project.name[0]}
            </span>
            <div className="min-w-0">
              <p className="truncate font-bold text-[var(--foreground)]">{project.name}</p>
              <p className="font-mono text-xs text-[var(--muted-foreground)]">{project.projectCode}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="mb-1 text-xs text-[var(--muted-foreground)]">当前阶段</p>
              <span className="exp-pill" style={{
                '--c': STAGE_COLOR[project.stage] || 'var(--muted-foreground)',
              } as React.CSSProperties}>
                {STAGE_LABEL[project.stage] || project.stage}
              </span>
            </div>
            <div>
              <p className="mb-1 text-xs text-[var(--muted-foreground)]">投标单位</p>
              <p className="font-semibold text-[var(--foreground)]">
                {project.suppliers == null ? '—' : `${project.suppliers.length} 家`}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-[var(--muted-foreground)]">开标时间</p>
              <p className="font-semibold text-[var(--foreground)]">
                {project.openTime ? new Date(project.openTime).toLocaleDateString('zh-CN') : '—'}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-[var(--muted-foreground)]">专业领域</p>
              <p className="font-semibold text-[var(--foreground)]">{data.major || '综合评审'}</p>
            </div>
          </div>

          {project.stage === 'ARCHIVED' ? (
            <div className="exp-alert exp-alert--success flex items-start gap-2.5">
              <ClipboardList size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-bold">该项目已完成全部评审流程并归档</p>
                <p className="mt-0.5 font-medium opacity-80">
                  归档期意味着招标及评审环节已经结束，所有评分与报告均已定稿，相关数据只读留存备查。
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
        <div className="flex justify-end px-6 py-4">
          <button onClick={onClose} className="neu-btn-soft h-[38px]">关闭</button>
        </div>
      </div>
    </div>
  );
}
