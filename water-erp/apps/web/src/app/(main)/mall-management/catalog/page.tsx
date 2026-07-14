'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import {
  ShoppingCart, Package, RefreshCw, ChevronUp, X, Search, GitBranch,
  PenLine, CheckCircle, TrendingUp, Bell, Archive, Building2, FileText,
  Upload, Download, Plus, ChevronRight, Heart,
} from 'lucide-react';
import { StatusBadge } from '@/components/workbench';
import {
  changeCatalogStatus, getCatalogStats, listCatalogItems, createCatalogItem,
  downloadImportTemplate, importCatalogFile, setItemAttributes,
  getCategoryTree, createCategory, updateCategory, deleteCategory, toggleCategoryStatus,
  createAttributeTemplate, deleteAttributeTemplate,
  listAlertRules, listAlerts, deleteAlertRule, toggleAlertRule,
  listVersions, createVersion, changeVersionStatus, compareVersions,
  getSupplierCoverage, getSupplierPriceComparison,
  listCatalogAuditLogs,
  type CatalogItem, type CatalogStats, type ImportResult, type CatalogAuditLog,
  type AlertRule, type AlertRecord, type CatalogVersionData, type VersionDiff,
  type SupplierCoverage, type SupplierPriceItem,
} from '@/lib/api/catalog-admin';
import { useSort, SortableTh } from '@/lib/hooks/use-sort';
import { useFormAutosave, useUnsavedGuard } from '@/lib/hooks/use-form-autosave';
import { useCategoryTree } from '@/lib/hooks/use-category-tree';
import { findNode, getNodePath, type CategoryNode } from '@/lib/category-tree-utils';
import { buildDynamicFields, extractAttributeValues, type DynamicField } from '@/lib/attribute-template-utils';
import { CategoryTree } from '@/components/catalog/CategoryTree';
import { CategoryTreeSelect } from '@/components/catalog/CategoryTreeSelect';
import { CategoryFormDialog } from '@/components/catalog/CategoryFormDialog';
import { AttributeValueEditor } from '@/components/catalog/AttributeValueEditor';
import { AttributeTemplateEditor } from '@/components/catalog/AttributeTemplateEditor';
import { PriceTrendChart } from '@/components/catalog/PriceTrendChart';

// ── helpers ──

const PALETTE = ['oklch(0.55 0.18 258)', 'oklch(0.55 0.18 30)', 'oklch(0.55 0.18 150)', 'oklch(0.55 0.18 330)', 'oklch(0.55 0.18 80)'];
const ALERT_TYPE_LABELS: Record<string, string> = { PRICE_SURGE: '涨幅预警', PRICE_DROP: '跌幅预警', EXPIRING: '即将过期', DEVIATION: '偏离均值' };
const LOG_LABELS: Record<string, string> = { CATALOG_CREATED: '新增目录', CATALOG_UPDATED: '编辑目录', CATALOG_PRICE_CHANGED: '价格调整', CATALOG_STATUS_CHANGED: '状态变更', CATALOG_IMPORTED: '批量导入', CATALOG_TEMPLATE_DOWNLOADED: '模板下载', CATALOG_EXPORTED: '目录导出' };

const TABS = [
  { key: 'items', label: '目录列表', icon: Package },
  { key: 'tree', label: '品类树', icon: GitBranch, roles: ['admin'] },
  { key: 'entry', label: '价格录入', icon: PenLine },
  { key: 'approval', label: '价格审批', icon: CheckCircle },
  { key: 'trends', label: '价格趋势', icon: TrendingUp },
  { key: 'alerts', label: '价格预警', icon: Bell },
  { key: 'versions', label: '目录版本', icon: Archive },
  { key: 'suppliers', label: '供应商维度', icon: Building2 },
  { key: 'logs', label: '操作日志', icon: FileText },
] as const;

// ── 目录列表 Tab ──

