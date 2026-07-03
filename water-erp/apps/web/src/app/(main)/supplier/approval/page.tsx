'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { getSupplierList, approveSupplier, rejectSupplier, returnSupplier } from '@/lib/api/supplier';
import type { Supplier, SupplierListResponse } from '@/lib/types';
import { DataToolbar, MetricCard, PageHero, SectionCard, StatusBadge, TableSkeleton, EmptyState, Pagination } from '@/components/workbench';
import { Building2, ClipboardCheck, Check } from 'lucide-react';

const TABS: { key: 'PENDING' | 'RETURNED' | 'REJECTED'; label: string; tone: 'blue' | 'orange' | 'red' }[] = [
  { key: 'PENDING', label: '待审核', tone: 'blue' },
  { key: 'RETURNED', label: '退回补正', tone: 'orange' },
  { key: 'REJECTED', label: '审核不通过', tone: 'red' },
];

function SupplierApprovalPage() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get('status') as typeof TABS[number]['key'] | null;
  const tab = (tabParam && TABS.some(t => t.key === tabParam)) ? tabParam : 'PENDING';
  const page = parseInt(params.get('page') || '1', 10) || 1;
  const pageSize = parseInt(params.get('pageSize') || '20', 10) || 20;
  const setTab = (t: typeof TABS[number]['key']) => { const q = new URLSearchParams(params); q.set('status', t); q.delete('page'); router.push(`?${q.toString()}`); };
  const setPage = (p: number) => { const q = new URLSearchParams(params); q.set('page', String(p)); router.push(`?${q.toString()}`); };
  const setPageSize = (ps: number) => { const q = new URLSearchParams(params); q.set('pageSize', String(ps)); q.delete('page'); router.push(`?${q.toString()}`); };
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [counts, setCounts] = useState<Record<string, number>>({ PENDING: 0, RETURNED: 0, REJECTED: 0 });
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchApproving, setBatchApproving] = useState(false);
  const [actionModal, setActionModal] = useState<{ type: 'approve' | 'reject' | 'return'; supplier: Supplier } | null>(null);
  const [actionReason, setActionReason] = useState('');

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === data.items.length) setSelected(new Set());
    else setSelected(new Set(data.items.map(s => (s as Supplier).id)));
  };

  const batchApprove = async () => {
    if (selected.size === 0) return;
    if (!confirm(`确认批量通过 ${selected.size} 个供应商审核？`)) return;
    setBatchApproving(true);
    let done = 0;
    for (const id of selected) {
      try { await approveSupplier(id); done++; } catch { /* skip */ }
    }
    toast.success(`已批量通过 ${done} 个供应商`);
    setSelected(new Set());
    setBatchApproving(false);
    loadData();
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSupplierList({ status: tab, page, pageSize, sort: 'completeness' });
      setData(res);
    } catch { /* empty */ }
    setLoading(false);
  }, [tab, page, pageSize]);

  useEffect(() => {
    Promise.all([
      getSupplierList({ status: 'PENDING', page: 1, pageSize: 1 }),
      getSupplierList({ status: 'RETURNED', page: 1, pageSize: 1 }),
      getSupplierList({ status: 'REJECTED', page: 1, pageSize: 1 }),
    ]).then(([p, r, j]) => setCounts({ PENDING: p.total, RETURNED: r.total, REJECTED: j.total })).catch(() => {});
  }, [data]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAction = async () => {
    if (!actionModal) return;
    if (actionModal.type !== 'approve' && !actionReason.trim()) { toast.error('请填写处理原因'); return; }

    const { type, supplier: s } = actionModal;
    const reason = actionReason; // 在异步间隙前捕获
    const label = type === 'approve' ? '已通过' : type === 'reject' ? '已拒绝' : '已退回补正';
    const prevItems = data.items;

    // ── 乐观移除 ──
    setData(d => ({ ...d, items: d.items.filter(x => (x as Supplier).id !== s.id) }));
    setActionModal(null);
    setActionReason('');

    let cancelled = false;
    toast(`${label}「${s.name}」`, {
      description: '4 秒内可撤销',
      duration: 4000,
      action: { label: '撤销', onClick: () => { cancelled = true; setData(d => ({ ...d, items: prevItems })); } },
    });

    await new Promise(r => setTimeout(r, 4200));
    if (cancelled) return;

    // ── 真正调用 API ──
    try {
      if (type === 'approve') await approveSupplier(s.id);
      else if (type === 'reject') await rejectSupplier(s.id, reason);
      else if (type === 'return') await returnSupplier(s.id, reason);
      loadData();
    } catch (e: any) { toast.error(e?.message || '操作失败'); loadData(); }
  };


  return (
    <div className="space-y-6">
      <PageHero
         title="供应商审批"
        description="审核供应商注册申请，支持审核通过、退回补正和审核不通过。"
        tone="green" icon={<Building2 size={14} />}
      />

      {/* Tab counts */}
      <div className="grid gap-4 md:grid-cols-3">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`group text-left rounded-xl p-4 transition border ${
              tab === t.key ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[rgba(184,199,227,0.25)] hover:border-[rgba(96,139,239,0.3)]'
            }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#5a6d8a]">{t.label}</span>
              <StatusBadge tone={t.tone}>{counts[t.key]}</StatusBadge>
            </div>
            <p className="mt-2 text-3xl font-extrabold tabular-nums text-[#18243a]">{counts[t.key]}</p>
          </button>
        ))}
      </div>

      {/* Current tab header */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-[#18243a]">
          {TABS.find(t => t.key === tab)?.label}列表
          <span className="ml-2 text-xs font-normal text-[#5a6d8a]">共 {data.total} 条</span>
        </h2>
      </div>

      <SectionCard className="p-0">
        {selected.size > 0 && (
          <div className="flex items-center gap-3 bg-[#eff6ff] border-b border-[#bfdbfe] px-4 py-2.5">
            <span className="text-xs font-extrabold text-[#064ea2]">已选 {selected.size} 项</span>
            {tab !== 'REJECTED' && (
              <button onClick={batchApprove} disabled={batchApproving} className="btn-press neu-btn-soft is-success">
                <Check size={12} />{batchApproving ? '批量通过中...' : `批量通过`}
              </button>
            )}
            <button onClick={() => setSelected(new Set())} className="text-xs font-semibold text-[#5a6d8a] hover:text-[#18243a]">取消选择</button>
          </div>
        )}
        <table className="workbench-table w-full min-w-[750px]">
          <thead className="neu-thead [neu-thead text-[#5a6d8a] [&_th]:whitespace-nowrap_th]:whitespace-nowrap">
            <tr>
              <th className="px-4 py-3 w-10"><input type="checkbox" checked={data.items.length > 0 && selected.size === data.items.length} onChange={toggleAll} className="accent-[#064ea2]" /></th>
              <th className="px-4 py-3">企业名称</th>
              <th className="px-4 py-3 text-center">统一社会信用代码</th>
              <th className="px-4 py-3 text-center">企业类型</th>
              <th className="px-4 py-3 text-center">状态</th>
              <th className="px-4 py-3 text-center">申请时间</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton cols={7} rows={5} />
            ) : data.items.length === 0 ? (
              <tr><td colSpan={7}><EmptyState title={`暂无${TABS.find(t => t.key === tab)?.label || ''}申请`} description="供应商注册后待审核申请将出现在这里" /></td></tr>
            ) : data.items.map((s: Supplier) => (
              <tr key={s.id} className="row-clickable" onClick={() => router.push(`/supplier/${s.id}`)}>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="accent-[#064ea2]" /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#064ea2] text-xs font-extrabold text-white">
                      {s.name[0]}
                    </div>
                    <span className="text-sm font-bold text-[#18243a] cursor-pointer hover:text-[#064ea2] transition"
                      onClick={() => router.push(`/supplier/${s.id}`)}>{s.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center font-mono text-xs text-[#5a6d8a]">{s.creditCode || '—'}</td>
                <td className="px-4 py-3 text-center text-sm text-[#5a6d8a]">{s.enterpriseType || '—'}</td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge tone={s.status === 'PENDING' ? 'blue' : s.status === 'RETURNED' ? 'orange' : 'red'}>
                    {s.status === 'PENDING' ? '待审核' : s.status === 'RETURNED' ? '退回补正' : '审核不通过'}
                  </StatusBadge>
                  {s.status === 'RETURNED' && s.returnReason && (
                    <p className="mt-1 text-xs text-orange-600">退回原因：{s.returnReason}</p>
                  )}
                  {s.status === 'REJECTED' && s.rejectReason && (
                    <p className="mt-1 text-xs text-red-600">拒绝原因：{s.rejectReason}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-center text-sm text-[#5a6d8a]">{new Date(s.createdAt).toLocaleDateString('zh-CN')}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex justify-center gap-1.5">
                    <button onClick={(e) => { e.stopPropagation(); router.push(`/supplier/${s.id}`); }}
                      className="btn-press neu-btn-xs is-info">详情</button>
                    {tab !== 'REJECTED' && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); setActionModal({ type: 'approve', supplier: s }); }}
                          className="btn-press rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition">通过</button>
                        <button onClick={(e) => { e.stopPropagation(); setActionReason(''); setActionModal({ type: 'return', supplier: s }); }}
                          className="btn-press rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 border border-amber-200 hover:bg-amber-100 transition">退回</button>
                        <button onClick={(e) => { e.stopPropagation(); setActionReason(''); setActionModal({ type: 'reject', supplier: s }); }}
                          className="btn-press rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 border border-red-200 hover:bg-red-100 transition">拒绝</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Pagination total={data.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(ps) => { setPageSize(ps); setPage(1); }} />
      </SectionCard>

      {/* Action modal */}
      {actionModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setActionModal(null)}>
          <div className="modal-content glass-card w-full max-w-md rounded-2xl shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[var(--border)] px-6 py-4">
              <h3 className="text-base font-bold text-[#18243a]">
                {actionModal.type === 'approve' ? '确认审核通过' : actionModal.type === 'reject' ? '审核不通过' : '退回补正'}
              </h3>
              <p className="mt-1 text-xs text-[#5a6d8a]">供应商：<strong className="text-[#18243a]">{actionModal.supplier.name}</strong></p>
            </div>
            <div className="p-6">
              {actionModal.type !== 'approve' && (
                <textarea
                  value={actionReason}
                  onChange={e => setActionReason(e.target.value)}
                  placeholder={actionModal.type === 'return' ? '请填写退回补正原因...' : '请填写不通过原因...'}
                  className="w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm placeholder-[#94a3b8] h-24 resize-none focus:outline-none focus:border-[#064ea2]"
                />
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
              <button onClick={() => setActionModal(null)}
                className="neu-btn-soft">取消</button>
              <button
                onClick={handleAction}
                disabled={actionModal.type !== 'approve' && !actionReason.trim()}
                className={`neu-btn-soft ${
                  actionModal.type === 'approve' ? 'is-success' :
                  actionModal.type === 'return' ? 'is-warning' : 'is-danger'
                }`}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SupplierApprovalPageWrapper() {
  return <Suspense><SupplierApprovalPage /></Suspense>;
}
