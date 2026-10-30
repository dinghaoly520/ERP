'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Activity, AlertTriangle, Cpu, Database, HardDrive, RefreshCw, ScanText, ScrollText, Server } from 'lucide-react';
import { fetchCurrentUser } from '@/lib/api/auth';
import { fmtBytes, fmtSecAgo, healthApi, type HealthReport } from '@/components/admin/health/health-api';
import { OverviewTab } from '@/components/admin/health/overview-tab';
import { OperationLogTab } from '@/components/admin/health/operation-log-tab';

/* ═══════════════════════════════════════════════════════════════
   系统健康——巡检 + 排查 + 审计工作台（2026-10-30 合并操作日志）
   常驻巡检头：hero + 探活瓷片 ×5（第一眼健康状态）
   分区 Tab（page-tab 体系，?tab=overview|log 可深链）：
     运行总览 = 24h 趋势 + 错误/慢接口榜 + AI 队列（2026-10-28 设计）
     操作日志 = 全站操作审计查询（admin 可见，首次激活才加载）
   ═══════════════════════════════════════════════════════════════ */

/** 探活瓷片：label + 状态徽标（pill 可覆盖）+ 实质指标副行 */
function ProbeTile({ icon, name, probe, sub, pill }: {
  icon: React.ReactNode; name: string;
  probe?: { ok: boolean; latencyMs: number; error?: string };
  sub?: string; pill?: string;
}) {
  return (
    <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
          {icon} {name}
        </span>
        {probe && (
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${probe.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
            <span className={`h-1 w-1 rounded-full ${probe.ok ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`} />
            {probe.ok ? (pill ?? `${probe.latencyMs}ms`) : '异常'}
          </span>
        )}
      </div>
      <span className="text-xs font-medium text-[var(--foreground)]" title={probe && !probe.ok ? probe.error : undefined}>
        {probe ? (probe.ok ? (sub ?? '运行正常') : (probe.error ?? sub ?? '不可用')) : '检测中…'}
      </span>
    </div>
  );
}

type TabKey = 'overview' | 'log';

function HealthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: TabKey = searchParams.get('tab') === 'log' ? 'log' : 'overview';

  const [data, setData] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await healthApi<HealthReport>('/health')); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { fetchCurrentUser().then((u) => setIsAdmin(u.role === 'admin')).catch(() => {}); }, []);

  const switchTab = (next: TabKey) => {
    if (next === tab) return;
    router.replace(`/admin/health?tab=${next}`, { scroll: false });
  };

  // 日志 Tab 仅 admin：非 admin（含 role 未解析的短暂窗口）手输 ?tab=log 时
  // 兜底显示总览——防止内容区空白；admin 解析完成后自然切到日志
  const effectiveTab: TabKey = tab === 'log' && !isAdmin ? 'overview' : tab;

  const probes = useMemo(() => data
    ? [data.components.db, data.components.redis, data.components.minio, data.components.ocr]
    : [], [data]);
  const failCount = probes.filter((p) => p && !p.ok).length;

  return (
    <div className="space-y-5">
      {/* ═══ 常驻巡检头：page-hero + 探活瓷片 ═══ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Activity size={17} strokeWidth={1.9} /></div>
            <div>
              <div className="page-hero__title">系统健康</div>
              <div className="page-hero__sub">各服务组件运行状态、接口表现、分析任务与全站操作审计</div>
            </div>
          </div>
          <div className="page-hero__right">
            {data && (failCount > 0
              ? <span className="page-hero__stat page-hero__stat--warn"><span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--danger)]" />组件异常 {failCount}</span>
              : <span className="page-hero__stat page-hero__stat--info">组件 {probes.length - failCount}/{probes.length} 正常</span>)}
            {data && (
              <span className={`page-hero__stat ${data.worker.alive ? 'page-hero__stat--info' : 'page-hero__stat--warn'}`}>
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${data.worker.alive ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`} />
                {data.worker.alive ? `分析服务运行中（${data.worker.count} 个）` : '分析服务未运行'}
              </span>
            )}
            <button onClick={() => void reload()} disabled={loading} className="neu-btn-xs" aria-label="刷新">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="page-hero__divider" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <ProbeTile icon={<Database size={11} />} name="PostgreSQL" probe={data?.components.db}
            sub={data ? `连接 ${data.components.db.activeConns}/${data.components.db.maxConns} · 数据 ${fmtBytes(data.components.db.sizeBytes)}` : undefined} />
          <ProbeTile icon={<Server size={11} />} name="Redis" probe={data?.components.redis}
            sub={data ? `内存 ${fmtBytes(data.components.redis.usedMemoryBytes)} · 连接 ${data.components.redis.clients}` : undefined} />
          <ProbeTile icon={<HardDrive size={11} />} name="MinIO 对象存储" probe={data?.components.minio} />
          <ProbeTile icon={<ScanText size={11} />} name="OCR 识别服务"
            probe={data ? { ok: data.components.ocr.ok, latencyMs: data.components.ocr.replicas.find((r) => r.ok)?.latencyMs ?? 0 } : undefined}
            pill={data && data.components.ocr.ok ? `${data.components.ocr.replicas.find((r) => r.ok)?.latencyMs ?? 0}ms` : undefined}
            sub={data ? `副本 ${data.components.ocr.upCount}/${data.components.ocr.total} 可用` : undefined} />
          <ProbeTile icon={<Cpu size={11} />} name="分析服务" probe={data ? { ok: data.worker.alive, latencyMs: 0 } : undefined}
            pill={data ? (data.worker.alive ? `心跳 ${data.worker.lastBeatAgoSec ?? 0} 秒前` : '未运行') : undefined}
            sub={data ? (data.worker.alive
              ? `共 ${data.worker.count} 个进程在消费任务`
              : `最后心跳 ${data.worker.lastBeatAgoSec != null ? fmtSecAgo(data.worker.lastBeatAgoSec) : '无记录'}，任务将积压`) : undefined} />
        </div>
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><AlertTriangle size={22} className="text-[var(--danger)]" /></div>
          <p className="text-sm font-semibold text-[var(--danger)]">{error}</p>
          <button onClick={() => void reload()} className="neu-btn-soft"><RefreshCw size={15} />重试</button>
        </div>
      )}

      {!error && (
        <>
          {/* ═══ 分区 Tab（page-tab 体系，深链 ?tab=）═══ */}
          <div className="flex items-center gap-4" role="tablist" aria-label="系统健康视图">
            <button type="button" role="tab" aria-selected={effectiveTab === 'overview'}
              className={`page-tab ${effectiveTab === 'overview' ? 'is-active' : ''}`} onClick={() => switchTab('overview')}>
              运行总览
            </button>
            {isAdmin && (
              <button type="button" role="tab" aria-selected={effectiveTab === 'log'}
                className={`page-tab ${effectiveTab === 'log' ? 'is-active' : ''}`} onClick={() => switchTab('log')}>
                <span className="inline-flex items-center gap-1.5">操作日志 <ScrollText size={13} /></span>
              </button>
            )}
          </div>

          {/* Tab 内容区：一旦挂载保持（非激活 CSS 隐藏）——切回不丢总览弹层/日志筛选状态 */}
          <div className={effectiveTab === 'overview' ? '' : 'hidden'} aria-hidden={effectiveTab !== 'overview'}>
            <div className="space-y-5">
              <OverviewTab data={data} loading={loading} isAdmin={isAdmin} reload={reload} />
            </div>
          </div>
          {isAdmin && (
            <div className={effectiveTab === 'log' ? '' : 'hidden'} aria-hidden={effectiveTab !== 'log'}>
              <OperationLogTab active={effectiveTab === 'log'} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function HealthPage() {
  return (
    <Suspense fallback={null}>
      <HealthPageInner />
    </Suspense>
  );
}
