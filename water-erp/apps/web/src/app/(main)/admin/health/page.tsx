'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Cpu, Database, HardDrive, RefreshCw, ScanText, Server } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/api-fetch';
import { fetchCurrentUser } from '@/lib/api/auth';
import { Modal, TableSkeleton } from '@/components/workbench';

/* ═══════════════════════════════════════════════════════════════
   系统健康——巡检 + 排查工作台（2026-10-28 重设计）
   上：组件实质指标 + 分析服务心跳；中：24 小时请求/错误趋势（双泳道，各自单轴）；
   下：错误与慢接口榜（可下钻样例）、分析任务队列（失败可操作）
   ═══════════════════════════════════════════════════════════════ */

type Probe = { ok: boolean; latencyMs: number; error?: string };
type HealthReport = {
  checkedAt: string;
  components: {
    db: Probe & { activeConns: number; maxConns: number; sizeBytes: number };
    redis: Probe & { usedMemoryBytes: number; clients: number; uptimeSec: number };
    minio: Probe;
    ocr: { ok: boolean; upCount: number; total: number; replicas: Array<{ url: string; ok: boolean; latencyMs: number }> };
  };
  api24h: { total: number; errors: number; errorRate: number; p95ms: number; series: Array<{ hour: string; total: number; errors: number }> };
  topErrors: Array<{ method: string; route: string; count: number; lastAt: string | null }>;
  topSlow: Array<{ method: string; path: string; count: number; p95ms: number; maxMs: number }>;
  queues: Record<'tenderProcessing' | 'bidderProcessing', {
    waiting: number; active: number; failed: number; lastFinishedAt: string | null;
    failedJobs: Array<{ id: string; name: string; failedReason: string; failedAt: string | null; attempts: number }>;
  } | null>;
  worker: { alive: boolean; count: number; lastBeatAgoSec: number | null };
};
type RecentError = { method: string; path: string; statusCode: number; durationMs: number; createdAt: string; ipAddress: string | null };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/system-config${path}`, {
    ...init, credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return res.json();
}

const fmtBytes = (n: number): string =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(0)} MB` : `${(n / 1024).toFixed(0)} KB`;
const fmtAgo = (iso: string | null): string => {
  if (!iso) return '—';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} 小时前` : `${Math.floor(h / 24)} 天前`;
};
/** 秒距 → 人话（渲染期纯算术，不取当前时刻） */
const fmtSecAgo = (s: number): string =>
  s < 90 ? `${s} 秒前` : s < 5400 ? `${Math.round(s / 60)} 分钟前` : `${Math.round(s / 3600)} 小时前`;

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

/** 24 小时趋势：上泳道请求量面积线、下泳道错误柱（小倍数，各自单轴，共享时间轴） */
function TrendChart({ series }: { series: HealthReport['api24h']['series'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, L1_H = 96, GAP = 20, L2_H = 56, H = L1_H + GAP + L2_H;
  const RULE = 'oklch(0.6 0.04 258 / 0.16)';
  const maxTotal = Math.max(1, ...series.map((s) => s.total));
  const maxErr = Math.max(1, ...series.map((s) => s.errors));
  const colW = W / Math.max(1, series.length);
  const x = (i: number) => (i + 0.5) * colW;
  const y1 = (v: number) => L1_H - (v / maxTotal) * (L1_H - 10);      // 泳道1底=基线
  const y2 = (v: number) => H - (v / maxErr) * (L2_H - 8);            // 泳道2底=基线
  const areaPath = `M0,${L1_H} ` + series.map((s, i) => `L${x(i).toFixed(1)},${y1(s.total).toFixed(1)}`).join(' ') + ` L${W},${L1_H} Z`;
  const linePath = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y1(s.total).toFixed(1)}`).join(' ');
  const barW = colW * 0.55;
  const h = hover != null ? series[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full" role="img" aria-label="近 24 小时请求量与错误趋势">
        {/* 泳道标题（文字用文字色，不抢数据） */}
        <text x="4" y="12" fontSize="10" fill="var(--muted-foreground)">请求量</text>
        <text x="4" y={L1_H + GAP - 8} fontSize="10" fill="var(--muted-foreground)">错误数</text>
        {/* 泳道1：请求量（面积 + 2px 线） */}
        <line x1="0" x2={W} y1={L1_H} y2={L1_H} stroke={RULE} strokeWidth="1" />
        <path d={areaPath} fill="var(--brand)" opacity="0.12" />
        <path d={linePath} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" />
        {/* 泳道2：错误柱（细柱、贴基线、小圆角） */}
        <line x1="0" x2={W} y1={H} y2={H} stroke={RULE} strokeWidth="1" />
        {series.map((s, i) => s.errors > 0 && (
          <rect key={`e-${i}`} x={x(i) - barW / 2} y={y2(s.errors)} width={barW} height={H - y2(s.errors)}
            fill="var(--danger)" opacity="0.75" rx="2" />
        ))}
        {/* 悬停十字线 */}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="var(--brand)" strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />}
        {/* 命中区：整列高（大于标记本身） */}
        {series.map((_, i) => (
          <rect key={`hit-${i}`} x={i * colW} y="0" width={colW} height={H} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 z-10 flex min-w-[92px] flex-col gap-0.5 rounded-[10px] bg-[oklch(1_0_0_/_0.96)] px-2.5 py-1.5 text-[11px] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.8),2px_2px_6px_oklch(0.55_0.03_258_/_0.14)]"
          style={{ left: `min(max(${((hover! + 0.5) / series.length) * 100}%, 9%), 91%)`, transform: 'translateX(-50%)' }}>
          <div className="font-semibold text-[var(--foreground)]">{h.hour}</div>
          <div className="flex items-center gap-1.5 text-[var(--foreground)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />请求 {h.total}</div>
          <div className="flex items-center gap-1.5 text-[var(--foreground)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" />错误 {h.errors}</div>
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10px] text-[var(--muted-foreground)]">
        <span>{series[0]?.hour}</span><span>现在</span>
      </div>
    </div>
  );
}

