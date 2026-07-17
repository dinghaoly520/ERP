'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Building2, Clock3, Check, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getQualificationAlerts } from '@/lib/api/supplier';
import type { QualificationAlerts, QualificationAlertItem } from '@/lib/api/supplier';

const DISMISSED_KEY = 'qual-alerts-dismissed';

export default function QualificationAlertsPage() {
  const router = useRouter();
  const [data, setData] = useState<QualificationAlerts | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getQualificationAlerts().then(setData).catch(() => {}).finally(() => setLoading(false));
    try {
      const saved = sessionStorage.getItem(DISMISSED_KEY);
      if (saved) setDismissedIds(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

  const dismissItem = (id: string) => {
    const next = new Set(dismissedIds);
    next.add(id);
    setDismissedIds(next);
    try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])); } catch {}
    toast.success('已标记为已处理');
  };

  const unDismissAll = () => {
    setDismissedIds(new Set());
    try { sessionStorage.removeItem(DISMISSED_KEY); } catch {}
    toast.success('已恢复全部预警');
  };

  const filtered = (data?.items || [])
    .filter(i => !statusFilter || i.status === statusFilter)
    .filter(i => !dismissedIds.has(i.id));

  const dismissedCount = (data?.items || []).filter(i => dismissedIds.has(i.id)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><AlertTriangle size={17} /></div>
            <div>
              <div className="page-hero__title">资质到期预警</div>
              <div className="page-hero__sub">监控供应商资质有效期，提前发现到期风险{dismissedCount > 0 ? `（已处理 ${dismissedCount} 项）` : ''}</div>
            </div>
          </div>
          <div className="page-hero__right">
            {dismissedCount > 0 && (
              <button onClick={unDismissAll} className="neu-btn-xs">恢复全部</button>
            )}
            <button onClick={() => router.push('/supplier/repository')} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回供应商库
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
      ) : data ? (
        <>
          {/* KPI */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: '已过期', value: data.expiredCount, tone: 'var(--danger)' },
              { label: '即将到期', value: data.expiringCount, tone: 'var(--warning)' },
              { label: '受影响供应商', value: data.affectedSupplierCount, tone: 'var(--accent)' },
            ].map(kpi => (
              <div key={kpi.label} className="neu-table-card p-4 text-center">
                <div className="text-xs text-[var(--muted-foreground)] mb-1">{kpi.label}</div>
                <div className="text-2xl font-extrabold tabular-nums" style={{ color: kpi.tone }}>{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="wb-toolbar !px-3 !py-2">
            {['', '即将过期', '已过期'].map(s => (
              <button key={s || 'all'} onClick={() => setStatusFilter(s)} className={`neu-tab text-[11px] !px-3 !py-1.5 ${statusFilter === s ? 'is-active' : ''}`}>
                {s || '全部'}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="neu-table-card overflow-hidden">
            <table className="workbench-table">
              <thead>
                <tr>
                  <th>供应商</th><th>资质名称</th><th>类型</th><th>到期日</th><th>剩余</th><th>状态</th><th className="w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && !dismissedCount ? (
                  <tr><td colSpan={7} className="text-center text-[var(--muted-foreground)] py-8">暂无资质到期预警</td></tr>
                ) : filtered.length === 0 && dismissedCount > 0 ? (
                  <tr><td colSpan={7} className="text-center text-[var(--muted-foreground)] py-8">
                    全部 {dismissedCount} 项预警已标记为已处理
                    <button onClick={unDismissAll} className="ml-2 text-[var(--accent)] hover:underline text-xs">恢复全部</button>
                  </td></tr>
                ) : filtered.map(q => {
                  const isExpired = q.status === '已过期';
                  const isExpiring = q.status === '即将过期';
                  const dayColor = isExpired ? 'var(--danger)' : isExpiring ? 'var(--warning)' : 'var(--success)';
                  const urgency = q.daysRemaining === null ? 0 : Math.max(0, Math.min(100, 100 - (q.daysRemaining / 90) * 100));
                  return (
                    <tr key={q.id}>
                      <td><Link href={`/supplier/${q.supplierId}`} className="text-sm font-semibold text-[var(--foreground)] hover:text-[var(--accent)]">{q.supplierName}</Link></td>
                      <td className="text-sm">{q.name}</td>
                      <td className="text-sm text-[var(--muted-foreground)]">{q.type}</td>
                      <td className="text-sm tabular-nums">{q.validTo ? new Date(q.validTo).toLocaleDateString('zh-CN') : '—'}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-[var(--muted)]/30 max-w-[60px] overflow-hidden" title={q.daysRemaining !== null ? `紧迫度 ${urgency.toFixed(0)}%（以 90 天预警窗计）` : ''}>
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${urgency}%`, backgroundColor: dayColor }} />
                          </div>
                          <span className="text-[11px] tabular-nums font-semibold" style={{ color: dayColor }}>
                            {q.daysRemaining !== null ? `${q.daysRemaining} 天` : '—'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="rounded px-2 py-0.5 text-[10px] font-bold"
                          style={{ color: dayColor, backgroundColor: `color-mix(in_oklch,${dayColor}_12%,transparent)` }}>
                          {q.status}
                        </span>
                      </td>
                      <td>
                        <button onClick={() => dismissItem(q.id)} className="neu-btn-xs gap-1" title="标记为已处理">
                          <Check size={11} />已处理
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]">加载失败，请稍后重试</div>
      )}
    </div>
  );
}
