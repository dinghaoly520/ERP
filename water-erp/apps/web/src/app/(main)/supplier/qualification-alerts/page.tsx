'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, RefreshCw, CheckSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getQualificationAlerts, acknowledgeQualificationAlert } from '@/lib/api/supplier';
import type { QualificationAlerts, QualificationAlertItem } from '@/lib/api/supplier';

export default function QualificationAlertsPage() {
  const router = useRouter();
  const [data, setData] = useState<QualificationAlerts | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [acking, setAcking] = useState<string | null>(null);
  const [batchAcking, setBatchAcking] = useState(false);
  // 本次会话内「临时撤销已处理」的 id 集合（仅前端显示用，不改动后端确认记录）。
  const [restoredIds, setRestoredIds] = useState<Set<string>>(new Set());
  // 批量选择
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    getQualificationAlerts().then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // 已处理 = 后端 acked 且本次未临时撤销。
  const isDismissed = (i: QualificationAlertItem) => i.acked && !restoredIds.has(i.id);

  const dismissItem = async (id: string) => {
    setAcking(id);
    try {
      await acknowledgeQualificationAlert(id);
      setRestoredIds(s => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
      toast.success('已标记为已处理');
      load();
    } catch (e: any) {
      toast.error(e?.message || '标记失败');
    } finally {
      setAcking(null);
    }
  };

  const batchAcknowledge = async () => {
    if (selectedIds.size === 0) { toast.error('请先选择需要处理的预警项'); return; }
    setBatchAcking(true);
    let done = 0; const errors: string[] = [];
    for (const id of selectedIds) {
      try { await acknowledgeQualificationAlert(id); done++; }
      catch (e: any) { errors.push(e?.message || '未知错误'); }
    }
    if (errors.length > 0) toast.error(`${done} 个成功，${errors.length} 个失败`);
    else toast.success(`已批量标记 ${done} 项为已处理`);
    setSelectedIds(new Set());
    setBatchAcking(false);
    load();
  };

  const unDismissAll = () => {
    setRestoredIds(new Set((data?.items || []).filter(i => i.acked).map(i => i.id)));
    toast.success('已在本会话内恢复显示（后端记录未清除）');
  };

  const toggleSelect = (id: string) => setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selectedIds.size === visibleCount) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(i => i.id)));
  };

  const filtered = (data?.items || [])
    .filter(i => !statusFilter || i.status === statusFilter)
    .filter(i => !isDismissed(i));

  const visibleCount = filtered.length;
  const dismissedCount = (data?.items || []).filter(isDismissed).length;

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
            <button onClick={() => { load(); toast.success('已刷新'); }} disabled={loading} className="neu-btn-xs gap-1"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
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
            <div className="flex-1" />
            {visibleCount > 0 && selectedIds.size > 0 && (
              <button onClick={batchAcknowledge} disabled={batchAcking} className="neu-btn-xs gap-1 is-success">
                <CheckSquare size={12} />{batchAcking ? '处理中...' : `批量已处理 (${selectedIds.size})`}
              </button>
            )}
          </div>

          {/* Table */}
          <div className="neu-table-card overflow-hidden">
            <table className="workbench-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    {visibleCount > 0 && (
                      <input type="checkbox" className="neu-checkbox" checked={selectedIds.size === visibleCount}
                        ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < visibleCount; }}
                        onChange={toggleAll} />
                    )}
                  </th>
                  <th>供应商</th><th>资质名称</th><th>类型</th><th>到期日</th><th>剩余</th><th>状态</th><th className="w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && !dismissedCount ? (
                  <tr><td colSpan={8} className="text-center text-[var(--muted-foreground)] py-8">暂无资质到期预警</td></tr>
                ) : filtered.length === 0 && dismissedCount > 0 ? (
                  <tr><td colSpan={8} className="text-center text-[var(--muted-foreground)] py-8">
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
                      <td onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="neu-checkbox" checked={selectedIds.has(q.id)}
                          onChange={() => toggleSelect(q.id)} />
                      </td>
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
                        <button onClick={() => dismissItem(q.id)} disabled={acking === q.id} className="neu-btn-xs gap-1" title="标记为已处理（入库，跨设备保留）">
                          <Check size={11} />{acking === q.id ? '处理中' : '已处理'}
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