export default function HealthPage() {
  const [data, setData] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errDetail, setErrDetail] = useState<{ open: boolean; rows: RecentError[]; loading: boolean; route?: string }>({ open: false, rows: [], loading: false });
  const [confirmAct, setConfirmAct] = useState<null | { kind: 'retry' | 'clear'; queue: 'tender' | 'bidder'; failed: number }>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api<HealthReport>('/health')); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { fetchCurrentUser().then((u) => setIsAdmin(u.role === 'admin')).catch(() => {}); }, []);

  const openErrDetail = async (route?: string) => {
    setErrDetail({ open: true, rows: [], loading: true, route });
    try { setErrDetail({ open: true, rows: await api<RecentError[]>('/recent-errors?limit=20'), loading: false, route }); }
    catch (e) { setError((e as Error).message); setErrDetail((s) => ({ ...s, loading: false })); }
  };

  const runQueueAction = async (kind: 'retry' | 'clear', queue: 'tender' | 'bidder') => {
    setBusy(true);
    try {
      const r = await api<{ retried?: number; skipped?: number; cleaned?: number }>(`/queue/${queue}/${kind === 'retry' ? 'retry-failed' : 'clear-failed'}`, { method: 'POST' });
      setConfirmAct(null);
      void reload();
      toast.success(kind === 'retry'
        ? `已重新排队 ${r.retried ?? 0} 个任务${r.skipped ? `，${r.skipped} 个未能重试` : ''}`
        : `已清除 ${r.cleaned ?? 0} 条失败记录`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const probes = useMemo(() => data
    ? [data.components.db, data.components.redis, data.components.minio, data.components.ocr]
    : [], [data]);
  const failCount = probes.filter((p) => p && !p.ok).length;
  const queues = useMemo(() => [
    { key: 'tender' as const, name: '招标文件解析', q: data?.queues.tenderProcessing },
    { key: 'bidder' as const, name: '投标书逐项分析', q: data?.queues.bidderProcessing },
  ], [data]);
  const waitingTotal = (data?.queues.tenderProcessing?.waiting ?? 0) + (data?.queues.bidderProcessing?.waiting ?? 0);

  return (
    <div className="space-y-5">
      {/* ═══ page-hero ═══ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Activity size={17} strokeWidth={1.9} /></div>
            <div>
              <div className="page-hero__title">系统健康</div>
              <div className="page-hero__sub">各服务组件运行状态、近 24 小时接口表现与分析任务积压情况</div>
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
          {/* ═══ 24h 趋势（双泳道）═══ */}
          <div className="wb-panel p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold tracking-wide">近 24 小时请求与错误趋势</span>
              {data && (
                <span className="text-xs text-[var(--muted-foreground)]" title="登录会话的业务请求全量（含高频轮询）；未登录/无权限的拒绝不在此列">
                  共 {data.api24h.total.toLocaleString()} 次 · 错误 {data.api24h.errors} 次（{data.api24h.errorRate}%） · P95 耗时 {data.api24h.p95ms} ms（95% 的请求耗时低于此值）
                </span>
              )}
            </div>
            {loading ? <TableSkeleton cols={6} rows={2} /> : (
              data && data.api24h.total === 0
                ? <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">全量计数自功能上线起累积，暂无数据</p>
                : <TrendChart series={data!.api24h.series} />
            )}
          </div>

          {/* ═══ 接口表现：错误榜 + 慢接口榜 ═══ */}
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="neu-table-card">
              <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold tracking-wide">今日错误最多的接口</span>
                <button onClick={() => void openErrDetail()} className="neu-btn-xs" disabled={loading}>查看最近错误</button>
              </div>
              <div className="overflow-x-auto">
                <table className="neu-table w-full min-w-[480px]">
                  <thead><tr><th>接口</th><th>错误次数</th><th>最近发生</th></tr></thead>
                  <tbody>
                    {loading ? <TableSkeleton cols={3} rows={4} /> : (data?.topErrors ?? []).length === 0 ? (
                      <tr><td colSpan={3} className="py-8 text-center text-xs text-[var(--muted-foreground)]">今日暂无错误</td></tr>
                    ) : (data?.topErrors ?? []).map((e) => (
                      <tr key={`${e.method}-${e.route}`} className="row-clickable" onClick={() => void openErrDetail(`${e.method} ${e.route}`)}>
                        <td className="max-w-[280px] truncate text-left font-mono text-xs" title={`${e.method} ${e.route}`}>{e.method} {e.route}</td>
                        <td className="font-mono tabular-nums text-[var(--danger)]">{e.count}</td>
                        <td className="text-xs text-[var(--muted-foreground)]">{fmtAgo(e.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="neu-table-card">
              <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold tracking-wide">耗时最长的接口</span>
                <span className="text-xs text-[var(--muted-foreground)]">近 24 小时 · 操作日志口径</span>
              </div>
              <div className="overflow-x-auto">
                <table className="neu-table w-full min-w-[480px]">
                  <thead><tr><th>接口</th><th>95% 请求耗时</th><th>最慢</th><th>次数</th></tr></thead>
                  <tbody>
                    {loading ? <TableSkeleton cols={4} rows={4} /> : (data?.topSlow ?? []).length === 0 ? (
                      <tr><td colSpan={4} className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无数据</td></tr>
                    ) : (data?.topSlow ?? []).map((s) => (
                      <tr key={`${s.method}-${s.path}`}>
                        <td className="max-w-[280px] truncate text-left font-mono text-xs" title={`${s.method} ${s.path}`}>{s.method} {s.path}</td>
                        <td className="font-mono tabular-nums">{s.p95ms} ms</td>
                        <td className="font-mono tabular-nums text-[var(--muted-foreground)]">{s.maxMs} ms</td>
                        <td className="font-mono tabular-nums">{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ═══ 分析任务队列 ═══ */}
          <div className="neu-table-card">
            <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold tracking-wide">AI 分析任务队列</span>
              {isAdmin && <span className="text-xs text-[var(--muted-foreground)]">失败任务可重试或清除记录</span>}
            </div>
            {data && !data.worker.alive && waitingTotal > 0 && (
              <div className="wb-alert wb-alert--warning mx-4 mt-3">分析服务未运行，{waitingTotal} 个任务正在等待——请到部署机上启动分析服务进程</div>
            )}
            <div className="overflow-x-auto">
              <table className="neu-table w-full min-w-[860px]">
                <thead><tr><th>队列</th><th>等待中</th><th>执行中</th><th>失败</th><th>最近完成</th><th>操作</th></tr></thead>
                <tbody>
                  {loading ? <TableSkeleton cols={6} rows={2} /> : queues.map(({ key, name, q }) => q == null ? (
                    <tr key={key}><td colSpan={6} className="py-6 text-center text-xs text-[var(--muted-foreground)]">{name}：队列数据不可用</td></tr>
                  ) : (
                    <Fragment key={key}>
                      <tr className="row-clickable">
                        <td className="font-medium">{name}</td>
                        <td className={`font-mono tabular-nums ${q.waiting > 0 && !data?.worker.alive ? 'text-[var(--warning)]' : ''}`}>{q.waiting}</td>
                        <td className="font-mono tabular-nums">{q.active}</td>
                        <td className={`font-mono tabular-nums ${q.failed > 0 ? 'text-[var(--danger)]' : ''}`}>{q.failed}</td>
                        <td className="text-xs text-[var(--muted-foreground)]">{fmtAgo(q.lastFinishedAt)}</td>
                        <td>
                          {isAdmin && q.failed > 0 && (
                            <div className="flex justify-center gap-1.5">
                              <button onClick={() => setConfirmAct({ kind: 'retry', queue: key, failed: q.failed })} className="neu-btn-xs is-warning" disabled={busy}>重试失败</button>
                              <button onClick={() => setConfirmAct({ kind: 'clear', queue: key, failed: q.failed })} className="neu-btn-xs is-danger" disabled={busy}>清除失败记录</button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {q.failedJobs.map((j) => (
                        <tr key={j.id}>
                          <td colSpan={6} className="py-2 text-left text-xs text-[var(--muted-foreground)]">
                            <span className="font-mono">{j.name ?? j.id}</span>
                            <span className="mx-2">·</span>尝试 {j.attempts} 次
                            <span className="mx-2">·</span>{fmtAgo(j.failedAt)}
                            <span className="mx-2">·</span><span className="text-[var(--danger)]">{j.failedReason || '无失败原因'}</span>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 错误样例弹层 */}
      <Modal open={errDetail.open} onClose={() => setErrDetail((s) => ({ ...s, open: false }))} title="最近错误明细" description="近 24 小时内最近 20 条错误记录（状态码 400 及以上）">
        {errDetail.route && <p className="mb-2 text-xs text-[var(--muted-foreground)]">高亮行与所点接口匹配：{errDetail.route}</p>}
        {errDetail.loading ? <TableSkeleton cols={4} rows={4} /> : errDetail.rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">暂无错误记录</p>
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {errDetail.rows.map((r, i) => {
              // 所点行是路由模式（/:id），明细行是原始路径——模式化匹配才能命中
              const hit = (() => {
                if (!errDetail.route) return false;
                const sp = errDetail.route.indexOf(' ');
                if (sp < 0 || r.method !== errDetail.route.slice(0, sp)) return false;
                const re = new RegExp(`^${errDetail.route.slice(sp + 1).replace(/:[^/]+/g, '[^/]+')}$`);
                return re.test(r.path);
              })();
              return (
                <div key={i} className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[10px] px-3 py-2 text-xs ${hit ? 'bg-[color-mix(in_oklch,var(--warning)_10%,transparent)]' : 'bg-[oklch(0.975_0.012_258_/_0.6)]'}`}>
                  <span className={`font-mono font-semibold ${r.statusCode >= 500 ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`}>{r.statusCode}</span>
                  <span className="font-mono text-[var(--foreground)]">{r.method} {r.path}</span>
                  <span className="text-[var(--muted-foreground)]">{new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })} · {r.durationMs}ms{r.ipAddress ? ` · ${r.ipAddress}` : ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* 队列操作确认 */}
      <Modal open={confirmAct != null} onClose={() => setConfirmAct(null)}
        title={confirmAct?.kind === 'retry' ? '重试失败任务' : '清除失败记录'}
        footer={
          <>
            <button onClick={() => setConfirmAct(null)} className="neu-btn-soft !h-9 !text-xs" disabled={busy}>取消</button>
            <button onClick={() => void runQueueAction(confirmAct!.kind, confirmAct!.queue)}
              className={`neu-btn-soft !h-9 !text-xs ${confirmAct?.kind === 'retry' ? 'is-warning' : 'is-danger'}`} disabled={busy}>
              {confirmAct?.kind === 'retry' ? '确认重试' : '确认清除'}
            </button>
          </>
        }>
        {confirmAct && (
          <p className="text-sm leading-relaxed">
            {confirmAct.kind === 'retry'
              ? <>将把「{queues.find((qq) => qq.key === confirmAct.queue)?.name}」队列中最近 500 个以内的 {confirmAct.failed} 个失败任务重新排队执行。已有结果的任务重跑会产生新的分析记录。</>
              : <>将清除该队列 {confirmAct.failed} 条失败记录。<strong className="text-[var(--danger)]">清除后不可恢复</strong>，仅在确认这些失败不再需要处理时使用。</>}
          </p>
        )}
      </Modal>
    </div>
  );
}
