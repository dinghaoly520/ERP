'use client';

import { Suspense, useEffect, useState } from 'react';
import { UsersRound, X, Loader2 } from 'lucide-react';
import { ExpertExtractPage } from '@/app/(main)/expert/extract/page';
import { getPmBidProject } from '@/lib/api/project-management';
import type { ProjectManagementItem } from '@/lib/types/project-management';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
};

export function ExpertExtractModal({ isOpen, onClose, project }: Props) {
  const [defaultPid, setDefaultPid] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // 直接通过项目管理项查对应的开评标项目 ID，不做任何匹配
  useEffect(() => {
    if (!isOpen || !project?.id) return;
    setResolving(true);
    getPmBidProject(project.id, project.currentRound ?? 1)
      .then((bp) => setDefaultPid(bp.id))
      .catch(() => setDefaultPid(null))
      .finally(() => setResolving(false));
  }, [isOpen, project?.id, project?.currentRound]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[500] flex flex-col">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
          style={{
            background:
              'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
              style={{
                background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)',
                boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)',
              }}
            >
              <UsersRound size={17} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] truncate">专家智能抽取</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">专业匹配 / 随机抽取 / 综合择优，AI 分析项目需求并智能组建专家组</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-soft !p-2">
            <X size={16} />
          </button>
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-auto px-5"
          style={{
            background: 'oklch(0.975 0.012 258 / 0.32)',
            boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)',
          }}
        >
          {resolving ? (
            <div className="flex min-h-[300px] items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" />
              定位开评标项目…
            </div>
          ) : (
            <Suspense fallback={
              <div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">加载专家抽取配置...</div>
            }>
              <ExpertExtractPage
                hideHeader
                defaultProjectTitle={project?.title}
                defaultPid={defaultPid}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
