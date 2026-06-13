'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupplierList, approveSupplier, rejectSupplier, returnSupplier, updateSupplierStatus, getClassifications } from '@/lib/api/supplier';
import type { Supplier, SupplierClassification, SupplierListResponse } from '@/lib/types';

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: '待审核', color: '#f5a623', bg: '#f5a62318' },
  RETURNED: { label: '退回补正', color: '#e67e22', bg: '#e67e2218' },
  APPROVED: { label: '已入库', color: '#11a874', bg: '#11a87418' },
  REJECTED: { label: '审核不通过', color: '#e74c3c', bg: '#e74c3c18' },
  DISABLED: { label: '已停用', color: '#95a5a6', bg: '#95a5a618' },
  BLACKLIST: { label: '黑名单', color: '#c0392b', bg: '#c0392b18' },
};

export default function SupplierPage() {
  const router = useRouter();
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterClassification, setFilterClassification] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // 审核弹窗状态
  const [actionModal, setActionModal] = useState<{ type: 'approve' | 'reject' | 'return' | 'disable' | 'blacklist'; supplier: Supplier } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSupplierList({ status: filterStatus || undefined, classificationId: filterClassification || undefined, search: search || undefined, page, pageSize: 20 });
      setData(res);
    } catch { /* empty */ }
    setLoading(false);
  }, [filterStatus, filterClassification, search, page]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { getClassifications().then(setClassifications).catch(() => {}); }, []);

  const handleAction = async () => {
    if (!actionModal) return;
    if (actionModal.type !== 'approve' && !actionReason.trim()) {
      alert('请填写处理原因');
      return;
    }
    setActionLoading(true);
    try {
      const { type, supplier } = actionModal;
      if (type === 'approve') await approveSupplier(supplier.id);
      else if (type === 'reject') await rejectSupplier(supplier.id, actionReason);
      else if (type === 'return') await returnSupplier(supplier.id, actionReason);
      else if (type === 'disable') await updateSupplierStatus(supplier.id, 'DISABLED', actionReason);
      else if (type === 'blacklist') await updateSupplierStatus(supplier.id, 'BLACKLIST', actionReason);
      setActionModal(null);
      setActionReason('');
      loadData();
    } catch { /* empty */ }
    setActionLoading(false);
  };

  // 统计
  const stats = {
    total: data.total,
    pending: data.items.filter((s: Supplier) => s.status === 'PENDING').length,
    approved: data.items.filter((s: Supplier) => s.status === 'APPROVED').length,
    abnormal: data.items.filter((s: Supplier) => ['DISABLED', 'BLACKLIST'].includes(s.status)).length,
  };

  const totalPages = Math.ceil(data.total / 20);

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="mb-2 inline-flex rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1 text-xs font-semibold text-[#11a874]">供应商管理中心</div>
          <h1 className="text-2xl font-bold text-[#0f2f57]">供应商管理中心</h1>
          <p className="text-sm text-[#5a6d8a] mt-1">供应商审核、供应商库、信息变更、评价与异常/黑名单管理</p>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: '供应商总数', value: stats.total, color: '#064ea2', bg: '#064ea212' },
          { label: '待审核', value: stats.pending, color: '#f5a623', bg: '#f5a62312' },
          { label: '已入库', value: stats.approved, color: '#11a874', bg: '#11a87412' },
          { label: '异常/停用', value: stats.abnormal, color: '#e74c3c', bg: '#e74c3c12' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">{s.label}</p>
            <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-[#e5ecf4] p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-[#18243a]">供应商生命周期</h2>
            <p className="text-sm text-[#5a6d8a] mt-1">注册申请 → 资料审核 → 入库管理 → 履约评价 → 异常处理</p>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: '注册申请', desc: '提交企业资料', color: '#064ea2' },
            { label: '资料审核', desc: '资质与基础信息审核', color: '#f5a623' },
            { label: '入库管理', desc: '分类、状态与联系人', color: '#11a874' },
            { label: '履约评价', desc: '服务质量与综合评分', color: '#7c3aed' },
            { label: '异常处理', desc: '停用、黑名单、恢复', color: '#e74c3c' },
          ].map((item, index) => (
            <div key={item.label} className="rounded-xl border border-[#e5ecf4] bg-[#f8fafc] p-4">
              <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: item.color }}>{index + 1}</div>
              <div className="font-semibold text-[#18243a]">{item.label}</div>
              <div className="mt-1 text-xs text-[#5a6d8a]">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { label: '全部供应商', status: '' },
          { label: '待审核', status: 'PENDING' },
          { label: '已入库', status: 'APPROVED' },
          { label: '退回补正', status: 'RETURNED' },
          { label: '异常/黑名单', status: 'BLACKLIST' },
        ].map(tab => (
          <button
            key={tab.label}
            onClick={() => { setFilterStatus(tab.status); setPage(1); }}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${filterStatus === tab.status ? 'bg-[#064ea2] text-white shadow-[0_8px_20px_rgba(6,78,162,0.2)]' : 'bg-white text-[#5a6d8a] border border-[#e5ecf4] hover:text-[#064ea2]'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 筛选栏 */}
      <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-4 mb-4 flex gap-3 items-center flex-wrap">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索企业名称 / 信用代码"
          className="flex-1 min-w-[200px] px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]"
        />
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]"
        >
          <option value="">全部状态</option>
          <option value="PENDING">待审核</option>
          <option value="RETURNED">退回补正</option>
          <option value="APPROVED">已入库</option>
          <option value="REJECTED">审核不通过</option>
          <option value="DISABLED">已停用</option>
          <option value="BLACKLIST">黑名单</option>
        </select>
        <select
          value={filterClassification}
          onChange={e => { setFilterClassification(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]"
        >
          <option value="">全部分类</option>
          {classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterClassification(''); setPage(1); }}
          className="px-4 py-2 text-sm text-[oklch(0.55_0.01_264)] hover:text-[#064ea2] transition">重置</button>
      </div>

      {/* 供应商列表 */}
      <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3">企业名称</th>
              <th className="px-5 py-3">统一社会信用代码</th>
              <th className="px-5 py-3">企业类型</th>
              <th className="px-5 py-3">状态</th>
              <th className="px-5 py-3">分类</th>
              <th className="px-5 py-3">评分</th>
              <th className="px-5 py-3">注册时间</th>
              <th className="px-5 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-[oklch(0.55_0.01_264)]">加载中...</td></tr>
            ) : data.items.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-[oklch(0.55_0.01_264)]">暂无供应商数据</td></tr>
            ) : data.items.map((s: Supplier) => {
              const st = statusMap[s.status] || { label: s.status, color: '#999', bg: '#99918' };
              return (
                <tr key={s.id} className="border-b border-[oklch(0.91_0.006_264)] hover:bg-[oklch(0.992_0.003_264)]">
                  <td className="px-5 py-3 font-semibold text-[#064ea2] cursor-pointer" onClick={() => router.push(`/supplier/${s.id}`)}>{s.name}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)] font-mono text-xs">{s.creditCode}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{s.enterpriseType}</td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: st.color, backgroundColor: st.bg }}>{st.label}</span>
                  </td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{s.classification?.name || '—'}</td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-[#eff6ff] px-2 py-1 text-xs font-semibold text-[#064ea2]">信用良好</span>
                  </td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{new Date(s.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => router.push(`/supplier/${s.id}`)} className="px-2 py-1 text-xs text-[#064ea2] hover:bg-[oklch(0.992_0.003_264)] rounded transition">详情</button>
                      {(s.status === 'PENDING' || s.status === 'RETURNED') && (
                        <>
                          <button onClick={() => setActionModal({ type: 'approve', supplier: s })} className="px-2 py-1 text-xs text-white bg-[#11a874] hover:bg-[#0e8c5f] rounded transition">通过</button>
                          <button onClick={() => { setActionReason(''); setActionModal({ type: 'return', supplier: s }); }} className="px-2 py-1 text-xs text-white bg-[#f5a623] hover:bg-[#d9921e] rounded transition">退回</button>
                          <button onClick={() => { setActionReason(''); setActionModal({ type: 'reject', supplier: s }); }} className="px-2 py-1 text-xs text-white bg-[#e74c3c] hover:bg-[#c0392b] rounded transition">拒绝</button>
                        </>
                      )}
                      {s.status === 'APPROVED' && (
                        <>
                          <button onClick={() => { setActionReason(''); setActionModal({ type: 'disable', supplier: s }); }} className="px-2 py-1 text-xs text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.992_0.003_264)] rounded transition">停用</button>
                          <button onClick={() => { setActionReason(''); setActionModal({ type: 'blacklist', supplier: s }); }} className="px-2 py-1 text-xs text-[#e74c3c] hover:bg-[#c0392b] hover:text-white rounded transition">黑名单</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex justify-between items-center px-5 py-3 border-t border-[oklch(0.91_0.006_264)]">
            <span className="text-xs text-[oklch(0.55_0.01_264)]">共 {data.total} 条，第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 text-xs border border-[oklch(0.91_0.006_264)] rounded hover:bg-[oklch(0.992_0.003_264)] disabled:opacity-40 transition">上一页</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 text-xs border border-[oklch(0.91_0.006_264)] rounded hover:bg-[oklch(0.992_0.003_264)] disabled:opacity-40 transition">下一页</button>
            </div>
          </div>
        )}
      </div>

      {/* 操作弹窗 */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setActionModal(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-4">
              {actionModal.type === 'approve' && '确认审核通过'}
              {actionModal.type === 'reject' && '审核不通过'}
              {actionModal.type === 'return' && '退回补正'}
              {actionModal.type === 'disable' && '停用供应商'}
              {actionModal.type === 'blacklist' && '加入黑名单'}
            </h3>
            <p className="text-sm text-[oklch(0.55_0.01_264)] mb-3">供应商：<strong className="text-[oklch(0.18_0.012_265)]">{actionModal.supplier.name}</strong></p>
            {actionModal.type !== 'approve' && (
              <textarea
                value={actionReason}
                onChange={e => setActionReason(e.target.value)}
                placeholder={actionModal.type === 'return' ? '请填写退回补正原因...' : '请填写原因...'}
                className="w-full px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm mb-4 h-24 resize-none focus:outline-none focus:border-[#064ea2]"
              />
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setActionModal(null)} className="px-4 py-2 text-sm text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.992_0.003_264)] rounded-lg transition">取消</button>
              <button onClick={handleAction} disabled={actionLoading || (actionModal.type !== 'approve' && !actionReason.trim())}
                className={`px-4 py-2 text-sm text-white rounded-lg transition disabled:opacity-50 ${
                  actionModal.type === 'approve' ? 'bg-[#11a874] hover:bg-[#0e8c5f]' :
                  actionModal.type === 'return' ? 'bg-[#f5a623] hover:bg-[#d9921e]' :
                  'bg-[#e74c3c] hover:bg-[#c0392b]'
                }`}>
                {actionLoading ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