function ItemsTab() {
  const statuses = ['全部', '有效', '价格波动', '即将过期', '待复核', '下架', '停用'];
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [status, setStatus] = useState('全部');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = { status };
      if (selectedCategoryId) params.categoryId = selectedCategoryId;
      const [list, s] = await Promise.all([listCatalogItems(params), getCatalogStats()]);
      setItems(list); setStats(s);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [status, selectedCategoryId]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return items.filter(item => !kw || [item.code, item.name, item.specification, item.category, item.supplier].some(v => v.toLowerCase().includes(kw)));
  }, [items, search]);
  const { sortKey, sortDir, toggle, sorted } = useSort<CatalogItem>('code', 'asc');
  const sortedItems = sorted(filtered);
  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const pagedItems = useMemo(() => sortedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [sortedItems, page]);

  const setItemStatus = async (item: CatalogItem, s: string) => {
    if (!window.confirm(`确认将 ${item.name} 状态改为「${s}」？`)) return;
    try { await changeCatalogStatus(item.id, s, `管理端${s}`); toast.success('状态已更新'); load(); }
    catch (e: any) { toast.error(e.message); }
  };
  const tone = (s: string): 'green' | 'gray' | 'orange' | 'red' | 'blue' =>
    s === '有效' ? 'green' : s === '下架' || s === '停用' ? 'gray' : s === '待复核' || s === '价格波动' ? 'orange' : s === '即将过期' ? 'red' : 'blue';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[['目录总数', stats?.total ?? '—'], ['有效', stats?.active ?? '—'], ['下架/停用', stats?.inactive ?? '—'], ['待复核', stats?.review ?? '—'], ['本月更新', stats?.updatedThisMonth ?? '—']].map(([label, value]) => (
          <div key={label} className="kpi-card p-3 rounded-xl flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</span>
            <span className="text-[1.4rem] font-black tabular-nums text-[var(--foreground)]">{value}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="neu-tab-bar">
          {statuses.map(s => <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`neu-tab ${status === s ? 'is-active' : ''}`}>{s}</button>)}
        </div>
        <CategoryTreeSelect value={selectedCategoryId} onChange={(id) => { setSelectedCategoryId(id); setPage(1); }} placeholder="按品类筛选" className="min-w-[160px]" />
        <div className="relative flex-1 min-w-[140px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索编码、名称、规格、供应商" className="neu-input !pl-9 w-full text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={14} /></button>}
        </div>
        <button onClick={load} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[780px]">
            <thead><tr>
              <SortableTh label="编码" field="code" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
              <SortableTh label="名称/规格" field="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
              <th className="text-center">品类</th>
              <SortableTh label="参考价" field="referencePrice" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
              <th className="text-center">供应商</th>
              <th className="text-center">状态</th>
              <th className="text-center">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="px-4 py-16 text-center"><RefreshCw size={22} className="animate-spin mx-auto text-[var(--muted-foreground)]" /><p className="text-xs mt-2 text-[var(--muted-foreground)]">加载中...</p></td></tr>
                : pagedItems.length === 0 ? <tr><td colSpan={7} className="px-4 py-16 text-center"><p className="text-sm text-[var(--muted-foreground)]">暂无目录</p></td></tr>
                : pagedItems.map(item => (
                  <tr key={item.id} className="row-clickable">
                    <td className="text-center font-mono text-xs text-[var(--accent)]">{item.code}</td>
                    <td><div className="font-bold text-[var(--foreground)]">{item.name}</div><div className="text-xs text-[var(--muted-foreground)]">{item.specification}</div></td>
                    <td className="text-center text-xs text-[var(--muted-foreground)]">{item.categoryPath || `${item.group || ''} > ${item.category}`}</td>
                    <td className="text-center font-bold tabular-nums">¥{item.referencePrice.toLocaleString('zh-CN')}</td>
                    <td className="text-center">{item.supplier}</td>
                    <td className="text-center"><StatusBadge tone={tone(item.status)}>{item.status}</StatusBadge></td>
                    <td onClick={e => e.stopPropagation()} className="text-center">
                      {item.status === '有效' ? <button onClick={() => setItemStatus(item, '下架')} className="neu-btn-xs is-warning">下架</button>
                        : <button onClick={() => setItemStatus(item, '有效')} className="neu-btn-xs is-success">启用</button>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {sortedItems.length > 0 && (
          <div className="neu-table-card-footer flex justify-between items-center px-4 py-2 text-xs text-[var(--muted-foreground)]">
            <span>共 <strong className="text-[var(--foreground)]">{sortedItems.length}</strong> 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-[-90deg]" /></button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-90" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 品类树 Tab ──

function CategoryTreeTab() {
  const { tree, loading, error, refresh } = useCategoryTree();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedNode = selectedId ? findNode(tree, selectedId) : null;
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create-root' | 'create-child' | 'edit'>('create-root');
  const [formParentId, setFormParentId] = useState<number | null>(null);
  const [formInitial, setFormInitial] = useState<{ name: string; code: string; isLeaf: boolean; icon: string } | undefined>();
  const [attrEditorOpen, setAttrEditorOpen] = useState(false);
  const [attrNode, setAttrNode] = useState<CategoryNode | null>(null);

  const handleAddRoot = () => { setFormMode('create-root'); setFormParentId(null); setFormInitial(undefined); setFormOpen(true); };
  const handleAddChild = (p: CategoryNode) => { setFormMode('create-child'); setFormParentId(p.id); setFormInitial(undefined); setFormOpen(true); };
  const handleEdit = (node: CategoryNode) => { setFormMode('edit'); setFormParentId(node.id); setFormInitial({ name: node.name, code: node.code || '', isLeaf: node.isLeaf, icon: node.icon || '' }); setFormOpen(true); };
  const handleDelete = async (node: CategoryNode) => {
    if (!window.confirm(`确认删除「${node.name}」？`)) return;
    try { await deleteCategory(node.id); toast.success('已删除'); refresh(); } catch (e: any) { toast.error(e.message); }
  };
  const handleToggle = async (node: CategoryNode) => {
    try { await toggleCategoryStatus(node.id); toast.success(node.status === 'ACTIVE' ? '已停用' : '已启用'); refresh(); } catch (e: any) { toast.error(e.message); }
  };
  const handleSave = async (data: { name: string; code: string; isLeaf: boolean; icon: string }) => {
    if (formMode === 'edit' && formParentId) await updateCategory(formParentId, data);
    else await createCategory({ ...data, parentId: formParentId });
    toast.success(formMode === 'edit' ? '已更新' : '已创建'); refresh();
  };
  const ct = selectedNode?.attributeTemplates ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4" style={{ minHeight: 'calc(100vh - 340px)' }}>
      <CategoryTree tree={tree} loading={loading} error={error} onRefresh={refresh} selectedId={selectedId} onSelect={(n) => setSelectedId(n.id)}
        onEdit={handleEdit} onDelete={handleDelete} onToggleStatus={handleToggle} onAddRoot={handleAddRoot} onAddChild={handleAddChild}
        onConfigureAttrs={(n) => { setAttrNode(n); setAttrEditorOpen(true); }} />
      <div className="neu-card rounded-2xl p-5 overflow-y-auto">
        {selectedNode ? (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-bold">{selectedNode.name}</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-[var(--muted-foreground)]">编码</span><p className="font-medium font-mono">{selectedNode.code || '—'}</p></div>
              <div><span className="text-[var(--muted-foreground)]">状态</span><p className={`font-medium ${selectedNode.status === 'ACTIVE' ? 'text-green-600' : 'text-gray-400'}`}>{selectedNode.status === 'ACTIVE' ? '启用' : '停用'}</p></div>
              <div><span className="text-[var(--muted-foreground)]">类型</span><p className="font-medium">{selectedNode.isLeaf ? '🍃 叶子' : '📁 分组'}</p></div>
              <div><span className="text-[var(--muted-foreground)]">排序</span><p className="font-medium tabular-nums">{selectedNode.sortOrder}</p></div>
            </div>
            {selectedNode.isLeaf && (
              <div>
                <div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold">属性模板</span>
                  <button onClick={() => { setAttrNode(selectedNode); setAttrEditorOpen(true); }} className="neu-btn-xs is-info">编辑模板</button></div>
                {ct.length > 0 ? <div className="flex flex-col gap-1">{ct.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[rgba(96,139,239,0.05)] text-sm">
                    <span className="font-medium">{t.name}</span><code className="text-[10px] font-mono text-[var(--accent)]">{t.fieldKey}</code>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(96,139,239,0.1)] text-[var(--accent)]">{t.fieldType}</span>
                    {t.required && <span className="text-[10px] text-red-400">必填</span>}
                  </div>))}</div> : <p className="text-sm text-[var(--muted-foreground)]">该品类暂无自定义属性</p>}
              </div>
            )}
          </div>
        ) : <div className="flex items-center justify-center h-full text-sm text-[var(--muted-foreground)]">👈 选择左侧品类节点</div>}
      </div>
      <CategoryFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSave={handleSave} initial={formInitial}
        title={formMode === 'edit' ? '编辑品类' : formMode === 'create-child' ? '新增子节点' : '新增根节点'} />
      <AttributeTemplateEditor open={attrEditorOpen} onClose={() => { setAttrEditorOpen(false); refresh(); }} categoryName={attrNode?.name} templates={ct}
        onSave={async (data) => { await createAttributeTemplate(attrNode!.id, data); refresh(); }}
        onDelete={async (id) => { await deleteAttributeTemplate(id); refresh(); }} />
    </div>
  );
}

// ── 价格录入 Tab ──

type CatalogItemInput = Omit<CatalogItem, 'id' | 'updatedAt' | 'createdAt'>;
const INITIAL_FORM: CatalogItemInput = {
  code: '', name: '', specification: '', category: '', group: '', unit: '',
  referencePrice: 0, priceMin: 0, priceMax: 0, lastDealPrice: 0, averagePrice: 0,
  supplier: '', supplierType: '协议供应商', priceSource: '人工维护', region: '全省',
  taxIncluded: true, freightIncluded: false, changeRate: 0, minOrder: '',
  remark: null, status: '有效', validUntil: null,
};

function EntryTab() {
  const [form, setForm] = useState<CatalogItemInput>(INITIAL_FORM);
  const [dynamicFields, setDynamicFields] = useState<DynamicField[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [serverError, setServerError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { getDraft, clearDraft } = useFormAutosave('price-entry', form as unknown as Record<string, unknown>);

  const handleCategoryChange = (id: number | null, node?: CategoryNode) => {
    (form as any).categoryId = id;
    setDynamicFields(node?.attributeTemplates?.length ? buildDynamicFields(node.attributeTemplates as any) : []);
  };
  const setF = (key: string, value: any) => { setForm((p: any) => ({ ...p, [key]: value })); setServerError(''); };

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { setServerError('请填写编码和名称'); return; }
    setSaving(true); setServerError('');
    try {
      const created = await createCatalogItem(form as any);
      if (dynamicFields.length > 0) { const attrs = extractAttributeValues(dynamicFields); if (attrs.length) await setItemAttributes(created.id, attrs); }
      toast.success('目录已新增'); clearDraft(); setForm(INITIAL_FORM); setDynamicFields([]);
    } catch (e: any) { setServerError(e.message); } finally { setSaving(false); }
  };

  const doImport = async () => {
    if (!file) { toast.error('请选择文件'); return; }
    setImporting(true);
    try { const r = await importCatalogFile(file); setImportResult(r); toast.success(`导入成功：新增 ${r.created}，更新 ${r.updated}`); } catch (e: any) { toast.error(e.message); }
    finally { setImporting(false); }
  };

  const doDownload = async () => { try { const b = await downloadImportTemplate(); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = '导入模板.xlsx'; a.click(); URL.revokeObjectURL(u); } catch (e: any) { toast.error(e.message); } };

  return (
    <div className="flex flex-col gap-4">
      <div className="neu-card rounded-2xl p-5">
        <h3 className="text-sm font-bold mb-4">手动录入</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[['code', '目录编码 *'], ['name', '商品名称 *'], ['specification', '规格型号'], ['unit', '单位']].map(([k, l]) => (
            <div key={k}><label className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">{l}</label>
              <input value={(form as any)[k]} onChange={e => setF(k, e.target.value)} className="neu-input w-full text-sm" /></div>
          ))}
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">品类 *</label>
            <CategoryTreeSelect value={(form as any).categoryId as number | null} onChange={handleCategoryChange} placeholder="选择品类" />
          </div>
          {[['referencePrice', '参考价 *'], ['priceMin', '价格下限'], ['priceMax', '价格上限'], ['supplier', '供应商']].map(([k, l]) => (
            <div key={k}><label className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">{l}</label>
              <input type={k === 'referencePrice' || k === 'priceMin' || k === 'priceMax' ? 'number' : 'text'} value={(form as any)[k]} onChange={e => setF(k, k === 'supplier' ? e.target.value : Number(e.target.value))} className="neu-input w-full text-sm" /></div>
          ))}
        </div>
        {dynamicFields.length > 0 && <div className="mt-4"><AttributeValueEditor fields={dynamicFields} onChange={setDynamicFields} /></div>}
        {serverError && <p className="text-xs text-red-500 mt-2">{serverError}</p>}
        <button onClick={submit} disabled={saving} className="neu-btn is-info mt-4">{saving ? '保存中...' : '新增目录'}</button>
      </div>

      <div className="neu-card rounded-2xl p-5">
        <h3 className="text-sm font-bold mb-4">批量导入</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={doDownload} className="neu-btn-xs"><Download size={14} /> 下载模板</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }} className="text-sm" />
          <button onClick={doImport} disabled={importing || !file} className="neu-btn-xs is-success"><Upload size={14} /> {importing ? '导入中...' : '开始导入'}</button>
        </div>
        {importResult && (
          <div className="mt-3 p-3 rounded-xl bg-[rgba(96,139,239,0.06)] text-sm">
            <span>共 {importResult.totalRows} 行 · 新增 {importResult.created} · 更新 {importResult.updated} · 失败 {importResult.failed}</span>
            {importResult.failedRows?.length > 0 && <div className="mt-2 max-h-40 overflow-y-auto text-xs">{importResult.failedRows.map((r: any, i: number) => <div key={i} className="text-red-500">行{r.rowNumber} {r.code}: {r.errors?.join(', ')}</div>)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 价格审批 Tab ──

function ApprovalTab() {
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('全部');
  const load = async () => {
    setLoading(true);
    try {
      const params = statusFilter !== '全部' ? `?status=${statusFilter}` : '';
      const res = await fetch(`/api/catalog/applications${params}`, { credentials: 'include', headers: { 'X-Portal': 'web' } });
      if (!res.ok) throw new Error('加载失败');
      setApps(await res.json());
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const review = async (id: string, action: string, body?: any) => {
    try {
      await fetch(`/api/catalog/applications/${id}/review`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' }, body: JSON.stringify({ action, ...body }) });
      toast.success('操作成功'); load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {['全部', 'PENDING', 'COUNTERED', 'APPROVED', 'REJECTED', 'RETURNED', 'WITHDRAWN'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`neu-tab ${statusFilter === s ? 'is-active' : ''}`}>{s === '全部' ? '全部' : s === 'PENDING' ? '待审核' : s === 'COUNTERED' ? '议价中' : s === 'APPROVED' ? '已通过' : s === 'REJECTED' ? '已拒绝' : s === 'RETURNED' ? '已退回' : '已撤回'}</button>
        ))}
        <button onClick={load} disabled={loading} className="neu-btn-xs ml-auto"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {loading ? <div className="flex items-center justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" /></div>
        : apps.length === 0 ? <p className="text-center py-16 text-sm text-[var(--muted-foreground)]">暂无记录</p>
        : <div className="flex flex-col gap-3">{apps.map((a: any) => (
          <div key={a.id} className="neu-card rounded-2xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold">{a.supplier?.name || '—'}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[rgba(96,139,239,0.1)] text-[var(--accent)]">{a.type === 'NEW_ITEM' ? '新增品类' : a.type === 'JOIN_EXISTING' ? '加入供货' : '报价调整'}</span>
                  <StatusBadge tone={a.status === 'PENDING' ? 'orange' : a.status === 'APPROVED' ? 'green' : a.status === 'REJECTED' ? 'red' : 'blue'}>{a.status}</StatusBadge>
                </div>
                <p className="text-sm">申请物资: <strong>{a.proposedName || a.catalogItem?.name}</strong></p>
                <p className="text-xs text-[var(--muted-foreground)]">报价: ¥{Number(a.quotedPrice || 0).toLocaleString()} {a.deliveryPeriod && `· 交期: ${a.deliveryPeriod}`} {a.region && `· ${a.region}`}</p>
                {a.counterPrice && <p className="text-xs text-orange-500">议价反报价: ¥{Number(a.counterPrice).toLocaleString()}</p>}
              </div>
              {a.status === 'PENDING' && (
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => review(a.id, 'approve')} className="neu-btn-xs is-success">通过</button>
                  <button onClick={() => { const p = prompt('议价反报价金额:'); if (p) review(a.id, 'counter', { counterPrice: Number(p) }); }} className="neu-btn-xs is-warning">议价</button>
                  <button onClick={() => { const r = prompt('退回原因:'); if (r) review(a.id, 'return', { reason: r }); }} className="neu-btn-xs">退回</button>
                  <button onClick={() => { const r = prompt('拒绝理由:'); if (r) review(a.id, 'reject', { reason: r }); }} className="neu-btn-xs is-warning">拒绝</button>
                </div>
              )}
            </div>
          </div>
        ))}</div>}
    </div>
  );
}

// ── 价格趋势 Tab ──

function TrendsTab() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [seriesData, setSeriesData] = useState<{ name: string; color: string; data: { date: string; price: number }[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const { tree } = useCategoryTree();

  useEffect(() => {
    if (!selectedCategoryId) { setSeriesData([]); return; }
    setLoading(true);
    (async () => {
      try {
        const allItems = await listCatalogItems({ categoryId: selectedCategoryId });
        const top5 = allItems.slice(0, 5);
        if (top5.length === 0) { setSeriesData([]); setLoading(false); return; }
        const series = await Promise.all(top5.map(async (item, i) => {
          try {
            const res = await fetch(`/api/catalog/${item.id}/history`, { credentials: 'include', headers: { 'X-Portal': 'web' } });
            const h = await res.json();
            return { name: item.name, color: PALETTE[i % PALETTE.length], data: h.map((p: any) => ({ date: p.recordedAt.slice(0, 10), price: p.price })) };
          } catch { return { name: item.name, color: PALETTE[i % PALETTE.length], data: [] }; }
        }));
        setSeriesData(series.filter(s => s.data.length > 0));
      } catch (e: any) { toast.error(e.message); }
      finally { setLoading(false); }
    })();
  }, [selectedCategoryId]);

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 'calc(100vh - 340px)' }}>
      <div className="flex items-center gap-3">
        <CategoryTreeSelect value={selectedCategoryId} onChange={id => setSelectedCategoryId(id)} placeholder="选择品类查看价格趋势" className="min-w-[200px]" />
        {seriesData.length > 0 && <span className="text-xs text-[var(--muted-foreground)]">显示 {seriesData.length} 个目录项</span>}
      </div>
      {loading ? <div className="flex items-center justify-center flex-1"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" /></div>
        : seriesData.length > 0 ? <PriceTrendChart series={seriesData} title="" />
        : selectedCategoryId ? <div className="flex items-center justify-center flex-1 text-sm text-[var(--muted-foreground)]">该品类暂无目录项或价格历史数据</div>
        : <div className="flex items-center justify-center flex-1 text-sm text-[var(--muted-foreground)]">👆 从上方选择品类，自动展示该品类下目录项的价格趋势</div>}
    </div>
  );
}

// ── 价格预警 Tab ──

function AlertsTab() {
  const [subtab, setSubtab] = useState<'rules' | 'alerts'>('rules');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRules = async () => { try { setRules(await listAlertRules()); } catch (e: any) { toast.error(e.message); } };
  const loadAlerts = async () => { try { setAlerts(await listAlerts()); } catch (e: any) { toast.error(e.message); } };

  useEffect(() => { setLoading(true); (subtab === 'rules' ? loadRules() : loadAlerts()).finally(() => setLoading(false)); }, [subtab]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={() => setSubtab('rules')} className={`neu-tab ${subtab === 'rules' ? 'is-active' : ''}`}>预警规则</button>
        <button onClick={() => setSubtab('alerts')} className={`neu-tab ${subtab === 'alerts' ? 'is-active' : ''}`}>预警记录</button>
      </div>
      {loading ? <div className="flex justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" /></div>
        : subtab === 'rules' ? (
          <div className="neu-card rounded-2xl overflow-hidden">
            <table className="neu-table w-full">
              <thead><tr><th>规则名称</th><th className="text-center">类型</th><th className="text-center">阈值</th><th className="text-center">品类</th><th className="text-center">状态</th><th className="text-center">操作</th></tr></thead>
              <tbody>
                {rules.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-sm text-[var(--muted-foreground)]">暂无规则</td></tr>
                  : rules.map(r => (
                    <tr key={r.id}><td className="font-medium">{r.name}</td>
                      <td className="text-center"><span className="text-xs px-2 py-0.5 rounded bg-[rgba(96,139,239,0.1)] text-[var(--accent)]">{ALERT_TYPE_LABELS[r.alertType] || r.alertType}</span></td>
                      <td className="text-center tabular-nums font-mono text-sm">{r.alertType === 'EXPIRING' ? `${r.threshold}天` : `${r.threshold}%`}</td>
                      <td className="text-center text-xs text-[var(--muted-foreground)]">{r.category?.name || '全部品类'}</td>
                      <td className="text-center">{r.enabled ? <span className="text-green-600 text-xs font-semibold">启用</span> : <span className="text-gray-400 text-xs">停用</span>}</td>
                      <td className="text-center">
                        <button onClick={async () => { await toggleAlertRule(r.id); loadRules(); }} className="neu-btn-xs">{r.enabled ? '停用' : '启用'}</button>
                        <button onClick={async () => { if (confirm('删除？')) { await deleteAlertRule(r.id); loadRules(); } }} className="neu-btn-xs is-warning ml-1"><X size={12} /></button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="neu-card rounded-2xl overflow-hidden">
            <table className="neu-table w-full">
              <thead><tr><th>时间</th><th>目录项</th><th>规则</th><th>消息</th><th className="text-center">触发值</th></tr></thead>
              <tbody>
                {alerts.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-sm text-[var(--muted-foreground)]">暂无记录</td></tr>
                  : alerts.map(a => (
                    <tr key={a.id} className={a.isRead ? '' : 'bg-[rgba(96,139,239,0.04)]'}>
                      <td className="text-xs text-[var(--muted-foreground)]">{new Date(a.createdAt).toLocaleString('zh-CN')}</td>
                      <td><span className="font-medium">{a.catalogItem?.name}</span><div className="text-[10px] font-mono text-[var(--accent)]">{a.catalogItem?.code}</div></td>
                      <td className="text-xs">{a.rule?.name}</td>
                      <td className="text-sm">{a.message}</td>
                      <td className="text-center tabular-nums font-mono text-sm">{a.triggerValue}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

// ── 目录版本 Tab ──

function VersionsTab() {
  const [versions, setVersions] = useState<CatalogVersionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', version: '', effectiveAt: '', description: '' });
  const [diffA, setDiffA] = useState<number | null>(null);
  const [diffB, setDiffB] = useState<number | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => { setLoading(true); try { setVersions(await listVersions()); } catch (e: any) { toast.error(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setShowCreate(true)} className="neu-btn is-info"><Plus size={16} /> 创建版本</button>
      </div>
      {showCreate && (
        <div className="neu-card rounded-2xl p-5">
          <h3 className="text-sm font-semibold mb-3">创建目录版本快照</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {[['name', '版本名称', 'text'], ['version', '版本号', 'text'], ['effectiveAt', '生效日期', 'date'], ['description', '备注', 'text']].map(([k, l, t]) => (
              <div key={k}><label className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">{l}</label>
                <input type={t} value={(form as any)[k]} onChange={e => setForm((p: any) => ({ ...p, [k]: e.target.value }))} className="neu-input w-full text-sm" /></div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowCreate(false)} className="neu-btn-xs">取消</button>
            <button onClick={async () => { setSaving(true); try { await createVersion(form); toast.success('已创建'); setShowCreate(false); load(); } catch (e: any) { toast.error(e.message); } finally { setSaving(false); } }} disabled={saving} className="neu-btn-xs is-success">{saving ? '创建中...' : '创建快照'}</button>
          </div>
        </div>
      )}
      {loading ? <div className="flex justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" /></div>
        : versions.length === 0 ? <p className="text-center py-16 text-sm text-[var(--muted-foreground)]">暂无版本</p>
        : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {versions.map(v => (
            <div key={v.id} className="neu-card rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between"><span className="text-sm font-bold">{v.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${v.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : v.status === 'ARCHIVED' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'}`}>{v.status === 'ACTIVE' ? '生效' : v.status === 'ARCHIVED' ? '归档' : '草稿'}</span></div>
              <code className="text-xs font-mono text-[var(--accent)]">{v.version}</code>
              <div className="text-xs text-[var(--muted-foreground)]">{v.effectiveAt?.slice(0, 10)} · {v.user?.displayName}</div>
              <div className="flex gap-1 mt-auto pt-2">
                <button onClick={() => setDiffA(diffA === v.id ? null : v.id)} className={`neu-btn-xs ${diffA === v.id ? 'is-active' : ''}`}>A</button>
                <button onClick={() => setDiffB(diffB === v.id ? null : v.id)} className={`neu-btn-xs ${diffB === v.id ? 'is-active' : ''}`}>B</button>
                {v.status !== 'ACTIVE' && <button onClick={async () => { await changeVersionStatus(v.id, 'ACTIVE'); load(); }} className="neu-btn-xs is-success ml-auto">生效</button>}
                {v.status !== 'ARCHIVED' && <button onClick={async () => { await changeVersionStatus(v.id, 'ARCHIVED'); load(); }} className="neu-btn-xs ml-auto">归档</button>}
              </div>
            </div>
          ))}
        </div>}
      {(diffA && diffB) && <div className="flex justify-center"><button onClick={async () => { try { setDiff(await compareVersions(diffA, diffB)); } catch (e: any) { toast.error(e.message); } }} className="neu-btn is-info">对比 A vs B</button></div>}
      {diff && (
        <div className="neu-card rounded-2xl p-5">
          <h3 className="text-sm font-bold mb-3">{diff.versionA} → {diff.versionB}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 rounded-xl bg-green-50"><span className="font-semibold text-green-700">新增 {diff.added.length} 项</span></div>
            <div className="p-3 rounded-xl bg-red-50"><span className="font-semibold text-red-700">下架 {diff.removed.length} 项</span></div>
            <div className="p-3 rounded-xl bg-orange-50"><span className="font-semibold text-orange-700">价格变化 {diff.priceChanges.length} 项</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 供应商维度 Tab ──

function SuppliersTab() {
  const [tab, setTab] = useState<'coverage' | 'price'>('coverage');
  const [coverage, setCoverage] = useState<SupplierCoverage[]>([]);
  const [priceData, setPriceData] = useState<SupplierPriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    (tab === 'coverage' ? getSupplierCoverage() : getSupplierPriceComparison())
      .then(d => { if (tab === 'coverage') setCoverage(d as unknown as SupplierCoverage[]); else setPriceData(d as unknown as SupplierPriceItem[]); })
      .catch(e => toast.error(e.message)).finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={() => setTab('coverage')} className={`neu-tab ${tab === 'coverage' ? 'is-active' : ''}`}>品类覆盖</button>
        <button onClick={() => setTab('price')} className={`neu-tab ${tab === 'price' ? 'is-active' : ''}`}>价格对比</button>
      </div>
      {loading ? <div className="flex justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" /></div>
        : tab === 'coverage' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {coverage.map(s => (
              <div key={s.supplier} className="neu-card rounded-2xl p-4 cursor-pointer hover:bg-[rgba(96,139,239,0.04)]" onClick={() => setSelectedSupplier(selectedSupplier === s.supplier ? null : s.supplier)}>
                <div className="flex items-center justify-between"><span className="text-sm font-bold">{s.supplier}</span><span className="text-xs font-mono text-[var(--accent)]">{s.categoryCount} 类</span></div>
                {selectedSupplier === s.supplier && <p className="text-xs text-[var(--muted-foreground)] mt-2">{s.categories.join('、')}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {priceData.map(s => (
              <div key={s.supplier} className="neu-card rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2"><span className="text-sm font-bold">{s.supplier}</span><span className="text-xs text-[var(--muted-foreground)]">均价 <strong>¥{s.avgPrice.toLocaleString()}</strong> · {s.items.length} 项</span></div>
                <table className="neu-table w-full text-xs"><thead><tr><th>编码</th><th>名称</th><th className="text-right">参考价</th></tr></thead><tbody>{s.items.map((i: any) => <tr key={i.code}><td className="font-mono text-[var(--accent)]">{i.code}</td><td>{i.name}</td><td className="text-right tabular-nums font-medium">¥{i.price.toLocaleString()}</td></tr>)}</tbody></table>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── 操作日志 Tab ──

function LogsTab() {
  const [logs, setLogs] = useState<CatalogAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('全部');

  useEffect(() => { setLoading(true); listCatalogAuditLogs().then(setLogs).catch(e => toast.error(e.message)).finally(() => setLoading(false)); }, []);

  const actions = ['全部', ...Object.keys(LOG_LABELS)];
  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (action !== '全部' && l.action !== action) return false;
      if (search) { const kw = search.toLowerCase(); const details = typeof l.details === 'object' ? JSON.stringify(l.details) : ''; if (!(l.resourceType || '').toLowerCase().includes(kw) && !details.toLowerCase().includes(kw)) return false; }
      return true;
    });
  }, [logs, action, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="neu-tab-bar">{actions.map(a => <button key={a} onClick={() => setAction(a)} className={`neu-tab ${action === a ? 'is-active' : ''}`}>{a === '全部' ? '全部' : LOG_LABELS[a] || a}</button>)}</div>
        <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索..." className="neu-input !pl-9 w-full text-sm" />{search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={14} /></button>}</div>
        <button onClick={() => { listCatalogAuditLogs().then(setLogs); }} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      <div className="neu-table-card">
        <table className="neu-table w-full">
          <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象</th><th>详情</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="text-center py-16"><RefreshCw size={22} className="animate-spin mx-auto text-[var(--muted-foreground)]" /></td></tr>
              : filtered.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-sm text-[var(--muted-foreground)]">暂无记录</td></tr>
              : filtered.map(l => (
                <tr key={l.id}>
                  <td className="text-xs whitespace-nowrap">{new Date(l.createdAt).toLocaleString('zh-CN')}</td>
                  <td className="text-sm">{l.user?.displayName || l.user?.username || '—'}</td>
                  <td><span className="text-xs px-1.5 py-0.5 rounded bg-[rgba(96,139,239,0.08)]">{LOG_LABELS[l.action] || l.action}</span></td>
                  <td className="text-sm">{l.resourceType || '—'}</td>
                  <td className="text-xs text-[var(--muted-foreground)] max-w-[300px] truncate">{typeof l.details === 'object' ? JSON.stringify(l.details) : String(l.details || '')}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 主页面 ──

export default function CatalogManagementPage() {
  const [activeTab, setActiveTab] = useState<string>('items');
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include', headers: { 'X-Portal': 'web' } })
      .then(r => r.ok ? r.json() : null)
      .then(u => { if (u?.role) setRole(u.role); setRoleLoading(false); })
      .catch(() => setRoleLoading(false));
  }, []);

  const visibleTabs = TABS.filter(t => !t.roles || (role && t.roles.includes(role)));

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ShoppingCart size={17} /></div>
            <div>
              <div className="page-hero__title">目录管理</div>
              <div className="page-hero__sub">集中管理采购目录的品类树、目录项、价格审批、趋势分析、预警、版本、供应商维度及操作日志</div>
            </div>
          </div>
        </div>
      </div>

      {roleLoading ? <div className="flex justify-center py-8"><RefreshCw size={20} className="animate-spin text-[var(--muted-foreground)]" /></div> : (
        <>
          <div className="neu-tab-bar flex-wrap">
            {visibleTabs.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.key} onClick={() => setActiveTab(t.key)} className={`neu-tab flex items-center gap-1.5 ${activeTab === t.key ? 'is-active' : ''}`}>
                  <Icon size={14} /> {t.label}
                </button>
              );
            })}
          </div>

          <div key={activeTab}>
            {activeTab === 'items' && <ItemsTab />}
            {activeTab === 'tree' && <CategoryTreeTab />}
            {activeTab === 'entry' && <EntryTab />}
            {activeTab === 'approval' && <ApprovalTab />}
            {activeTab === 'trends' && <TrendsTab />}
            {activeTab === 'alerts' && <AlertsTab />}
            {activeTab === 'versions' && <VersionsTab />}
            {activeTab === 'suppliers' && <SuppliersTab />}
            {activeTab === 'logs' && <LogsTab />}
          </div>
        </>
      )}
    </div>
  );
}
