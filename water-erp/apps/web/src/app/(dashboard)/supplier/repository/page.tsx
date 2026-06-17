'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  getSupplierList, getSupplierStats, getClassifications,
  updateSupplierStatus, createClassification, updateClassification, deleteClassification,
} from '@/lib/api/supplier';
import type { Supplier, SupplierClassification, SupplierListResponse } from '@/lib/types';
import { DataToolbar, MetricCard, PageHero, SectionCard, StatusBadge, TableSkeleton, EmptyState, Pagination } from '@/components/workbench';
import { useSort, SortableTh } from '@/lib/hooks/use-sort';
import { Building2, Layers, Search, Plus } from 'lucide-react';

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
  const [pageSize, setPageSize] = useState(20);

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
        search: search || undefined, page, pageSize,
      });
      setData(res);
    } catch { /* empty */ }
    setLoading(false);
  }, [filterStatus, filterClassification, search, page, pageSize]);

  const refreshMeta = useCallback(() => {
    getSupplierStats().then(setStats).catch(() => {});
    getClassifications().then(setClassifications).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { refreshMeta(); }, [refreshMeta, data.total]);
  const { sortKey, sortDir, toggle, sorted } = useSort<Supplier>('createdAt', 'desc');
  const sortedItems = sorted(data.items);

  const handleStatusAction = async () => {
    if (!statusModal || !statusReason.trim()) { toast.error('请填写原因'); return; }
    setStatusLoading(true);
    try {
      await updateSupplierStatus(statusModal.supplier.id, statusModal.type.toUpperCase() as 'DISABLED' | 'BLACKLIST', statusReason);
      toast.success(statusModal.type === 'disable' ? '已停用' : '已加入黑名单');
      setStatusModal(null); setStatusReason(''); loadData();
    } catch (e: any) { toast.error(e?.message || '操作失败'); }
    setStatusLoading(false);
  };

  const openClassEditor = (c: SupplierClassification | null) => {
    setEditClass(c);
    setClassForm(c ? { name: c.name, code: c.code, description: c.description || '' } : { name: '', code: '', description: '' });
  };
  const saveClass = async () => {
    if (!classForm.name.trim() || !classForm.code.trim()) { toast.error('请填写分类名称和代码'); return; }
    setClassSaving(true);
    try {
      if (editClass) { await updateClassification(editClass.id, classForm); toast.success('分类已更新'); }
      else { await createClassification(classForm); toast.success('分类已创建'); }
      openClassEditor(null); refreshMeta();
    } catch (e: any) { toast.error(e?.message || '保存失败'); }
    setClassSaving(false);
  };
  const removeClass = async (c: SupplierClassification) => {
    if (!confirm(`确认删除分类「${c.name}」？`)) return;
    try { await deleteClassification(c.id); toast.success('分类已删除'); refreshMeta(); }
    catch (e: any) { toast.error(e?.message || '删除失败'); }
  };


  const STATUS_TABS = [
    { label: '全部', status: '' },
    { label: '已入库', status: 'APPROVED', tone: 'green' as const },
    { label: '待审核', status: 'PENDING', tone: 'blue' as const },
    { label: '退回补正', status: 'RETURNED', tone: 'orange' as const },
    { label: '已停用', status: 'DISABLED', tone: 'gray' as const },
    { label: '黑名单', status: 'BLACKLIST', tone: 'red' as const },
  ];

  return (
    <div className="space-y-6">
      <PageHero
         title="供应商库"
        description="全量供应商目录、分类管理与状态维护。支持按状态、分类和关键词筛选。"
        tone="green" icon={<Building2 size={14} />}
        actions={
          <button onClick={() => setShowClassMgr(v => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-[#064ea2] bg-white px-4 py-2 text-sm font-bold text-[#064ea2] hover:bg-[#f0f5ff] transition">
            <Layers size={16} />{showClassMgr ? '收起分类' : '分类管理'}
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="供应商总数" value={stats.total} tone="blue" icon={<Building2 size={18} strokeWidth={1.7} />} />
        <MetricCard label="已入库" value={stats.approved} tone="green" />
        <MetricCard label="待审核" value={stats.pending} tone="orange" />
        <MetricCard label="已停用" value={stats.disabled} tone="gray" />
      </div>

      {/* Classification management panel */}
      {showClassMgr && (
        <div className="glass-card glass-card-lighter rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[#18243a]">业务分类管理</h2>
            <button onClick={() => openClassEditor(null)}
              className="inline-flex items-center gap-1 rounded-xl bg-[#064ea2] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#054280] transition">
              <Plus size={13} />新增分类
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {classifications.map(c => (
              <div key={c.id} className="rounded-xl border border-[#dce6f3] bg-[#f8fafc] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[#18243a]">{c.name}</span>
                  <StatusBadge tone="blue">{c._count?.suppliers ?? 0} 家</StatusBadge>
                </div>
                <div className="mt-1 font-mono text-xs text-[#8a99ad]">{c.code}</div>
                {c.description && <div className="mt-1 text-xs text-[#5a6d8a] line-clamp-2">{c.description}</div>}
                <div className="mt-2 flex gap-2">
                  <button onClick={() => openClassEditor(c)} className="text-xs font-semibold text-[#064ea2] hover:underline">编辑</button>
                  <button onClick={() => removeClass(c)} className="text-xs font-semibold text-red-500 hover:underline">删除</button>
                </div>
              </div>
            ))}
          </div>

          {/* Classification editor */}
          {(editClass || classForm.name || classForm.code) && (
            <div className="rounded-xl border border-[#bcd0e8] bg-white p-4">
              <h3 className="text-sm font-bold text-[#18243a] mb-3">{editClass ? '编辑分类' : '新增分类'}</h3>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <input value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })}
                  placeholder="分类名称" className="workbench-input text-sm" />
                <input value={classForm.code} onChange={e => setClassForm({ ...classForm, code: e.target.value })}
                  placeholder="分类代码（如 IT_INFO）" className="workbench-input text-sm font-mono" />
                <input value={classForm.description} onChange={e => setClassForm({ ...classForm, description: e.target.value })}
                  placeholder="描述（可选）" className="workbench-input text-sm" />
              </div>
              <div className="flex gap-2">
                <button onClick={saveClass} disabled={classSaving}
                  className="rounded-xl bg-[#064ea2] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#054280] disabled:opacity-50 transition">
                  {classSaving ? '保存中...' : '保存'}
                </button>
                <button onClick={() => openClassEditor(null)}
                  className="rounded-xl border border-[#dce3eb] px-4 py-1.5 text-sm font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map(t => (
          <button key={t.label} onClick={() => { setFilterStatus(t.status); setPage(1); }}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
              filterStatus === t.status
                ? 'bg-[#064ea2] text-white shadow-sm'
                : 'bg-white text-[#5a6d8a] border border-[#dce6f3] hover:border-[#bcd0e8] hover:text-[#064ea2]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <DataToolbar>
        <div className="flex items-center gap-2 flex-1">
          <Search size={15} className="text-[#94a3b8] flex-shrink-0" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="搜索企业名称 / 信用代码" className="workbench-input flex-1 text-sm" />
        </div>
        <select value={filterClassification} onChange={e => { setFilterClassification(e.target.value); setPage(1); }}
          className="workbench-input text-sm">
          <option value="">全部分类</option>
          {classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterClassification(''); setPage(1); }}
          className="rounded-xl border border-[#dce3eb] px-3 py-2 text-sm font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] transition">重置</button>
      </DataToolbar>

      <SectionCard className="p-0">
        <table className="workbench-table">
          <thead className="bg-[#f3f7fc] text-[#5a6d8a]">
            <tr>
              <SortableTh label="企业名称" field="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
              <th className="px-4 py-3 text-center">统一社会信用代码</th>
              <SortableTh label="企业类型" field="enterpriseType" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
              <th className="px-4 py-3 text-center">状态</th>
              <th className="px-4 py-3 text-center">分类</th>
              <SortableTh label="入库时间" field="createdAt" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton cols={7} rows={5} />
            ) : sortedItems.length === 0 ? (
              <tr><td colSpan={7}><EmptyState title="暂无供应商数据" description="供应商注册并通过审核后将出现在这里" /></td></tr>
            ) : sortedItems.map((s: Supplier) => {
              const statusTone = s.status === 'APPROVED' ? 'green' : s.status === 'PENDING' ? 'blue'
                : s.status === 'RETURNED' ? 'orange' : s.status === 'DISABLED' ? 'gray'
                : s.status === 'BLACKLIST' ? 'red' : 'gray';
              const statusLabel = s.status === 'APPROVED' ? '已入库' : s.status === 'PENDING' ? '待审核'
                : s.status === 'RETURNED' ? '退回补正' : s.status === 'DISABLED' ? '已停用'
                : s.status === 'BLACKLIST' ? '黑名单' : s.status;
              return (
                <tr key={s.id} className="row-clickable" onClick={() => router.push(`/supplier/${s.id}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#064ea2] text-xs font-extrabold text-white">
                        {s.name[0]}
                      </div>
                      <span className="text-sm font-bold text-[#18243a] cursor-pointer hover:text-[#064ea2] transition"
                        onClick={() => router.push(`/supplier/${s.id}`)}>
                        {s.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-[#5a6d8a]">{s.creditCode || '—'}</td>
                  <td className="px-4 py-3 text-center text-sm text-[#5a6d8a]">{s.enterpriseType || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-[#5a6d8a]">{s.classification?.name || '—'}</td>
                  <td className="px-4 py-3 text-center text-sm text-[#5a6d8a]">{new Date(s.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-1.5">
                      <button onClick={(e) => { e.stopPropagation(); router.push(`/supplier/${s.id}`); }}
                        className="rounded-lg border border-[#dce6f3] px-2.5 py-1 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">详情</button>
                      {s.status === 'APPROVED' && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); setStatusReason(''); setStatusModal({ type: 'disable', supplier: s }); }}
                            className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100 transition">停用</button>
                          <button onClick={(e) => { e.stopPropagation(); setStatusReason(''); setStatusModal({ type: 'blacklist', supplier: s }); }}
                            className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100 transition">黑名单</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <Pagination total={data.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(ps) => { setPageSize(ps); setPage(1); }} />
      </SectionCard>

      {/* Status change modal */}
      {statusModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setStatusModal(null)}>
          <div className="modal-content w-full max-w-md overflow-hidden rounded-2xl border border-[#dce6f3] bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[#edf2f7] px-6 py-4">
              <h3 className="text-base font-bold text-[#18243a]">
                {statusModal.type === 'disable' ? '停用供应商' : '加入黑名单'}
              </h3>
              <p className="mt-1 text-xs text-[#5a6d8a]">供应商：<strong className="text-[#18243a]">{statusModal.supplier.name}</strong></p>
            </div>
            <div className="p-6">
              <textarea value={statusReason} onChange={e => setStatusReason(e.target.value)}
                placeholder="请填写原因..."
                className="w-full rounded-xl border border-[#dce6f3] px-3 py-2 text-sm placeholder-[#94a3b8] h-24 resize-none focus:outline-none focus:border-red-400" />
            </div>
            <div className="flex justify-end gap-3 border-t border-[#edf2f7] px-6 py-4">
              <button onClick={() => setStatusModal(null)}
                className="rounded-xl border border-[#dce3eb] px-4 py-2 text-sm font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">取消</button>
              <button onClick={handleStatusAction} disabled={statusLoading || !statusReason.trim()}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-50 transition">
                {statusLoading ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
