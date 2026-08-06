'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import { TableSkeleton } from '@/components/skeleton';
import ProjectTabs, { TABS, getDefaultTab, isTabAllowed, type TabDef } from '@/components/workspace/project-tabs';
import { OpeningHall } from '@/components/opening-hall';
import { SupervisionView, type SupervisionLog } from '@/components/bid/supervision-view';
import EvaluationView from '@/components/workspace/evaluation-view';
import ScoreStandardView from '@/components/workspace/score-standard-view';
import { RoundBlock } from '@/components/workspace/round-block';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { useOpeningSfx } from '@/hooks/use-opening-sfx';
import { useReportRealtime } from '@/contexts/bid-realtime-context';
import type { AnomalyDetectedPayload } from '@water-erp/shared';
import { toast } from 'sonner';

/* 面包屑末段标签：工作区 tab key → 中文名（对齐 :3004 sp-breadcrumb 语义）*/
const TAB_LABELS: Record<TabDef['key'], string> = {
  open: '开标大厅',
  supervise: '监督视图',
  evaluate: '评标管理',
  standard: '评分标准',
  quotes: '报价轮次',
};


function WorkspaceInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  // 页级单源：context 仅取 projectId；project 数据 + 实时全部由本页持有。
  const { projectId } = useBidProjectContext();

  // ═══ project 数据（唯一显示源）═══
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ═══ 跨 tab 常驻的实时数据（监督日志 / 异常事件）═══
  const [liveLogs, setLiveLogs] = useState<SupervisionLog[]>([]);
  const [anomalyEvents, setAnomalyEvents] = useState<AnomalyDetectedPayload[]>([]);

  // ═══ Audio（从 opening-hall 上提：解密音效由页级 socket 驱动，跨 tab 常驻）═══
  const sfx = useOpeningSfx();
  const seenDecrypt = useRef<Set<string>>(new Set());

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    setLoading(true);
    try {
      const p = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
      setProject(p);
    } catch (e: any) {
      setError(e?.message || '加载项目数据失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setLiveLogs([]);
    setAnomalyEvents([]);
    loadProject();
  }, [projectId, loadProject]);

  // ═══ 当前 tab ═══
  const stage = project?.stage ?? 'DOWNLOAD';
  const requested = searchParams.get('tab') as TabDef['key'] | null;
  const hasRoundMode = !!project?.roundMode;
  const current: TabDef['key'] =
    requested && TABS.some(t => t.key === requested && isTabAllowed(t, stage, hasRoundMode))
      ? requested
      : getDefaultTab(stage);

  const switchTab = useCallback((key: TabDef['key']) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', key);
    router.replace(`/bid/project/${projectId}?${next.toString()}`, { scroll: false });
  }, [router, projectId, searchParams]);

  // ═══ 解密倒计时提示音（补回旧开标大厅行为）：大厅 tab 且解密窗口在计时时，剩余 ≤60s 每秒 tick、
  // 剩余 300s 时 warning 一次。tab / decryptWindowEnd 变化即 clearInterval 重建，卸载清除；
  // sfx 每渲染新建但仅读稳定的 audioCtxRef，行为等效，故不入依赖。视觉圆环仍在 hall（serverTimeOffset），
  // 本音效用客户端 now，精度足够。═══
  const decryptWindowEnd = project?.openingSession?.decryptWindowEnd;
  useEffect(() => {
    if (current !== 'open' || !decryptWindowEnd) return;
    const endMs = new Date(decryptWindowEnd).getTime();
    const timer = setInterval(() => {
      const r = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
      if (r > 0 && r <= 60) sfx.tick();
      else if (r === 300) sfx.warning();
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, decryptWindowEnd]);

  // ═══ 单一 WebSocket（页级持有，跨 tab 常驻）═══
  const { connection, lastEventAt, reconnectNow } = useBidWebSocket(projectId ?? undefined, {
    onDecryptStatus: (data) => {
      setProject(prev => {
        if (!prev) return prev;
        // 音效 + toast 仅在开标大厅 tab 触发（沿用 opening-hall 的 seenDecrypt 去重思路）
        if (current === 'open') {
          if (data.decryptStatus === 'SUCCESS') sfx.decryptSuccess();
          else if (data.decryptStatus === 'DANGER') sfx.decryptFail();
        }
        const supplier = prev.suppliers.find(s => s.id === data.supplierId);
        if (current === 'open' && supplier && supplier.decryptStatus !== data.decryptStatus) {
          const key = `${data.supplierId}-${data.decryptStatus}`;
          if (!seenDecrypt.current.has(key)) {
            seenDecrypt.current.add(key);
            if (data.decryptStatus === 'SUCCESS') {
              toast.success(`🔓 ${supplier.supplierName} 解密成功`, { duration: 3000 });
            } else if (data.decryptStatus === 'DANGER') {
              toast.error(`⚠️ ${supplier.supplierName} 解密失败`, { duration: 5000 });
            }
          }
        }
        // 无论当前 tab：内联更新解密状态，保证切回大厅即时 UI
        return {
          ...prev,
          suppliers: prev.suppliers.map(s =>
            s.id === data.supplierId ? { ...s, decryptStatus: data.decryptStatus } : s,
          ),
        };
      });
    },
    onStageChange: () => { loadProject(); },
    onOpeningConfirmed: (d) => {
      loadProject();
      if (current === 'open') toast.success(`${d.supplierName} 已确认开标记录`);
    },
    // T9：移交完成（含 :3005 侧或水叮当触发的 complete-opening）→ refetch，横幅切已移交态
    onOpeningCompleted: () => { loadProject(); },
    // H2: 轮次状态变更——刷新项目数据（含 currentRoundNo + RoundBlock）
    onRoundStatusChange: () => { loadProject(); },
    onOpeningDisputed: (d) => {
      loadProject();
      toast.warning(`${d.supplierName} 提出开标异议：${d.reason}`);
    },
    // 监督日志与异常事件：不限 tab 常驻累积，供监督视图消费
    onSupervisionLog: (data) => {
      setLiveLogs(prev => [data as unknown as SupervisionLog, ...prev].slice(0, 100));
    },
    onAnomalyDetected: (data) => {
      if (data.severity === 'danger') toast.error(data.detail ?? '检测到异常');
      else toast.warning(data.detail ?? '检测到异常');
      setAnomalyEvents(prev => [data, ...prev].slice(0, 50));
    },
  });

  useReportRealtime(connection, lastEventAt, reconnectNow);

  if (loading && !project) return <TableSkeleton rows={8} cols={6} />;
  if (error && !project) return <div className="py-20 text-center text-sm text-[color:var(--muted-foreground)]">{error}</div>;

  return (
    <div className="space-y-5">
      {project && (
        <nav className="sp-breadcrumb" aria-label="面包屑">
          <Link className="sp-breadcrumb-link" href="/bid">开标任务板</Link>
          <span className="sp-breadcrumb-sep">/</span>
          <span className="sp-breadcrumb-current">{project.projectCode} · {project.name}</span>
          <span className="sp-breadcrumb-sep">/</span>
          <span className="sp-breadcrumb-current">{TAB_LABELS[current]}</span>
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectTabs stage={stage} current={current} onSwitch={switchTab} hasRoundMode={hasRoundMode} />
        <span className="text-[11px] text-[color:var(--muted-foreground)]">
          {project?.projectCode} · 评标管理 / 评分标准仅查看，流转操作在采购管理工作台（:3005）
        </span>
      </div>
      {!project ? (
        <div className="py-20 text-center text-[13px] tracking-tight text-[color:var(--muted-foreground)]">暂无项目数据</div>
      ) : (
        <>
          {current === 'open' && <OpeningHall project={project} onRefresh={loadProject} />}
          {current === 'supervise' && <SupervisionView projectId={projectId as string} project={project} liveLogs={liveLogs} anomalyEvents={anomalyEvents} />}
          {current === 'evaluate' && <EvaluationView projectId={projectId as string} project={project} />}
          {current === 'standard' && <ScoreStandardView projectId={projectId as string} project={project} />}
          {current === 'quotes' && <RoundBlock bidProjectId={projectId as string} detail={project} onChanged={loadProject} />}
        </>
      )}
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
