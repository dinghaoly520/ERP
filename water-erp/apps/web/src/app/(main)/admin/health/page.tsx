'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Database, HardDrive, RefreshCw, ScanText, Server, Download } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   系统健康（D6 · CTS 4.7~4.11 自我声明支撑）
   组件探活 + 24h 接口指标 + AI 队列深度 + 30 天自声明数据包下载
   ═══════════════════════════════════════════════════════════════ */

type Probe = { ok: boolean; latencyMs: number; error?: string; label?: string };
type HealthData = {
  checkedAt: string;
  components: { db: Probe; redis: Probe; minio: Probe; ocr: Probe & { label: string } };
  api24h: { total: number; errors: number; p95ms: number; errorRate: number };
  queues: {
    tenderProcessing: { waiting: number; active: number; failed: number } | null;
    bidderProcessing: { waiting: number; active: number; failed: number } | null;
  };
};

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`/api/system-config${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return res.json();
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<HealthData>('/health'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const downloadAssessment = async () => {
    try {
      const pkg = await api<Record<string, unknown>>('/health/self-assessment');
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `self-assessment-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ProbeCard = ({ icon, name, probe }: { icon: React.ReactNode; name: string; probe?: Probe }) => (
    <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
          {icon} {name}
        </span>
        {probe && (
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${probe.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
            <span className={`h-1 w-1 rounded-full ${probe.ok ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`} />
            {probe.ok ? `${probe.latencyMs}ms` : '异常'}
          </span>
        )}
      </div>
      {probe ? (
        probe.ok ? (
          <span className="text-[10px] font-medium text-[var(--muted-foreground)]">运行正常</span>
        ) : (
          <span className="truncate text-[10px] text-[var(--danger)]" title={probe.error}>{probe.error ?? '不可用'}</span>
        )
      ) : (
        <span className="text-[10px] text-[var(--muted-foreground)]">检测中…</span>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6">
      {/* ═══ page-hero ═══ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Activity size={17} /></div>
            <div>
              <div className="page-hero__title">系统健康</div>
              <div className="page-hero__sub">组件探活 · 接口 P95/错误率 · AI 队列深度（CTS 4.7~4.11 自我声明支撑）</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => void downloadAssessment()} className="neu-btn-soft text-xs">
              <Download size={13} /> 30 天自声明数据包
            </button>
            <button onClick={() => void reload()} className="neu-btn-xs" title="刷新">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)', paddingTop: '1rem' }} />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ProbeCard icon={<Database size={11} />} name="PostgreSQL" probe={data?.components.db} />
          <ProbeCard icon={<Server size={11} />} name="Redis" probe={data?.components.redis} />
          <ProbeCard icon={<HardDrive size={11} />} name="MinIO 对象存储" probe={data?.components.minio} />
          <ProbeCard icon={<ScanText size={11} />} name="OCR 微服务" probe={data?.components.ocr} />
        </div>
      </div>

      {error && <p className="px-1 text-xs text-[var(--danger)]">{error}</p>}

      <section className="neu-table-card">
        <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold tracking-wide">近 24 小时接口指标</span>
          {data && <span className="text-xs text-[var(--muted-foreground)]">检测于 {new Date(data.checkedAt).toLocaleString('zh-CN', { hour12: false })}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[560px]">
            <thead>
              <tr className="text-left"><th>指标</th><th>数值</th><th>口径</th></tr>
            </thead>
            <tbody>
              <tr className="row-clickable"><td>请求总数</td><td className="font-mono tabular-nums">{data?.api24h.total ?? '—'}</td><td className="text-xs text-[var(--muted-foreground)]">OperationLog 全量（含管理端）</td></tr>
              <tr><td>错误数（≥400）</td><td className="font-mono tabular-nums">{data?.api24h.errors ?? '—'}</td><td className="text-xs text-[var(--muted-foreground)]">HTTP 4xx/5xx</td></tr>
              <tr><td>错误率</td><td className="font-mono tabular-nums">{data ? `${data.api24h.errorRate}%` : '—'}</td><td className="text-xs text-[var(--muted-foreground)]">错误数 / 总数</td></tr>
              <tr><td>P95 耗时</td><td className="font-mono tabular-nums">{data ? `${data.api24h.p95ms} ms` : '—'}</td><td className="text-xs text-[var(--muted-foreground)]">percentile_cont(0.95)</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="neu-table-card">
        <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold tracking-wide">AI 投标分析队列（BullMQ）</span>
          <span className="text-xs text-[var(--muted-foreground)]">worker 未启动时任务积压于此</span>
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[560px]">
            <thead>
              <tr className="text-left"><th>队列</th><th>等待中</th><th>执行中</th><th>失败</th></tr>
            </thead>
            <tbody>
              {[
                { name: '招标文件解析', q: data?.queues.tenderProcessing },
                { name: '投标书逐项分析', q: data?.queues.bidderProcessing },
              ].map(({ name, q }) => (
                <tr key={name} className="row-clickable">
                  <td>{name}</td>
                  <td className="font-mono tabular-nums">{q?.waiting ?? '—'}</td>
                  <td className="font-mono tabular-nums">{q?.active ?? '—'}</td>
                  <td className={`font-mono tabular-nums ${q && q.failed > 0 ? 'text-[var(--danger)]' : ''}`}>{q?.failed ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
