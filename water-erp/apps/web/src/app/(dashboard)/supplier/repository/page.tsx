'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getSupplierList, getSupplierStats, getClassifications,
  updateSupplierStatus, createClassification, updateClassification, deleteClassification,
} from '@/lib/api/supplier';
import type { Supplier, SupplierClassification, SupplierListResponse } from '@/lib/types';

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: '待审核', color: '#f5a623', bg: '#f5a62318' },
  RETURNED: { label: '退回补正', color: '#e67e22', bg: '#e67e2218' },
  APPROVED: { label: '已入库', color: '#11a874', bg: '#11a87418' },
  REJECTED: { label: '审核不通过', color: '#e74c3c', bg: '#e74c3c18' },
  DISABLED: { label: '已停用', color: '#95a5a6', bg: '#95a5a618' },
  BLACKLIST: { label: '黑名单', color: '#c0392b', bg: '#c0392b18' },
};

export default function SupplierRepositoryPage() {
  const router = useRouter();
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, disabled: 0, blacklist: 0 });
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterClassification, setFilterClassification] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [statusModal, setStatusModal] = useState<{ type: 'disable' | 'blacklist'; supplier: Supplier } | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);

  const [showClassMgr, setShowClassMgr] = useState(false);
  const [editClass, setEditClass] = useState<SupplierClassification | null>(null);
  const [classForm, setClassForm] = useState({ name: '', code: '', description: '' });
  const [classSaving, setClassSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSupplierList({
        status: filterStatus || undefined,
        classificationId: filterClassification || undefined,
        search: search || undefined,
        page, pageSize: 20,
      });
      setData(res);
    } catch { /* empty */ }
    setLoading(false);
  }, [filterStatus, filterClassification, search, page]);

  const refreshMeta = useCallback(() => {
    getSupplierStats().then(setStats).catch(() => {});
    getClassifications().then(setClassifications).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { refreshMeta(); }, [refreshMeta, data.total]);

  const handleStatusAction = async () => {
    if (!statusModal || !statusReason.trim()) { alert('请填写原因'); return; }
    setStatusLoading(true);
    try {
      await updateSupplierStatus(statusModal.supplier.id, statusModal.type.toUpperCase() as 'DISABLED' | 'BLACKLIST', statusReason);
      setStatusModal(null);
      setStatusReason('');
      loadData();
    } catch { /* empty */ }
    setStatusLoading(false);
  };

  const openClassEditor = (c: SupplierClassification | null) => {
    setEditClass(c);
    setClassForm(c ? { name: c.name, code: c.code, description: c.description || '' } : { name: '', code: '', description: '' });
  };
  const saveClass = async () => {
    if (!classForm.name.trim() || !classForm.code.trim()) { alert('请填写分类名称和代码'); return; }
    setClassSaving(true);
    try {
      if (editClass) await updateClassification(editClass.id, classForm);
      else await createClassification(classForm);
      openClassEditor(null);
      refreshMeta();
    } catch (e: any) { alert(e?.message || '保存失败，名称或代码可能重复'); }
    setClassSaving(false);
  };
  const removeClass = async (c: SupplierClassification) => {
    if (!confirm(`确认删除分类「${c.name}」？`)) return;
    try { await deleteClassification(c.id); refreshMeta(); }
    catch (e: any) { alert(e?.message || '删除失败，该分类下可能仍有供应商'); }
  };

  const totalPages = Math.ceil(data.total / 20);

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="mb-2 inline-flex rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1 text-xs font-semibold text-[#11a874]">供应商管理中心</div>
          <h1 className="text-2xl font-bold text-[#0f2f57]">供应商库</h1>
          <p className="text-sm text-[#5a6d8a] mt-1">全量供应商目录、分类管理与状态维护</p>
        </div>
        <button onClick={() => setShowClassMgr(v => !v)} className="rounded-xl border border-[#d5e0ef] bg-white px-4 py-2 text-sm font-semibold text-[#064ea2] hover:bg-[#f0f6ff] transition">
          {showClassMgr ? '收起分类管理' : '分类管理'}
        </button>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: '供应商总数', value: stats.total, color: '#064ea2' },
          { label: '已入库', value: stats.approved, color: '#11a874' },
          { label: '已停用', value: stats.disabled, color: '#95a5a6' },
          { label: '黑名单', value: stats.blacklist, color: '#c0392b' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#e5ecf4] p-5">
            <p className="text-xs text-[#5a6d8a] mb-1">{s.label}</p>
            <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 分类管理面板 */}
      {showClassMgr && (
        <div className="bg-white rounded-2xl border border-[#e5ecf4] p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-[#18243a]">业务分类管理</h2>
            <button onClick={() => openClassEditor(null)} className="px-3 py-1.5 text-xs text-white bg-[#064ea2] hover:bg-[#054280] rounded-lg transition">+ 新增分类</button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {classifications.map(c => (
              <div key={c.id} className="rounded-xl border border-[#e5ecf4] bg-[#f8fafc] p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#18243a] text-sm">{c.name}</span>
                  <span className="text-xs text-white bg-[#064ea2] rounded-full px-2 py-0.5">{c._count?.suppliers ?? 0} 家</span>
                </div>
                <div className="text-xs text-[#5a6d8a] mt-1 font-mono">{c.code}</div>
                {c.description && <div className="text-xs text-[#5a6d8a] mt-1 line-clamp-2">{c.description}</div>}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => openClassEditor(c)} className="text-xs text-[#064ea2] hover:underline">编辑</button>
                  <button onClick={() => removeClass(c)} className="text-xs text-[#e74c3c] hover:underline">删除</button>
                </div>
              </div>
            ))}
          </div>

          {/* 分类编辑/新增表单 */}
          {(editClass || classForm.name || classForm.code) && (
            <div className="mt-4 rounded-xl border border-[#bcd0e8] bg-white p-4">
              <h3 className="font-semibold text-[#18243a] mb-3 text-sm">{editClass ? '编辑分类' : '新增分类'}</h3>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <input value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })} placeholder="分类名称" className="px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
                <input value={classForm.code} onChange={e => setClassForm({ ...classForm, code: e.target.value })} placeholder="分类代码（如 IT_INFO）" className="px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm font-mono focus:outline-none focus:border-[#064ea2]" />
                <input value={classForm.description} onChange={e => setClassForm({ ...classForm, description: e.target.value })} placeholder="描述（可选）" className="px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
              </div>
              <div className="flex gap-2">
                <button onClick={saveClass} disabled={classSaving} className="px-4 py-1.5 text-sm text-white bg-[#064ea2] hover:bg-[#054280] rounded-lg disabled:opacity-50 transition">{classSaving ? '保存中...' : '保存'}</button>
                <button onClick={() => openClassEditor(null)} className="px-4 py-1.5 text-sm text-[#5a6d8a] hover:bg-[#f8fafc] rounded-lg transition">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 状态筛选标签 */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { label: '全部', status: '' },
          { label: '已入库', status: 'APPROVED' },
          { label: '待审核', status: 'PENDING' },
          { label: '退回补正', status: 'RETURNED' },
          { label: '已停用', status: 'DISABLED' },
          { label: '黑名单', status: 'BLACKLIST' },
        ].map(t => (
          <button
            key={t.label}
            onClick={() => { setFilterStatus(t.status); setPage(1); }}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${filterStatus === t.status ? 'bg-[#064ea2] text-white shadow-[0_8px_20px_rgba(6,78,162,0.2)]' : 'bg-white text-[#5a6d8a] border border-[#e5ecf4] hover:text-[#064ea2]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 搜索 & 分类筛选 */}
      <div className="bg-white rounded-xl border border-[#e5ecf4] p-4 mb-4 flex gap-3 items-center flex-wrap">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索企业名称 / 信用代码"
          className="flex-1 min-w-[200px] px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]"
        />
        <select value={filterClassification} onChange={e => { setFilterClassification(e.target.value); setPage(1); }} className="px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]">
          <option value="">全部分类</option>
          {classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterClassification(''); setPage(1); }} className="px-4 py-2 text-sm text-[#5a6d8a] hover:text-[#064ea2] transition">重置</button>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl border border-[#e5ecf4]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5ecf4] text-left text-[#5a6d8a]">
              <th className="px-5 py-3">企业名称</th>
              <th className="px-5 py-3">统一社会信用代码</th>
              <th className="px-5 py-3">企业类型</th>
              <th className="px-5 py-3">状态</th>
              <th className="px-5 py-3">分类</th>
              <th className="px-5 py-3">入库时间</th>
              <th className="px-5 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-[#5a6d8a]">加载中...</td></tr>
            ) : data.items.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-[#5a6d8a]">暂无供应商数据</td></tr>
            ) : data.items.map((s: Supplier) => {
              const st = statusMap[s.status] || { label: s.status, color: '#999', bg: '#99918' };
              return (
                <tr key={s.id} className="border-b border-[#e5ecf4] hover:bg-[#f8fafc]">
                  <td className="px-5 py-3 font-semibold text-[#064ea2] cursor-pointer" onClick={() => router.push(`/supplier/${s.id}`)}>{s.name}</td>
                  <td className="px-5 py-3 text-[#5a6d8a] font-mono text-xs">{s.creditCode || '—'}</td>
                  <td className="px-5 py-3 text-[#5a6d8a]">{s.enterpriseType || '—'}</td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: st.color, backgroundColor: st.bg }}>{st.label}</span>
                  </td>
                  <td className="px-5 py-3 text-[#5a6d8a]">{s.classification?.name || '—'}</td>
                  <td className="px-5 py-3 text-[#5a6d8a]">{new Date(s.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => router.push(`/supplier/${s.id}`)} className="px-2 py-1 text-xs text-[#064ea2] hover:bg-[#f0f6ff] rounded transition">详情</button>
                      {s.status === 'APPROVED' && (
                        <>
                          <button onClick={() => { setStatusReason(''); setStatusModal({ type: 'disable', supplier: s }); }} className="px-2 py-1 text-xs text-[#5a6d8a] hover:bg-[#f0f6ff] rounded transition">停用</button>
                          <button onClick={() => { setStatusReason(''); setStatusModal({ type: 'blacklist', supplier: s }); }} className="px-2 py-1 text-xs text-[#e74c3c] hover:bg-[#c0392b] hover:text-white rounded transition">黑名单</button>
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

      {/* 状态变更弹窗 */}
      {statusModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setStatusModal(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[#18243a] mb-4">{statusModal.type === 'disable' ? '停用供应商' : '加入黑名单'}</h3>
            <p className="text-sm text-[#5a6d8a] mb-3">供应商：<strong className="text-[#18243a]">{statusModal.supplier.name}</strong></p>
            <textarea
              value={statusReason}
              onChange={e => setStatusReason(e.target.value)}
              placeholder="请填写原因..."
              className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm mb-4 h-24 resize-none focus:outline-none focus:border-[#e74c3c]"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setStatusModal(null)} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f8fafc] rounded-lg transition">取消</button>
              <button onClick={handleStatusAction} disabled={statusLoading || !statusReason.trim()} className="px-4 py-2 text-sm text-white bg-[#e74c3c] hover:bg-[#c0392b] rounded-lg disabled:opacity-50 transition">{statusLoading ? '处理中...' : '确认'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
