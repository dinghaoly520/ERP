'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Building2, Clock3, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getQualificationAlerts } from '@/lib/api/supplier';
import type { QualificationAlerts, QualificationAlertItem } from '@/lib/api/supplier';

export default function QualificationAlertsPage() {
  const router = useRouter();
  const [data, setData] = useState<QualificationAlerts | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getQualificationAlerts().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = data?.items.filter(i => !statusFilter || i.status === statusFilter) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><AlertTriangle size={17} /></div>
            <div><div className="page-hero__title">资质到期预警</div><div className="page-hero__sub">监控供应商资质有效期，提前发现到期风险</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/supplier/repository')} className="neu-btn-soft"><ArrowLeft size={15} />返回供应商库</button>
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
                  <th>供应商</th><th>资质名称</th><th>类型</th><th>到期日</th><th>剩余</th><th>状态</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-[var(--muted-foreground)] py-8">暂无数据</td></tr>
                ) : filtered.map(q => {
                  const isExpired = q.status === '已过期';
                  const isExpiring = q.status === '即将过期';
                  const dayColor = isExpired ? 'var(--danger)' : isExpiring ? 'var(--warning)' : 'var(--success)';
                  return (
                    <tr key={q.id}>
                      <td><Link href={`/supplier/${q.supplierId}`} className="text-sm font-semibold text-[var(--foreground)] hover:text-[var(--accent)]">{q.supplierName}</Link></td>
                      <td className="text-sm">{q.name}</td>
                      <td className="text-sm text-[var(--muted-foreground)]">{q.type}</td>
                      <td className="text-sm tabular-nums">{q.validTo ? new Date(q.validTo).toLocaleDateString('zh-CN') : '—'}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-[var(--muted)]/30 max-w-[60px] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, ((q.daysRemaining ?? 0) + 30) / 60 * 100)}%`, backgroundColor: dayColor }} />
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
