'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { TableSkeleton } from '@/components/skeleton';
import ProjectTabs, { TABS, getDefaultTab, isTabAllowed, type TabDef } from '@/components/workspace/project-tabs';
import { OpeningHall } from '@/components/opening-hall';
import EvaluationView from '@/components/workspace/evaluation-view';
import ScoreStandardView from '@/components/workspace/score-standard-view';

function WorkspaceInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { project, isLoading, error, refetch } = useBidProjectContext();
  const projectId = params.id as string;

  const stage = project?.stage ?? 'DOWNLOAD';
  const requested = searchParams.get('tab') as TabDef['key'] | null;
  const current: TabDef['key'] =
    requested && TABS.some(t => t.key === requested && isTabAllowed(t, stage))
      ? requested
      : getDefaultTab(stage);

  const switchTab = useCallback((key: TabDef['key']) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', key);
    router.replace(`/bid/project/${projectId}?${next.toString()}`, { scroll: false });
  }, [router, projectId, searchParams]);

  if (isLoading && !project) return <TableSkeleton rows={8} cols={6} />;
  if (error && !project) return <div className="py-20 text-center text-sm text-[color:var(--muted-foreground)]">{error}</div>;
  if (!project) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectTabs stage={stage} current={current} onSwitch={switchTab} />
        <span className="text-[11px] text-[color:var(--muted-foreground)]">
          {project.projectCode} · 评标管理 / 评分标准仅查看，流转操作在采购管理工作台（:3005）
        </span>
      </div>
      {current === 'open' && <OpeningHall />}
      {current === 'evaluate' && <EvaluationView projectId={projectId} onRefresh={refetch} />}
      {current === 'standard' && <ScoreStandardView projectId={projectId} />}
    </div>
  );
}

export default function ProjectWorkspacePage() {
  return (
    <Suspense fallback={<TableSkeleton rows={8} cols={6} />}>
      <WorkspaceInner />
    </Suspense>
  );
}
