'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupplierList, approveSupplier, rejectSupplier, returnSupplier } from '@/lib/api/supplier';
import type { Supplier, SupplierListResponse } from '@/lib/types';
import { DataToolbar, PageHero, SectionCard, StatusBadge } from '@/components/workbench';
import { Building2 } from 'lucide-react';

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: '待审核', color: '#f5a623', bg: '#f5a62318' },
  RETURNED: { label: '退回补正', color: '#e67e22', bg: '#e67e2218' },
  APPROVED: { label: '已入库', color: '#11a874', bg: '#11a87418' },
  REJECTED: { label: '审核不通过', color: '#e74c3c', bg: '#e74c3c18' },
  DISABLED: { label: '已停用', color: '#95a5a6', bg: '#95a5a618' },
  BLACKLIST: { label: '黑名单', color: '#c0392b', bg: '#c0392b18' },
};

type TabKey = 'PENDING' | 'RETURNED' | 'REJECTED';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'PENDING', label: '待审核' },
  { key: 'RETURNED', label: '退回补正' },
  { key: 'REJECTED', label: '审核不通过' },
];

export default function SupplierApprovalPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('PENDING');
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [counts, setCounts] = useState<Record<TabKey, number>>({ PENDING: 0, RETURNED: 0, REJECTED: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [actionModal, setActionModal] = useState<{ type: 'approve' | 'reject' | 'return'; supplier: Supplier } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSupplierList({ status: tab, page, pageSize: 20 });
      setData(res);
    } catch { /* empty */ }
    setLoading(false);
  }, [tab, page]);

  // 三个待办分类的计数
  useEffect(() => {
    Promise.all([
      getSupplierList({ status: 'PENDING', page: 1, pageSize: 1 }),
      getSupplierList({ status: 'RETURNED', page: 1, pageSize: 1 }),
      getSupplierList({ status: 'REJECTED', page: 1, pageSize: 1 }),
    ]).then(([p, r, j]) => setCounts({ PENDING: p.total, RETURNED: r.total, REJECTED: j.total }))
      .catch(() => {});
  }, [data]);

  useEffect(() => { setPage(1); }, [tab]);
  useEffect(() => { loadData(); }, [loadData]);

  const handleAction = async () => {
    if (!actionModal) return;
    if (actionModal.type !== 'approve' && !actionReason.trim()) { alert('请填写处理原因'); return; }
    setActionLoading(true);
    try {
      const { type, supplier } = actionModal;
      if (type === 'approve') await approveSupplier(supplier.id);
      else if (type === 'reject') await rejectSupplier(supplier.id, actionReason);
      else if (type === 'return') await returnSupplier(supplier.id, actionReason);
      setActionModal(null);
      setActionReason('');
      loadData();
    } catch { /* empty */ }
    setActionLoading(false);
  };

  const totalPages = Math.ceil(data.total / 20);

  return (
    <div>
      <PageHero eyebrow="供应商管理中心" title="供应商审批" description="审核供应商注册申请：通过 / 退回补正 / 审核不通过。" tone="orange" icon={<Building2 size={14} />} />

      {/* 待办计数 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {TABS.map(t => {
          const st = statusMap[t.key];
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-left bg-white rounded-xl border p-5 transition ${tab === t.key ? 'border-[#064ea2] ring-1 ring-[#064ea2]' : 'border-[#e5ecf4] hover:border-[#bcd0e8]'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#5a6d8a]">{t.label}</span>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: st.color }} />
              </div>
              <p className="text-3xl font-bold mt-1" style={{ color: st.color }}>{counts[t.key]}</p>
            </button>
          );
        })}
      </div>

      {/* 当前分类列表 */}
      <div className="bg-white rounded-2xl border border-[#e5ecf4] p-5 mb-4 flex items-center justify-between">
        <h2 className="font-bold text-[#18243a]">
          {TABS.find(t => t.key === tab)?.label}列表
          <span className="ml-2 text-sm font-normal text-[#5a6d8a]">共 {data.total} 条</span>
        </h2>
      </div>

      <div className="bg-white rounded-xl border border-[#e5ecf4]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5ecf4] text-left text-[#5a6d8a]">
              <th className="px-5 py-3">企业名称</th>
              <th className="px-5 py-3">统一社会信用代码</th>
              <th className="px-5 py-3">企业类型</th>
              <th className="px-5 py-3">状态</th>
              <th className="px-5 py-3">申请时间</th>
              <th className="px-5 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-[#5a6d8a]">加载中...</td></tr>
            ) : data.items.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-[#5a6d8a]">暂无{TABS.find(t => t.key === tab)?.label}申请</td></tr>
            ) : data.items.map((s: Supplier) => {
              const st = statusMap[s.status] || { label: s.status, color: '#999', bg: '#99918' };
              return (
                <tr key={s.id} className="border-b border-[#e5ecf4] hover:bg-[#f8fafc]">
                  <td className="px-5 py-3 font-semibold text-[#064ea2] cursor-pointer" onClick={() => router.push(`/supplier/${s.id}`)}>{s.name}</td>
                  <td className="px-5 py-3 text-[#5a6d8a] font-mono text-xs">{s.creditCode || '—'}</td>
                  <td className="px-5 py-3 text-[#5a6d8a]">{s.enterpriseType || '—'}</td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: st.color, backgroundColor: st.bg }}>{st.label}</span>
                    {s.status === 'RETURNED' && s.returnReason && (
                      <div className="mt-1 text-xs text-[#e67e22]">退回原因：{s.returnReason}</div>
                    )}
                    {s.status === 'REJECTED' && s.rejectReason && (
                      <div className="mt-1 text-xs text-[#e74c3c]">拒绝原因：{s.rejectReason}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[#5a6d8a]">{new Date(s.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => router.push(`/supplier/${s.id}`)} className="px-2 py-1 text-xs text-[#064ea2] hover:bg-[#f0f6ff] rounded transition">详情</button>
                      {tab !== 'REJECTED' && (
                        <>
                          <button onClick={() => setActionModal({ type: 'approve', supplier: s })} className="px-2 py-1 text-xs text-white bg-[#11a874] hover:bg-[#0e8c5f] rounded transition">通过</button>
                          <button onClick={() => { setActionReason(''); setActionModal({ type: 'return', supplier: s }); }} className="px-2 py-1 text-xs text-white bg-[#f5a623] hover:bg-[#d9921e] rounded transition">退回</button>
                          <button onClick={() => { setActionReason(''); setActionModal({ type: 'reject', supplier: s }); }} className="px-2 py-1 text-xs text-white bg-[#e74c3c] hover:bg-[#c0392b] rounded transition">拒绝</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex justify-between items-center px-5 py-3 border-t border-[#e5ecf4]">
            <span className="text-xs text-[#5a6d8a]">共 {data.total} 条，第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-[#e5ecf4] rounded hover:bg-[#f8fafc] disabled:opacity-40 transition">上一页</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-[#e5ecf4] rounded hover:bg-[#f8fafc] disabled:opacity-40 transition">下一页</button>
            </div>
          </div>
        )}
      </div>

      {/* 操作弹窗 */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setActionModal(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[#18243a] mb-4">
              {actionModal.type === 'approve' && '确认审核通过'}
              {actionModal.type === 'reject' && '审核不通过'}
              {actionModal.type === 'return' && '退回补正'}
            </h3>
            <p className="text-sm text-[#5a6d8a] mb-3">供应商：<strong className="text-[#18243a]">{actionModal.supplier.name}</strong></p>
            {actionModal.type !== 'approve' && (
              <textarea
                value={actionReason}
                onChange={e => setActionReason(e.target.value)}
                placeholder={actionModal.type === 'return' ? '请填写退回补正原因...' : '请填写不通过原因...'}
                className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm mb-4 h-24 resize-none focus:outline-none focus:border-[#064ea2]"
              />
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setActionModal(null)} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f8fafc] rounded-lg transition">取消</button>
              <button
                onClick={handleAction}
                disabled={actionLoading || (actionModal.type !== 'approve' && !actionReason.trim())}
                className={`px-4 py-2 text-sm text-white rounded-lg transition disabled:opacity-50 ${
                  actionModal.type === 'approve' ? 'bg-[#11a874] hover:bg-[#0e8c5f]' :
                  actionModal.type === 'return' ? 'bg-[#f5a623] hover:bg-[#d9921e]' :
                  'bg-[#e74c3c] hover:bg-[#c0392b]'
                }`}
              >
                {actionLoading ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
