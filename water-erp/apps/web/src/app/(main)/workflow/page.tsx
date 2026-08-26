'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, Clock, Inbox, RefreshCw } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   流程中心（C1）— 五源审批统一收件箱（只读聚合，处理在原页面）
   数据管理页标准三层：page-hero + 工具栏 + neu-table-card
   ═══════════════════════════════════════════════════════════════ */

type WorkflowItem = {
  source: string;
  sourceId: string;
  category: string;
  title: string;
  applicant: string | null;
  submittedAt: string;
  deepLink: string;
  status: string;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待处理', APPROVED: '已通过', REJECTED: '已驳回', REVIEWING: '审核中',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING: 'text-amber-700', APPROVED: 'text-emerald-700', REJECTED: 'text-red-600', REVIEWING: 'text-sky-700',
};

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`/api/workflow${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return res.json();
}

function Section({ icon, title, sub, items, linkable }: {
  icon: React.ReactNode; title: string; sub: string; items: WorkflowItem[]; linkable: boolean;
}) {
  return (
    <section className="neu-table-card">
      <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-black/60">{icon}</span>
          <div>
            <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
            <p className="text-xs text-[var(--muted-foreground)]">{sub}</p>
          </div>
        </div>
        <span className="neu-tab-count">{items.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="neu-table w-full min-w-[760px]">
          <thead>
            <tr className="text-left">
              <th>分类</th>
              <th>事项</th>
              <th>申请人</th>
              <th>提交/处理时间</th>
              <th>状态</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={`${it.source}-${it.sourceId}`} className="row-clickable">
                <td className="whitespace-nowrap text-[var(--muted-foreground)]">{it.category}</td>
                <td>{it.title}</td>
                <td className="whitespace-nowrap text-[var(--foreground)]/70">{it.applicant ?? '—'}</td>
                <td className="whitespace-nowrap font-mono text-xs text-[var(--muted-foreground)]">
                  {new Date(it.submittedAt).toLocaleString('zh-CN', { hour12: false })}
                </td>
                <td className={`whitespace-nowrap text-xs font-medium ${STATUS_CLASS[it.status] ?? ''}`}>
                  {STATUS_LABEL[it.status] ?? it.status}
                </td>
                <td className="text-right">
                  <a href={it.deepLink} className={linkable ? 'neu-btn-xs' : 'text-xs text-[var(--muted-foreground)] underline underline-offset-2'}>
                    {linkable ? '去处理' : '查看'}
                  </a>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function WorkflowPage() {
  const [pending, setPending] = useState<WorkflowItem[]>([]);
  const [mine, setMine] = useState<WorkflowItem[]>([]);
  const [done, setDone] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, m, d] = await Promise.all([api<WorkflowItem[]>('/pending'), api<WorkflowItem[]>('/mine'), api<WorkflowItem[]>('/done')]);
      setPending(p); setMine(m); setDone(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const mineInFlight = mine.filter(i => i.status === 'PENDING').length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6">
      {/* ═══ page-hero ═══ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ClipboardList size={17} /></div>
            <div>
              <div className="page-hero__title">流程中心</div>
              <div className="page-hero__sub">五源审批统一收件箱：注册审核 · 安全审批 · 供应商变更 · 商城审批</div>
            </div>
          </div>
          <div className="page-hero__right">
            {pending.length > 0 && (
              <span className="page-hero__stat page-hero__stat--warn">
                <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--danger)]" />
                待办 {pending.length}
              </span>
            )}
            <button onClick={() => void reload()} className="neu-btn-xs" title="刷新">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)', paddingTop: '1rem' }} />

        <div className="grid grid-cols-3 gap-2">
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">待我审批</span>
              <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-[var(--warning)]">
                <span className="h-1 w-1 rounded-full bg-[var(--warning)]" />待处理
              </span>
            </div>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{pending.length}</span>
            <span className="text-[10px] font-medium text-[var(--muted-foreground)]">按登录角色聚合五源</span>
          </div>
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">我发起在途</span>
            </div>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{mineInFlight}</span>
            <span className="text-[10px] font-medium text-[var(--muted-foreground)]">密码/资料变更申请</span>
          </div>
          <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">最近已办</span>
              <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-[var(--success)]">
                <span className="h-1 w-1 rounded-full bg-[var(--success)]" />已闭环
              </span>
            </div>
            <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{done.length}</span>
            <span className="text-[10px] font-medium text-[var(--muted-foreground)]">各源最近 20 条</span>
          </div>
        </div>
      </div>

      {error && <p className="px-1 text-xs text-[var(--danger)]">{error}</p>}

      <Section icon={<Inbox size={15} />} title="待我审批" sub="按登录角色聚合，处理跳转原审批页" items={pending} linkable />
      <Section icon={<Clock size={15} />} title="我发起的" sub="本人提交的密码/资料变更申请" items={mine} linkable={false} />
      <Section icon={<CheckCircle2 size={15} />} title="最近已办" sub="各审批源最近 20 条处理记录" items={done} linkable={false} />
    </div>
  );
}
