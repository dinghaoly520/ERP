'use client';

import { useEffect, useId, useMemo, useRef, useState, Suspense } from 'react';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ShoppingCart, Package, RefreshCw, ChevronUp, X, Search, GitBranch,
  PenLine, CheckCircle, TrendingUp, TrendingDown, Bell, Archive, Building2, FileText,
  Upload, Download, Plus, Leaf, Folder,
  Zap, AlertTriangle, Radar, Sparkles, MousePointerClick,
  CheckCheck, Eye, FileSpreadsheet, Wand2,
  type LucideIcon,
} from 'lucide-react';
import { StatusBadge, Modal } from '@/components/workbench';
import { fetchCurrentUser, type AuthUser } from '@/lib/api/auth';
import {
  changeCatalogStatus, getCatalogStats, listCatalogItems, createCatalogItem, updateCatalogItem,
  exportCatalog,
  downloadImportTemplate, importCatalogFile, setItemAttributes,
  createCategory, updateCategory, deleteCategory, toggleCategoryStatus, moveCategory,
  createAttributeTemplate, deleteAttributeTemplate,
  listAlertRules, createAlertRule, updateAlertRule, listAlerts, deleteAlertRule, toggleAlertRule,
  markAlertRead, markAlertResolved,
  listVersions, createVersion, changeVersionStatus, compareVersions,
  getSupplierCoverage, getSupplierPriceComparison,
  logSearch, toggleSubscribe, getPriceHistory, getPricePrediction,
  listApplications, reviewCatalogApplication,
  getPriceRadar, getSearchInsights,
  listCatalogAuditLogs,
  aiClassifyCatalogItem, getAiPriceAnalysis,
  type CatalogItem, type CatalogItemInput, type CatalogStats, type ImportResult, type CatalogAuditLog,
  type AiClassifyResult, type AiClassifyAttribute, type AiPriceAnalysisResult,
  type AlertRule, type AlertRecord, type CatalogVersionData, type VersionDiff,
  type SupplierCoverage, type SupplierPriceItem,
  type CatalogApplication, type PriceRadarData, type SearchInsights,
} from '@/lib/api/catalog-admin';
import { ConfirmHost, confirmDialog } from '@/components/catalog/confirm-dialog';
import { useSort, SortableTh } from '@/lib/hooks/use-sort';
import { useFormAutosave, useUnsavedGuard } from '@/lib/hooks/use-form-autosave';
import { useCategoryTree } from '@/lib/hooks/use-category-tree';
import { findNode, type CategoryNode } from '@/lib/category-tree-utils';
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

/** 内部岗位（与后端写接口 @Roles 放行集对齐）；其余角色只读浏览 */
const INTERNAL_ROLES = ['admin', 'leader', 'staff'] as const;

const TABS: { key: string; label: string; icon: LucideIcon; roles?: readonly string[] }[] = [
  { key: 'items', label: '目录列表', icon: Package },
  { key: 'tree', label: '品类树', icon: GitBranch, roles: INTERNAL_ROLES },
  { key: 'entry', label: '价格录入', icon: PenLine },
  // 以下 6 个页签的数据接口均为内部角色闸门（@Roles），非内部角色进入即 403 刷屏 → 直接隐藏
  { key: 'approval', label: '价格审批', icon: CheckCircle, roles: INTERNAL_ROLES },
  { key: 'trends', label: '价格趋势', icon: TrendingUp, roles: INTERNAL_ROLES },
  { key: 'alerts', label: '价格预警', icon: Bell, roles: INTERNAL_ROLES },
  { key: 'versions', label: '目录版本', icon: Archive, roles: INTERNAL_ROLES },
  { key: 'suppliers', label: '供应商维度', icon: Building2, roles: INTERNAL_ROLES },
  { key: 'logs', label: '操作日志', icon: FileText, roles: INTERNAL_ROLES },
];

/** cgzxui 规范 hairline（标题行/KPI 行/区块间分割） */
const HAIRLINE = { borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)' } as const;
/** neu-table-card 内行分隔 hairline */
const ROW_HAIRLINE = { borderTop: '1px solid oklch(0.55 0.03 258 / 0.08)' } as const;

// ── 通用空状态 ──

type TreeLike = { children?: TreeLike[] | null };
function countLeaves(nodes: TreeLike[] = []): number {
  return nodes.reduce((s, n) => s + (n.children && n.children.length ? countLeaves(n.children) : 1), 0);
}

function EmptyHint({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-sm text-[var(--muted-foreground)]">
      <Icon size={32} className="opacity-30" />
      <p>{text}</p>
    </div>
  );
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(u);
}

// ── AI 辅助展示 helpers ──

/** 置信度归一为百分数（兼容 0~1 与 0~100 两种返回） */
const toPct = (c: number | null | undefined) => {
  const n = typeof c === 'number' && Number.isFinite(c) ? c : 0;
  return Math.round(n <= 1 ? n * 100 : n);
};

/** 把 AI 返回的属性值合并进动态属性区（按 templateId 优先、fieldKey 兜底；onlyEmpty 时不覆盖用户已填值；SELECT 校验选项合法性） */
function mergeAiAttributes(fields: DynamicField[], attrs: AiClassifyAttribute[] | null | undefined, onlyEmpty: boolean): DynamicField[] {
  if (!attrs?.length || !fields.length) return fields;
  return fields.map(f => {
    if (onlyEmpty && f.value) return f;
    const hit = attrs.find(a => (a.templateId != null && a.templateId === f.templateId) || (!!a.fieldKey && a.fieldKey === f.fieldKey));
    if (!hit || hit.value == null || String(hit.value) === '') return f;
    const v = String(hit.value);
    if (f.fieldType === 'SELECT' && f.options?.length && !f.options.includes(v)) return f;
    return { ...f, value: v };
  });
}

type AiSnapshot = { categoryId: number | null; dynamicFields: DynamicField[] };
type AiHint =
  | { kind: 'unavailable' }
  | { kind: 'suggest'; result: AiClassifyResult; snapshot: AiSnapshot }
  | { kind: 'applied'; result: AiClassifyResult; snapshot: AiSnapshot };

// ── 目录列表 Tab ──

function ItemsTab({ canManage }: { canManage: boolean }) {
  const searchParams = useSearchParams();
  const statuses = ['全部', '有效', '价格波动', '即将过期', '待复核', '下架', '停用'];
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [status, setStatus] = useState('全部');
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [detailItem, setDetailItem] = useState<CatalogItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [editItem, setEditItem] = useState<CatalogItem | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = { status };
      if (selectedCategoryId) params.categoryId = selectedCategoryId;
      // stats 与列表解耦：stats 挂掉（非内部角色 403 / 瞬时 500）时 KPI 显示「—」，
      // 列表照常渲染；只有列表本身失败才报错
      const [listRes, statsRes] = await Promise.allSettled([listCatalogItems(params), getCatalogStats()]);
      if (listRes.status === 'fulfilled') {
        setItems(listRes.value);
      } else {
        toast.error(listRes.reason?.message ?? '目录加载失败');
      }
      setStats(statsRes.status === 'fulfilled' ? statsRes.value : null);
    } finally { setLoading(false); }
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

  const allPageSelected = pagedItems.length > 0 && pagedItems.every(i => selected.has(i.id));
  const somePageSelected = pagedItems.some(i => selected.has(i.id));
  const toggleSelect = (id: string) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleSelectPage = () => setSelected(prev => {
    const s = new Set(prev);
    pagedItems.forEach(i => allPageSelected ? s.delete(i.id) : s.add(i.id));
    return s;
  });

  const setItemStatus = async (item: CatalogItem, s: string) => {
    const ok = await confirmDialog({ message: `确认将「${item.name}」状态改为「${s}」？`, danger: s === '下架' || s === '停用' });
    if (!ok) return;
    try { await changeCatalogStatus(item.id, s, `管理端${s}`); toast.success('状态已更新'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const batchSetStatus = async (target: '下架' | '有效') => {
    const ok = await confirmDialog({
      message: target === '下架' ? `确认批量下架选中的 ${selected.size} 个目录项？` : `确认批量启用选中的 ${selected.size} 个目录项？`,
      danger: target === '下架',
    });
    if (!ok) return;
    setBatchBusy(true);
    try {
      const results = await Promise.allSettled([...selected].map(id => changeCatalogStatus(id, target, `管理端批量${target}`)));
      const failed = results.filter(r => r.status === 'rejected').length;
      failed ? toast.error(`批量操作完成，${failed} 项失败`) : toast.success(`批量${target === '下架' ? '下架' : '启用'}成功`);
      setSelected(new Set()); load();
    } finally { setBatchBusy(false); }
  };

  const toggleDetail = (item: CatalogItem) => setDetailItem(d => (d?.id === item.id ? null : item));
  const tone = (s: string): 'green' | 'gray' | 'orange' | 'red' | 'blue' =>
    s === '有效' ? 'green' : s === '下架' || s === '停用' ? 'gray' : s === '待复核' || s === '价格波动' ? 'orange' : s === '即将过期' ? 'red' : 'blue';

  // ── AI 价格研判（详情区，只展示不写库） ──
  const [aiPriceLoading, setAiPriceLoading] = useState(false);
  const [aiPriceResult, setAiPriceResult] = useState<AiPriceAnalysisResult | null>(null);
  const [aiPriceEmpty, setAiPriceEmpty] = useState(false);
  useEffect(() => { setAiPriceResult(null); setAiPriceEmpty(false); setAiPriceLoading(false); }, [detailItem?.id]);

  const runAiPriceAnalysis = async (id: string) => {
    setAiPriceLoading(true); setAiPriceResult(null); setAiPriceEmpty(false);
    try {
      const data = await getAiPriceAnalysis(id);
      if (!data?.backedByData || !data.analysis) setAiPriceEmpty(true);
      else setAiPriceResult(data);
    } catch {
      // 接口报错（含端点未就绪）→ 柔和降级，不阻塞详情浏览
      setAiPriceEmpty(true);
    } finally {
      setAiPriceLoading(false);
    }
  };

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
      <div className="wb-toolbar flex-wrap">
        <div className="neu-tab-bar">
          {statuses.map(s => <button key={s} onClick={() => { setStatus(s); setPage(1); setSelected(new Set()); }} className={`neu-tab ${status === s ? 'is-active' : ''}`}>{s}</button>)}
        </div>
        <CategoryTreeSelect value={selectedCategoryId} onChange={(id) => { setSelectedCategoryId(id); setPage(1); setSelected(new Set()); }} placeholder="按品类筛选" className="min-w-[160px]" />
        <div className="relative flex-1 min-w-[140px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); setSelected(new Set()); }} placeholder="搜索编码、名称、规格、供应商" aria-label="搜索目录" onKeyDown={e => { if (e.key === 'Enter' && search.trim()) { logSearch(search.trim()).catch(() => {}); } }} className="neu-input !pl-9 w-full text-sm" />
          {search && <button onClick={() => { setSearch(''); setSelected(new Set()); }} aria-label="清除搜索" className="absolute right-2 top-1/2 -translate-y-1/2"><X size={14} /></button>}
        </div>
        <button onClick={load} disabled={loading} aria-label="刷新目录列表" className="neu-btn-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {canManage && selected.size > 0 && (
        <div className="neu-batch-bar">
          <span className="neu-batch-bar-count">已选 <strong>{selected.size}</strong> 条</span>
          <div className="neu-batch-bar-spacer" />
          <button onClick={() => batchSetStatus('下架')} disabled={batchBusy} className="neu-btn-xs is-warning">批量下架</button>
          <button onClick={() => batchSetStatus('有效')} disabled={batchBusy} className="neu-btn-xs is-success">批量启用</button>
          <button onClick={() => setSelected(new Set())} disabled={batchBusy} className="neu-btn-xs">取消选择</button>
        </div>
      )}
      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[840px]">
            <thead><tr>
              {canManage && (
                <th className="w-10 text-center">
                  <input type="checkbox" checked={allPageSelected} ref={el => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                    onChange={toggleSelectPage} aria-label="全选当页" className="neu-checkbox" />
                </th>
              )}
              <SortableTh label="编码" field="code" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
              <SortableTh label="名称/规格" field="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
              <th className="text-center">品类</th>
              <SortableTh label="参考价" field="referencePrice" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
              <th className="text-center">供应商</th>
              <th className="text-center">状态</th>
              <th className="text-center">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={canManage ? 8 : 7} className="px-4 py-16 text-center"><RefreshCw size={22} className="animate-spin mx-auto text-[var(--muted-foreground)]" /><p className="text-xs mt-2 text-[var(--muted-foreground)]">加载中...</p></td></tr>
                : pagedItems.length === 0 ? <tr><td colSpan={canManage ? 8 : 7} className="px-4 py-16 text-center"><p className="text-sm text-[var(--muted-foreground)]">暂无目录</p></td></tr>
                : pagedItems.map(item => (
                  <tr key={item.id} className="row-clickable" tabIndex={0}
                    aria-label={`查看「${item.name}」详情`}
                    onClick={() => toggleDetail(item)}
                    onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggleDetail(item); } }}>
                    {canManage && (
                      <td className="text-center" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} aria-label={`选择「${item.name}」`} className="neu-checkbox" />
                      </td>
                    )}
                    <td className="text-center font-mono text-xs text-[var(--accent)]">{item.code}</td>
                    <td><div className="font-bold text-[var(--foreground)]">{item.name}</div><div className="text-xs text-[var(--muted-foreground)]">{item.specification}</div></td>
                    <td className="text-center text-xs text-[var(--muted-foreground)]">{item.categoryPath || `${item.group || ''} > ${item.category}`}</td>
                    <td className="text-center font-bold tabular-nums">¥{(item.referencePrice ?? 0).toLocaleString('zh-CN')}</td>
                    <td className="text-center">{item.supplier}</td>
                    <td className="text-center"><StatusBadge tone={tone(item.status)}>{item.status}</StatusBadge>{(item as any).lifecycleStage && (item as any).lifecycleStage !== item.status ? <span className="text-[10px] block text-[var(--muted-foreground)]">{(item as any).lifecycleStage}</span> : null}</td>
                    <td onClick={e => e.stopPropagation()} className="text-center whitespace-nowrap">
                      {canManage && <button onClick={() => setEditItem(item)} className="neu-btn-xs is-info">编辑</button>}
                      {canManage && (item.status === '有效'
                        ? <>
                            <button onClick={() => setItemStatus(item, '下架')} className="neu-btn-xs is-warning ml-1">下架</button>
                            <button onClick={() => setItemStatus(item, '停用')} className="neu-btn-xs is-danger ml-1">停用</button>
                          </>
                        : <button onClick={() => setItemStatus(item, '有效')} className="neu-btn-xs is-success ml-1">启用</button>)}
                      <button onClick={async (e) => { e.stopPropagation(); try { const d = await toggleSubscribe(item.id); toast.success(d.subscribed ? '已订阅变更通知' : '已取消订阅'); } catch { toast.error('操作失败'); } }} aria-label="订阅或取消订阅变更通知" className="neu-btn-xs ml-1" title="订阅/取消订阅"><Bell size={11}/></button>
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
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="上一页" className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-[-90deg]" /></button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="下一页" className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-90" /></button>
            </div>
          </div>
        )}
      </div>
      {detailItem && (
        <div className="wb-panel">
          <div className="wb-panel-header">
            <h4 className="text-sm font-bold">{detailItem.name}</h4>
            <button onClick={() => setDetailItem(null)} aria-label="关闭详情" className="neu-btn-xs"><X size={14}/></button>
          </div>
          <div className="wb-panel-body">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><span className="text-[var(--muted-foreground)] text-xs">编码</span><p className="font-mono text-xs">{detailItem.code}</p></div>
              <div><span className="text-[var(--muted-foreground)] text-xs">规格</span><p>{detailItem.specification || '—'}</p></div>
              <div><span className="text-[var(--muted-foreground)] text-xs">参考价</span><p className="font-bold tabular-nums">¥{(detailItem.referencePrice ?? 0).toLocaleString('zh-CN')}</p></div>
              <div><span className="text-[var(--muted-foreground)] text-xs">国标号</span><p className="text-xs font-mono">{(detailItem as any).nationalStandard || '—'}</p></div>
              <div><span className="text-[var(--muted-foreground)] text-xs">生命周期</span><p><span className="text-xs px-1.5 py-0.5 rounded bg-[var(--accent-tint)]">{(detailItem as any).lifecycleStage || detailItem.status}</span></p></div>
              <div><span className="text-[var(--muted-foreground)] text-xs">供应商</span><p>{detailItem.supplier || '—'}</p></div>
              <div><span className="text-[var(--muted-foreground)] text-xs">区域</span><p>{detailItem.region || '—'}</p></div>
              <div><span className="text-[var(--muted-foreground)] text-xs">有效期</span><p>{detailItem.validUntil?.slice(0, 10) || '—'}</p></div>
              <div><span className="text-[var(--muted-foreground)] text-xs">价格区间</span><p className="tabular-nums">¥{(detailItem.priceMin ?? 0).toLocaleString()} - ¥{(detailItem.priceMax ?? 0).toLocaleString()}</p></div>
              <div><span className="text-[var(--muted-foreground)] text-xs">最近成交价</span><p className="font-medium tabular-nums">¥{(detailItem.lastDealPrice ?? 0).toLocaleString()}</p></div>
              {detailItem.changeRate != null && (
                <div><span className="text-[var(--muted-foreground)] text-xs">价格变化</span><p className={detailItem.changeRate > 0 ? 'text-[var(--danger)]' : detailItem.changeRate < 0 ? 'text-[var(--success)]' : ''}>{detailItem.changeRate}%</p></div>
              )}
            </div>
            <div className="mt-4 pt-3 flex items-center gap-2 flex-wrap" style={HAIRLINE}>
              <button onClick={() => runAiPriceAnalysis(detailItem.id)} disabled={aiPriceLoading}
                aria-busy={aiPriceLoading} className="neu-btn-soft">
                {aiPriceLoading ? <RefreshCw size={14} className="animate-spin" /> : <Wand2 size={14} strokeWidth={1.5} />}
                {aiPriceLoading ? '研判中…' : 'AI 价格研判'}
              </button>
              <span className="text-[11px] text-[var(--muted-foreground)]">基于历史成交与同品类价格分布，仅供参考</span>
            </div>
            <div aria-live="polite">
              {aiPriceEmpty && (
                <p role="status" className="mt-3 text-xs px-3 py-2.5 rounded-xl bg-[var(--accent-tint)] text-[var(--muted-foreground)]">暂无 AI 研判</p>
              )}
              {aiPriceResult?.analysis && (() => {
                const a = aiPriceResult.analysis;
                const sevCls = a.severity === 'high' ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                  : a.severity === 'medium' ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
                  : 'bg-[var(--success-soft)] text-[var(--success)]';
                const sevLabel = a.severity === 'high' ? '高风险' : a.severity === 'medium' ? '中风险' : '低风险';
                return (
                  <div role="status" className="mt-3 p-3.5 rounded-xl bg-[var(--accent-tint)]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Wand2 size={14} strokeWidth={1.5} className="text-[var(--accent)]" />
                      <span className="text-xs font-bold text-[var(--foreground)]">AI 价格研判</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${a.abnormal ? sevCls : 'bg-[var(--success-soft)] text-[var(--success)]'}`}>
                        {a.abnormal ? `异常 · ${sevLabel}` : '未见异常'}
                      </span>
                      <span className="text-[11px] text-[var(--muted-foreground)]">置信度 {toPct(a.confidence)}%</span>
                    </div>
                    {a.reasons?.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
                        {a.reasons.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-[var(--accent)] flex-shrink-0">·</span><span>{r}</span></li>)}
                      </ul>
                    )}
                    {a.suggestion && (
                      <p className="mt-2 text-xs"><strong className="text-[var(--foreground)]">建议：</strong><span className="text-[var(--muted-foreground)]">{a.suggestion}</span></p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {editItem && <ItemEditDialog item={editItem} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); load(); }} />}
    </div>
  );
}

/** 目录项行内编辑弹窗（PATCH admin/items/:id） */
function ItemEditDialog({ item, onClose, onSaved }: { item: CatalogItem; onClose: () => void; onSaved: () => void }) {
  const uid = useId();
  const [form, setForm] = useState({
    name: item.name, specification: item.specification ?? '', unit: item.unit ?? '',
    category: item.category ?? '', supplier: item.supplier ?? '',
    referencePrice: item.referencePrice ?? 0, priceMin: item.priceMin ?? 0, priceMax: item.priceMax ?? 0,
    validUntil: item.validUntil?.slice(0, 10) ?? '', remark: item.remark ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string | number) => { setForm(p => ({ ...p, [k]: v })); setError(''); };

  const save = async () => {
    if (!form.name.trim()) { setError('名称不能为空'); return; }
    if (!form.referencePrice || Number(form.referencePrice) <= 0) { setError('请填写有效的参考价'); return; }
    setSaving(true);
    try {
      const { id, createdAt, updatedAt, ...rest } = item;
      await updateCatalogItem(id, { ...rest, ...form, validUntil: form.validUntil || null, remark: form.remark || null });
      toast.success('目录已更新'); onSaved();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  const field = (k: keyof typeof form, label: string, opts: { type?: string; required?: boolean; className?: string } = {}) => (
    <div className={opts.className}>
      <label htmlFor={`${uid}-${k}`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">{label}{opts.required && <span className="text-[var(--danger)] ml-0.5">*</span>}</label>
      <input id={`${uid}-${k}`} type={opts.type ?? 'text'} value={form[k]} onChange={e => set(k, opts.type === 'number' ? Number(e.target.value) : e.target.value)} className="workbench-input w-full text-sm" />
    </div>
  );

  return (
    <Modal open onClose={onClose} size="md" title="编辑目录项" description={`编码 ${item.code}`}
      footer={<>
        <button onClick={onClose} className="neu-btn-soft">取消</button>
        <button onClick={save} disabled={saving} className="neu-btn-primary is-info">{saving ? '保存中...' : '保存修改'}</button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field('name', '商品名称', { required: true })}
        {field('specification', '规格型号')}
        {field('referencePrice', '参考价（元）', { type: 'number', required: true })}
        {field('unit', '单位')}
        {field('priceMin', '价格下限（元）', { type: 'number' })}
        {field('priceMax', '价格上限（元）', { type: 'number' })}
        {field('category', '品类')}
        {field('supplier', '供应商')}
        {field('validUntil', '有效期', { type: 'date' })}
      </div>
      <div>
        <label htmlFor={`${uid}-remark`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">备注</label>
        <textarea id={`${uid}-remark`} value={form.remark} onChange={e => set('remark', e.target.value)} rows={2} className="neu-input w-full text-sm resize-y" />
      </div>
      {error && <p className="text-xs font-medium text-[var(--danger)]" role="alert">{error}</p>}
    </Modal>
  );
}

// ── 品类树 Tab ──

function CategoryTreeTab({ canManage }: { canManage: boolean }) {
  const { tree, loading, error, refresh } = useCategoryTree();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedNode = selectedId ? findNode(tree, selectedId) : null;
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create-root' | 'create-child' | 'edit'>('create-root');
  const [formParentId, setFormParentId] = useState<number | null>(null);
  const [formInitial, setFormInitial] = useState<{ name: string; code: string; isLeaf: boolean; icon: string } | undefined>();
  const [attrEditorOpen, setAttrEditorOpen] = useState(false);
  const [attrNode, setAttrNode] = useState<CategoryNode | null>(null);
  const [moveNode, setMoveNode] = useState<CategoryNode | null>(null);
  const [moveParentId, setMoveParentId] = useState<number | null>(null);
  const [moveSortOrder, setMoveSortOrder] = useState(0);
  const [moveSaving, setMoveSaving] = useState(false);
  const moveUid = useId();

  const handleAddRoot = () => { setFormMode('create-root'); setFormParentId(null); setFormInitial(undefined); setFormOpen(true); };
  const handleAddChild = (p: CategoryNode) => { setFormMode('create-child'); setFormParentId(p.id); setFormInitial(undefined); setFormOpen(true); };
  const handleEdit = (node: CategoryNode) => { setFormMode('edit'); setFormParentId(node.id); setFormInitial({ name: node.name, code: node.code || '', isLeaf: node.isLeaf, icon: node.icon || '' }); setFormOpen(true); };
  const handleDelete = async (node: CategoryNode) => {
    const ok = await confirmDialog({ message: `确认删除品类「${node.name}」？删除后不可恢复。`, danger: true, confirmText: '删除' });
    if (!ok) return;
    try { await deleteCategory(node.id); toast.success('已删除'); refresh(); } catch (e: any) { toast.error(e.message); }
  };
  const handleToggle = async (node: CategoryNode) => {
    try { await toggleCategoryStatus(node.id); toast.success(node.status === 'ACTIVE' ? '已停用' : '已启用'); refresh(); } catch (e: any) { toast.error(e.message); }
  };
  const handleMoveOpen = (node: CategoryNode) => { setMoveNode(node); setMoveParentId(node.parentId ?? null); setMoveSortOrder(node.sortOrder ?? 0); };
  const handleMoveSave = async () => {
    if (!moveNode) return;
    setMoveSaving(true);
    try {
      await moveCategory(moveNode.id, { newSortOrder: moveSortOrder, newParentId: moveParentId });
      toast.success('已移动'); setMoveNode(null); refresh();
    } catch (e: any) { toast.error(e.message); } finally { setMoveSaving(false); }
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
        onEdit={canManage ? handleEdit : undefined}
        onDelete={canManage ? handleDelete : undefined}
        onToggleStatus={canManage ? handleToggle : undefined}
        onAddRoot={canManage ? handleAddRoot : undefined}
        onAddChild={canManage ? handleAddChild : undefined}
        onMove={canManage ? handleMoveOpen : undefined}
        onConfigureAttrs={(n) => { if (!canManage) return; setAttrNode(n); setAttrEditorOpen(true); }} />
      <div className="wb-panel overflow-y-auto">
        <div className="wb-panel-body">
        {selectedNode ? (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-bold">{selectedNode.name}</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-[var(--muted-foreground)]">编码</span><p className="font-medium font-mono">{selectedNode.code || '—'}</p></div>
              <div><span className="text-[var(--muted-foreground)]">状态</span><p className={`font-medium ${selectedNode.status === 'ACTIVE' ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}`}>{selectedNode.status === 'ACTIVE' ? '启用' : '停用'}</p></div>
              <div><span className="text-[var(--muted-foreground)]">类型</span><p className="font-medium flex items-center gap-1">{selectedNode.isLeaf ? <><Leaf size={13} className="text-[var(--success)]" /> 叶子</> : <><Folder size={13} className="text-[var(--accent)]" /> 分组</>}</p></div>
              <div><span className="text-[var(--muted-foreground)]">排序</span><p className="font-medium tabular-nums">{selectedNode.sortOrder}</p></div>
            </div>
            {selectedNode.isLeaf && (
              <div>
                <div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold">属性模板</span>
                  {canManage && <button onClick={() => { setAttrNode(selectedNode); setAttrEditorOpen(true); }} className="neu-btn-xs is-info">编辑模板</button>}</div>
                {ct.length > 0 ? <div className="flex flex-col gap-1">{ct.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent-tint)] text-sm">
                    <span className="font-medium">{t.name}</span><code className="text-[10px] font-mono text-[var(--accent)]">{t.fieldKey}</code>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-tint-strong)] text-[var(--accent)]">{t.fieldType}</span>
                    {t.required && <span className="text-[10px] text-[var(--danger)]">必填</span>}
                  </div>))}</div> : <p className="text-sm text-[var(--muted-foreground)]">该品类暂无自定义属性</p>}
              </div>
            )}
          </div>
        ) : <div className="flex items-center justify-center gap-2 h-full text-sm text-[var(--muted-foreground)]"><MousePointerClick size={16} className="opacity-50" /> 选择左侧品类节点</div>}
        </div>
      </div>
      <CategoryFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSave={handleSave} initial={formInitial}
        title={formMode === 'edit' ? '编辑品类' : formMode === 'create-child' ? '新增子节点' : '新增根节点'} />
      <AttributeTemplateEditor open={attrEditorOpen} onClose={() => { setAttrEditorOpen(false); refresh(); }} categoryName={attrNode?.name} templates={ct}
        onSave={async (data) => { await createAttributeTemplate(attrNode!.id, data); refresh(); }}
        onDelete={async (id) => { await deleteAttributeTemplate(id); refresh(); }} />
      <Modal open={!!moveNode} onClose={() => setMoveNode(null)} size="sm" title={`移动品类「${moveNode?.name ?? ''}」`}
        description="更换上级节点或调整排序；后端会校验成环"
        footer={<>
          <button onClick={() => setMoveNode(null)} className="neu-btn-soft">取消</button>
          <button onClick={handleMoveSave} disabled={moveSaving} className="neu-btn-primary is-info">{moveSaving ? '移动中...' : '确认移动'}</button>
        </>}>
        <div className="flex flex-col gap-3">
          <div>
            <span className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">新上级节点（留空为根节点）</span>
            <CategoryTreeSelect value={moveParentId} onChange={id => setMoveParentId(id)} placeholder="根节点" />
          </div>
          <div>
            <label htmlFor={`${moveUid}-sort`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">排序值（越小越靠前）</label>
            <input id={`${moveUid}-sort`} type="number" value={moveSortOrder} onChange={e => setMoveSortOrder(Number(e.target.value))} className="workbench-input w-full text-sm" />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── 价格录入 Tab ──

type EntryForm = CatalogItemInput & { categoryId?: number | null };
const INITIAL_FORM: EntryForm = {
  code: '', name: '', specification: '', category: '', group: '', unit: '',
  referencePrice: 0, priceMin: 0, priceMax: 0, lastDealPrice: 0, averagePrice: 0,
  supplier: '', supplierType: '协议供应商', priceSource: '人工维护', region: '全省',
  taxIncluded: true, freightIncluded: false, changeRate: 0, minOrder: '',
  remark: null, status: '有效', validUntil: null,
};

function EntryTab({ canManage, roleReady }: { canManage: boolean; roleReady: boolean }) {
  const entryUid = useId();
  const [form, setForm] = useState<EntryForm>(INITIAL_FORM);
  const [dynamicFields, setDynamicFields] = useState<DynamicField[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof EntryForm, string>>>({});
  const [draftRestored, setDraftRestored] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasChanges = Object.entries(form).some(([k, v]) => v !== (INITIAL_FORM as any)[k]);
  // enabled 传 hasChanges：表单无改动时不落盘，避免空表单被写成幽灵草稿、
  // 提交后 clearDraft 又被下一个 tick 写回
  const { getDraft, clearDraft } = useFormAutosave('price-entry', form as unknown as Record<string, unknown>, hasChanges);
  useUnsavedGuard(hasChanges);

  // 挂载时恢复未提交草稿（仅一次）；草稿与初始表单全等（提交后残留的空草稿）→ 不提示不恢复
  useEffect(() => {
    if (draftRestored) return;
    const draft = getDraft();
    if (draft) {
      const { _savedAt, ...rest } = draft;
      const sameAsInitial = Object.entries(rest).every(([k, v]) => v === (INITIAL_FORM as any)[k]);
      if (sameAsInitial) {
        clearDraft();
      } else {
        setForm(prev => ({ ...prev, ...(rest as Partial<EntryForm>) }));
        toast.info('已恢复未保存的录入草稿');
      }
    }
    setDraftRestored(true);
  }, [draftRestored, getDraft, clearDraft]);

  const handleCategoryChange = (id: number | null, node?: CategoryNode) => {
    setForm(p => ({ ...p, categoryId: id }));
    setDynamicFields(node?.attributeTemplates?.length ? buildDynamicFields(node.attributeTemplates as any) : []);
  };
  const setF = (key: keyof EntryForm, value: any) => {
    setForm(p => ({ ...p, [key]: value }));
    setServerError('');
    setFieldErrors(prev => { if (!prev[key]) return prev; const n = { ...prev }; delete n[key]; return n; });
  };

  /** 逐字段校验（合并自原 price-entry 子路由的 FieldError 体系） */
  const validate = (): boolean => {
    const e: Partial<Record<keyof EntryForm, string>> = {};
    if (!form.code.trim()) e.code = '请输入目录编码';
    if (!form.name.trim()) e.name = '请输入商品名称';
    if (!form.referencePrice || Number(form.referencePrice) <= 0) e.referencePrice = '请填写有效的参考价';
    if (form.priceMin < 0) e.priceMin = '价格下限不能为负';
    if (form.priceMax < 0) e.priceMax = '价格上限不能为负';
    if (form.priceMin > 0 && form.priceMax > 0 && form.priceMin > form.priceMax) e.priceMax = '价格上限不能低于下限';
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setServerError('');
    if (!validate()) { toast.error('请修正表单中标红的必填项'); return; }
    setSaving(true);
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

  const doDownload = async () => { try { const b = await downloadImportTemplate(); triggerBlobDownload(b, '电子商城目录导入模板.xlsx'); } catch (e: any) { toast.error(e.message); } };

  // ── AI 识别分类与属性（仅预填表单，不直接写库） ──
  const { tree } = useCategoryTree();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHint, setAiHint] = useState<AiHint | null>(null);
  /** AI 请求在途期间用户可能继续编辑 → 品类判定用 ref 取当前最新值；snapshot 仅供 undo */
  const categoryIdRef = useRef<number | null>(form.categoryId ?? null);
  useEffect(() => { categoryIdRef.current = form.categoryId ?? null; }, [form.categoryId]);

  /** 将 AI 结果应用到表单 state（品类走 setState，属性合并进 dynamicFields），返回是否应用成功。
   *  品类未变时以「当前最新」dynamicFields 为合并基底（函数式 setState 的 prev），
   *  不用请求发起时的快照，避免抹掉用户在 AI 返回后手填的值 */
  const applyAiResult = (result: AiClassifyResult): boolean => {
    if (result.categoryId != null && result.categoryId !== categoryIdRef.current) {
      const node = findNode(tree, result.categoryId);
      if (!node) return false; // 树上查不到该品类 → 保留建议态，不自动填
      const freshFields = node.attributeTemplates?.length ? buildDynamicFields(node.attributeTemplates as any) : [];
      setForm(p => ({ ...p, categoryId: result.categoryId }));
      // 品类切换 → 以新建模板为基底覆盖合并（此时字段均为空模板，无用户输入可丢）
      setDynamicFields(() => mergeAiAttributes(freshFields, result.attributes, false));
      return true;
    }
    // 品类未变 → onlyEmpty：仅填空，不覆盖用户已填内容
    setDynamicFields(prev => mergeAiAttributes(prev, result.attributes, true));
    return true;
  };

  const handleAiClassify = async () => {
    const name = form.name.trim();
    if (!name || aiLoading) return;
    setAiLoading(true);
    setAiHint(null);
    try {
      const result = await aiClassifyCatalogItem({
        name,
        specification: form.specification?.trim() || undefined,
        categoryIdHint: form.categoryId ?? undefined,
      });
      // snapshot 仅用于 undo（恢复到 AI 介入前的品类与属性）
      const snapshot: AiSnapshot = { categoryId: form.categoryId ?? null, dynamicFields };
      if (!result?.backedByData) {
        // 后端在「无合适品类」时返回 backedByData:false 但带 reason（LLM 正常工作，
        // 如「该物资不属于集采目录范围」）→ 走 suggest 展示该 reason；无 reason 才是真降级
        if (result?.reason) setAiHint({ kind: 'suggest', result, snapshot });
        else setAiHint({ kind: 'unavailable' });
        return;
      }
      const confidence = typeof result.confidence === 'number' ? result.confidence : 0;
      // 阈值 0.6 与后端默认对齐：达标自动预填（可撤销），未达标仅建议（用户点「采纳」）
      if (result.categoryId != null && confidence >= 0.6) {
        setAiHint({ kind: applyAiResult(result) ? 'applied' : 'suggest', result, snapshot });
      } else if (result.categoryId == null && !!result.attributes?.length && applyAiResult(result)) {
        setAiHint({ kind: 'applied', result, snapshot });
      } else {
        setAiHint({ kind: 'suggest', result, snapshot });
      }
    } catch {
      // 接口报错（含端点未就绪）→ 柔和降级，不清空用户已填内容
      setAiHint({ kind: 'unavailable' });
    } finally {
      setAiLoading(false);
    }
  };

  const adoptAi = () => {
    if (aiHint?.kind !== 'suggest') return;
    if (applyAiResult(aiHint.result)) {
      setAiHint({ kind: 'applied', result: aiHint.result, snapshot: aiHint.snapshot });
    }
  };

  const undoAi = () => {
    if (aiHint?.kind !== 'applied') return;
    setForm(p => ({ ...p, categoryId: aiHint.snapshot.categoryId }));
    setDynamicFields(aiHint.snapshot.dynamicFields);
    setAiHint(null);
  };

  if (!roleReady) return <div className="flex justify-center py-16 text-sm text-[var(--muted-foreground)]" aria-live="polite">权限校验中...</div>;
  if (!canManage) return <EmptyHint icon={PenLine} text="当前账号无目录录入权限，仅可查看其他页签" />;

  const inputClass = (field: keyof EntryForm) => `workbench-input w-full text-sm ${fieldErrors[field] ? 'is-invalid' : ''}`;
  const FieldError = ({ field }: { field: keyof EntryForm }) => fieldErrors[field] ? <p className="text-xs font-medium text-[var(--danger)] mt-0.5" role="alert">{fieldErrors[field]}</p> : null;
  const txtField = (field: keyof EntryForm, label: string, placeholder?: string, required?: boolean) => (
    <div>
      <label htmlFor={`${entryUid}-${field}`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">{label}{required && <span className="text-[var(--danger)] ml-0.5">*</span>}</label>
      <input id={`${entryUid}-${field}`} value={String((form as any)[field] ?? '')} onChange={e => setF(field, e.target.value)} placeholder={placeholder} className={inputClass(field)} aria-invalid={!!fieldErrors[field]} />
      <FieldError field={field} />
    </div>
  );
  const numField = (field: keyof EntryForm, label: string, placeholder?: string) => (
    <div>
      <label htmlFor={`${entryUid}-${field}`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">{label}</label>
      <input id={`${entryUid}-${field}`} type="number" value={(form as any)[field]} onChange={e => setF(field, Number(e.target.value))} placeholder={placeholder} className={inputClass(field)} aria-invalid={!!fieldErrors[field]} />
      <FieldError field={field} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="wb-panel">
        <div className="wb-panel-header">
          <h3 className="text-sm font-bold">手动录入</h3>
          <button onClick={handleAiClassify} disabled={aiLoading || !form.name.trim()}
            title={!form.name.trim() ? '请先填写商品名称' : '根据名称与规格识别品类、预填属性'}
            aria-busy={aiLoading} className="neu-btn-soft">
            {aiLoading ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} strokeWidth={1.5} />}
            {aiLoading ? '识别中…' : 'AI 识别'}
          </button>
        </div>
        <div className="wb-panel-body">
          {aiHint && (
            <div role="status" aria-live="polite" className="mb-4 px-3 py-2.5 rounded-xl bg-[var(--accent-tint)] text-xs flex items-start gap-2">
              <Sparkles size={14} strokeWidth={1.5} className="text-[var(--accent)] mt-0.5 flex-shrink-0" />
              {aiHint.kind === 'unavailable' ? (
                <span className="text-[var(--muted-foreground)]">AI 暂不可用，请手动填写</span>
              ) : (
                <div className="flex-1 flex flex-col gap-1.5">
                  <p className="text-[var(--muted-foreground)] leading-relaxed">
                    <strong className="text-[var(--foreground)]">AI 建议：{aiHint.result.categoryName || '未识别到品类'}</strong>
                    {aiHint.result.categoryId != null && aiHint.result.confidence != null && <span>（置信度 {toPct(aiHint.result.confidence)}%）</span>}
                    {aiHint.result.reason && <span> · {aiHint.result.reason}</span>}
                  </p>
                  <div className="flex items-center gap-2">
                    {aiHint.kind === 'suggest' && aiHint.result.categoryId != null && (
                      <button onClick={adoptAi} className="neu-btn-xs is-info">采纳</button>
                    )}
                    {aiHint.kind === 'applied' && (
                      <>
                        <span className="text-[var(--success)] font-medium">已预填，随表单保存生效</span>
                        <button onClick={undoAi} className="neu-btn-xs">撤销</button>
                      </>
                    )}
                    <button onClick={() => setAiHint(null)} aria-label="关闭 AI 提示" className="neu-btn-xs">忽略</button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {txtField('code', '目录编码', '唯一编码，如 CG-2025-001', true)}
            {txtField('name', '商品名称', '商品通用名称', true)}
            {txtField('specification', '规格型号', '如 500ml×24瓶')}
            {txtField('unit', '单位', '如 个、箱、件')}
          </div>
          <div className="mt-4 max-w-xs">
            <span className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">品类</span>
            <CategoryTreeSelect value={(form.categoryId ?? null) as number | null} onChange={handleCategoryChange} placeholder="选择品类" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            {numField('referencePrice', '参考价（元） *')}
            {numField('priceMin', '价格下限（元）')}
            {numField('priceMax', '价格上限（元）')}
            {txtField('supplier', '供应商', '供应商企业名称')}
          </div>
          {dynamicFields.length > 0 && <div className="mt-4"><AttributeValueEditor fields={dynamicFields} onChange={setDynamicFields} /></div>}
          {serverError && <p className="text-xs font-medium text-[var(--danger)] mt-3" role="alert">{serverError}</p>}
          <div className="flex items-center justify-between gap-3 mt-4" style={HAIRLINE}>
            <p className="text-xs text-[var(--muted-foreground)] pt-3"><span className="text-[var(--danger)]">*</span> 为必填项</p>
            <button onClick={submit} disabled={saving} className="neu-btn-primary is-info mt-3">{saving ? '保存中...' : <><PenLine size={14} /> 新增目录</>}</button>
          </div>
        </div>
      </div>

      <div className="wb-panel">
        <div className="wb-panel-header">
          <h3 className="text-sm font-bold flex items-center gap-2"><Upload size={15} className="text-[var(--accent)]" /> 批量导入</h3>
          <button onClick={doDownload} className="neu-btn-soft"><Download size={13} /> 下载模板</button>
        </div>
        <div className="wb-panel-body">
          <label className="neu-drop-zone w-full sm:max-w-md cursor-pointer">
            <FileSpreadsheet size={20} className="text-[var(--accent)]" />
            <span className="text-sm font-medium mt-1.5">{file ? file.name : '点击选择文件'}</span>
            <span className="text-xs text-[var(--muted-foreground)] mt-0.5">支持 .xlsx / .xls / .csv，目录编码存在则更新，不存在则新增</span>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files?.[0] || null)} className="hidden" aria-label="选择导入文件" />
          </label>
          <div className="mt-3">
            <button onClick={doImport} disabled={importing || !file} className="neu-btn-soft is-success">{importing ? '导入中...' : <><Upload size={14} /> 开始导入</>}</button>
          </div>
          {importResult && (
            <div className="mt-4 p-3 rounded-xl bg-[var(--accent-tint)] text-sm">
              <span>共 {importResult.totalRows} 行 · 新增 {importResult.created} · 更新 {importResult.updated} · 失败 {importResult.failed}</span>
              {importResult.failedRows?.length > 0 && <div className="mt-2 max-h-40 overflow-y-auto text-xs">{importResult.failedRows.map((r: any, i: number) => <div key={i} className="text-[var(--danger)]">行{r.rowNumber} {r.code}: {r.errors?.join(', ')}</div>)}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 价格审批 Tab ──

const APP_STATUS_LABELS: Record<string, string> = {
  PENDING: '待审批', COUNTERED: '议价中', RETURNED: '已退回',
  APPROVED: '已通过', REJECTED: '已拒绝', WITHDRAWN: '已撤回',
};
const APP_TYPE_LABELS: Record<string, string> = { NEW_ITEM: '新增品类', JOIN_EXISTING: '加入供货', PRICE_ADJUST: '报价调整', UPDATE_QUOTE: '报价调整' };
const appStatusTone = (s: string): 'blue' | 'purple' | 'orange' | 'green' | 'red' | 'gray' =>
  s === 'PENDING' ? 'blue' : s === 'COUNTERED' ? 'purple' : s === 'RETURNED' ? 'orange' : s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'red' : 'gray';

type ReviewAction = 'approve' | 'reject' | 'return' | 'counter';

function ApprovalTab({ canManage }: { canManage: boolean }) {
  const [apps, setApps] = useState<CatalogApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [typeFilter, setTypeFilter] = useState('全部');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<{ app: CatalogApplication; action: ReviewAction } | null>(null);

  // 全量加载一次（KPI 反映整体工作量，不随页签筛选而塌缩）；状态/类型/关键字均在客户端过滤
  const load = async () => {
    setLoading(true);
    try { setApps(await listApplications()); }
    catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = apps;
    if (statusFilter !== '全部') list = list.filter(a => a.status === statusFilter);
    if (typeFilter !== '全部') list = list.filter(a => a.type === typeFilter);
    const kw = search.trim();
    if (kw) list = list.filter(a => a.supplier?.name?.includes(kw) || a.proposedName?.includes(kw) || a.catalogItem?.name?.includes(kw) || (a.id && kw === a.id));
    return list;
  }, [apps, statusFilter, typeFilter, search]);

  const stats = useMemo(() => ({
    pending: apps.filter(a => a.status === 'PENDING').length,
    countered: apps.filter(a => a.status === 'COUNTERED').length,
    returned: apps.filter(a => a.status === 'RETURNED').length,
    approved: apps.filter(a => a.status === 'APPROVED' && (a.reviewedAt ? new Date(a.reviewedAt) >= new Date(Date.now() - 30 * 86400000) : false)).length,
  }), [apps]);

  const toggleExpand = (id: string) => setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[['待审批', stats.pending], ['议价中', stats.countered], ['已退回', stats.returned], ['30日内已通过', stats.approved]].map(([label, value]) => (
          <div key={label as string} className="kpi-card p-3 rounded-xl flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</span>
            <span className="text-[1.4rem] font-black tabular-nums text-[var(--foreground)]">{value as number}</span>
          </div>
        ))}
      </div>
      <div className="wb-toolbar flex-wrap">
        <div className="neu-tab-bar">
          {['PENDING', 'COUNTERED', 'RETURNED', 'APPROVED', 'REJECTED', 'WITHDRAWN', '全部'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`neu-tab ${statusFilter === s ? 'is-active' : ''}`}>{s === '全部' ? '全部' : APP_STATUS_LABELS[s] || s}</button>
          ))}
        </div>
        <label className="sr-only" htmlFor="approval-type-filter">申请类型</label>
        <select id="approval-type-filter" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="workbench-input !w-auto min-w-[110px]">
          <option value="全部">全部类型</option><option value="NEW_ITEM">新增品类</option><option value="JOIN_EXISTING">加入供货</option><option value="UPDATE_QUOTE">报价调整</option>
        </select>
        <div className="relative flex-1 min-w-[140px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索供应商 / 目录" aria-label="搜索申请" className="neu-input !pl-9 w-full text-sm" />
          {search && <button onClick={() => setSearch('')} aria-label="清除搜索" className="absolute right-2 top-1/2 -translate-y-1/2"><X size={14} /></button>}
        </div>
        <button onClick={load} disabled={loading} aria-label="刷新审批列表" className="neu-btn-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="neu-table-card">
        {loading ? (
          <div className="p-12 text-center text-sm text-[var(--muted-foreground)]" aria-live="polite">加载中...</div>
        ) : filtered.length === 0 ? (
          <EmptyHint icon={CheckCircle} text={statusFilter === 'PENDING' && !search.trim() ? '暂无待审批申请' : '无匹配申请记录'} />
        ) : filtered.map((app: any) => {
          const isOpen = expanded.has(app.id);
          const canAct = ['PENDING', 'COUNTERED', 'RETURNED'].includes(app.status);
          return (
            <div key={app.id}>
              <div className="flex items-center gap-4 px-5 py-4 cursor-pointer row-clickable" style={ROW_HAIRLINE}
                role="button" tabIndex={0} aria-expanded={isOpen} aria-label={`${APP_TYPE_LABELS[app.type] || app.type}申请，${APP_STATUS_LABELS[app.status]}，点击${isOpen ? '收起' : '展开'}详情`}
                onClick={() => toggleExpand(app.id)}
                onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggleExpand(app.id); } }}>
                <StatusBadge tone={appStatusTone(app.status)}>{APP_STATUS_LABELS[app.status] || app.status}</StatusBadge>
                <span className="neu-tab-count">{APP_TYPE_LABELS[app.type] || app.type}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[var(--foreground)] truncate">{app.type === 'NEW_ITEM' ? app.proposedName || '(未命名)' : app.catalogItem?.name || '(已删除目录)'}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">
                    {app.supplier?.name || '未知供应商'}
                    {app.quotedPrice ? ` · 报价 ¥${Number(app.quotedPrice).toLocaleString('zh-CN')}` : ''}
                    {app.counterPrice ? ` · 议价 ¥${Number(app.counterPrice).toLocaleString('zh-CN')}` : ''}
                  </div>
                </div>
                <span className="text-xs text-[var(--muted-foreground)]">{(app.createdAt || '').slice(0, 10)}</span>
                {canManage && canAct && (
                  <div className="flex flex-wrap gap-1 ml-2" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setReview({ app, action: 'approve' })} className="neu-btn-xs is-success">通过</button>
                    <button onClick={() => setReview({ app, action: 'counter' })} className="neu-btn-xs is-info">议价</button>
                    <button onClick={() => setReview({ app, action: 'return' })} className="neu-btn-xs is-warning">退回</button>
                    <button onClick={() => setReview({ app, action: 'reject' })} className="neu-btn-xs is-danger">拒绝</button>
                  </div>
                )}
                <ChevronUp size={16} className={`ml-1 text-[var(--muted-foreground)] transition-transform ${isOpen ? '' : 'rotate-180'}`} />
              </div>
              {isOpen && (
                <div className="px-5 py-4 text-sm bg-[var(--surface)]" style={ROW_HAIRLINE}>
                  <div className="grid gap-3 md:grid-cols-2 text-[0.8rem]">
                    <div><span className="text-[var(--muted-foreground)]">申请类型：</span><span className="font-bold text-[var(--foreground)]">{APP_TYPE_LABELS[app.type] || app.type}</span></div>
                    <div><span className="text-[var(--muted-foreground)]">供应商：</span><span className="font-bold text-[var(--foreground)]">{app.supplier?.name || '-'}</span></div>
                    {app.type === 'NEW_ITEM' ? (
                      <>
                        <div><span className="text-[var(--muted-foreground)]">拟增名称：</span><span className="font-bold text-[var(--foreground)]">{app.proposedName || '-'}</span></div>
                        <div><span className="text-[var(--muted-foreground)]">拟增规格：</span><span className="font-bold text-[var(--foreground)]">{app.proposedSpec || '-'}</span></div>
                        <div><span className="text-[var(--muted-foreground)]">拟增分类：</span><span className="font-bold text-[var(--foreground)]">{app.proposedCategory || '-'}</span></div>
                        <div><span className="text-[var(--muted-foreground)]">拟增分组：</span><span className="font-bold text-[var(--foreground)]">{app.proposedGroup || '-'}</span></div>
                        <div><span className="text-[var(--muted-foreground)]">拟增单位：</span><span className="font-bold text-[var(--foreground)]">{app.proposedUnit || '-'}</span></div>
                      </>
                    ) : (<>
                      <div><span className="text-[var(--muted-foreground)]">目录编码：</span><span className="font-bold text-[var(--foreground)] font-mono text-xs">{app.catalogItem?.code || '-'}</span></div>
                      <div><span className="text-[var(--muted-foreground)]">目录名称：</span><span className="font-bold text-[var(--foreground)]">{app.catalogItem?.name || '-'}</span></div>
                      <div><span className="text-[var(--muted-foreground)]">目录分类：</span><span className="font-bold text-[var(--foreground)]">{app.catalogItem?.category || '-'}</span></div>
                    </>)}
                    <div><span className="text-[var(--muted-foreground)]">报价：</span><span className="font-bold text-[var(--foreground)]">{app.quotedPrice ? `¥${Number(app.quotedPrice).toLocaleString('zh-CN')}` : '未报价'}</span></div>
                    <div><span className="text-[var(--muted-foreground)]">区域：</span><span className="font-bold text-[var(--foreground)]">{app.region || '-'}</span></div>
                    <div><span className="text-[var(--muted-foreground)]">交货期：</span><span className="font-bold text-[var(--foreground)]">{app.deliveryPeriod || '-'}</span></div>
                    <div><span className="text-[var(--muted-foreground)]">最小起订：</span><span className="font-bold text-[var(--foreground)]">{app.minOrder || '-'}</span></div>
                    <div><span className="text-[var(--muted-foreground)]">含税/含运费：</span><span className="font-bold text-[var(--foreground)]">{app.taxIncluded ? '含税' : '不含税'} / {app.freightIncluded ? '含运费' : '不含运费'}</span></div>
                    {app.qualificationNote && <div className="md:col-span-2"><span className="text-[var(--muted-foreground)]">资质说明：</span>{app.qualificationNote}</div>}
                    {app.counterPrice && <div className="md:col-span-2"><span className="text-[var(--muted-foreground)]">反报价：</span><span className="font-bold text-[var(--accent-strong)]">¥{Number(app.counterPrice).toLocaleString('zh-CN')}</span>{app.counterNote && <span className="text-[var(--muted-foreground)] ml-2">（{app.counterNote}）</span>}</div>}
                    {app.reviewerNote && <div className="md:col-span-2"><span className="text-[var(--muted-foreground)]">审核备注：</span>{app.reviewerNote}</div>}
                    {app.rejectReason && <div className="md:col-span-2"><span className="text-[var(--muted-foreground)]">{app.status === 'RETURNED' ? '退回原因：' : '拒绝原因：'}</span><span className="text-[var(--danger)]">{app.rejectReason}</span></div>}
                    {app.approvedReferencePrice && <div className="md:col-span-2"><span className="text-[var(--muted-foreground)]">通过参考价：</span><span className="font-bold text-[var(--success)]">¥{Number(app.approvedReferencePrice).toLocaleString('zh-CN')}</span></div>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {review && <ReviewDialog app={review.app} action={review.action} onClose={() => setReview(null)} onDone={() => { setReview(null); load(); }} />}
    </div>
  );
}

/** 富审批弹窗：通过（新品需定参考价/区间/编码/有效期）/ 议价 / 退回 / 拒绝，统一走 reviewCatalogApplication */
function ReviewDialog({ app, action, onClose, onDone }: { app: CatalogApplication; action: ReviewAction; onClose: () => void; onDone: () => void }) {
  const uid = useId();
  const isNewItem = app.type === 'NEW_ITEM';
  const [reason, setReason] = useState('');
  const [counterPrice, setCounterPrice] = useState<number>(app.counterPrice ? Number(app.counterPrice) : (app.quotedPrice ? Number(app.quotedPrice) : 0));
  const [counterNote, setCounterNote] = useState('');
  const [refPrice, setRefPrice] = useState<number>(app.approvedReferencePrice ? Number(app.approvedReferencePrice) : (app.quotedPrice ? Number(app.quotedPrice) : 0));
  const [priceMin, setPriceMin] = useState<number>(0);
  const [priceMax, setPriceMax] = useState<number>(0);
  const [validUntil, setValidUntil] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const TITLES: Record<ReviewAction, string> = { approve: '确认通过申请', counter: '发起议价', return: '退回申请补正', reject: '确认拒绝申请' };
  const CONFIRMS: Record<ReviewAction, string> = { approve: '确认通过', counter: '提交议价', return: '确认退回', reject: '确认拒绝' };
  const TOASTS: Record<ReviewAction, string> = { approve: '已通过', counter: '已发起议价', return: '已退回补正', reject: '已拒绝' };

  const submit = async () => {
    setError('');
    const body: Parameters<typeof reviewCatalogApplication>[1] = { action };
    if (action === 'reject' || action === 'return') {
      if (!reason.trim()) { setError(action === 'reject' ? '请输入拒绝理由' : '请输入退回原因'); return; }
      body.reason = reason;
    }
    if (action === 'counter') {
      if (!counterPrice || counterPrice <= 0) { setError('请输入有效的反报价金额'); return; }
      body.counterPrice = counterPrice;
      if (counterNote.trim()) body.counterNote = counterNote.trim();
    }
    if (action === 'approve' && isNewItem) {
      if (!refPrice || refPrice <= 0) { setError('请填写有效的参考价'); return; }
      body.referencePrice = refPrice; body.priceMin = priceMin; body.priceMax = priceMax;
      if (validUntil) body.validUntil = validUntil;
      if (code.trim()) body.code = code.trim();
    }
    setSubmitting(true);
    try { await reviewCatalogApplication(app.id, body); toast.success(TOASTS[action]); onDone(); }
    catch (e: any) { setError(e.message || '操作失败'); } finally { setSubmitting(false); }
  };

  const numInput = (id: string, label: string, value: number, set: (v: number) => void, required?: boolean) => (
    <div>
      <label htmlFor={`${uid}-${id}`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">{label}{required && <span className="text-[var(--danger)] ml-0.5">*</span>}</label>
      <input id={`${uid}-${id}`} type="number" value={value} onChange={e => set(Number(e.target.value))} className="workbench-input w-full text-sm" />
    </div>
  );

  return (
    <Modal open onClose={onClose} size="md" title={TITLES[action]}
      description={`${APP_TYPE_LABELS[app.type] || app.type} · ${app.supplier?.name || '未知供应商'} · ${isNewItem ? app.proposedName : app.catalogItem?.name || ''}${app.quotedPrice ? ` · 报价 ¥${Number(app.quotedPrice).toLocaleString('zh-CN')}` : ''}`}
      footer={<>
        <button onClick={onClose} className="neu-btn-soft">取消</button>
        <button onClick={submit} disabled={submitting}
          className={`neu-btn-primary ${action === 'reject' ? 'is-danger' : action === 'approve' ? 'is-success' : ''}`}>
          {submitting ? '提交中...' : CONFIRMS[action]}
        </button>
      </>}>
      {action === 'approve' && isNewItem && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {numInput('ref', '参考价（元）', refPrice, setRefPrice, true)}
          {numInput('min', '价格下限（元）', priceMin, setPriceMin)}
          {numInput('max', '价格上限（元）', priceMax, setPriceMax)}
          <div>
            <label htmlFor={`${uid}-code`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">目录编码</label>
            <input id={`${uid}-code`} value={code} onChange={e => setCode(e.target.value)} placeholder="留空则自动生成" className="workbench-input w-full text-sm" />
          </div>
          <div>
            <label htmlFor={`${uid}-valid`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">有效期</label>
            <input id={`${uid}-valid`} type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="workbench-input w-full text-sm" />
          </div>
        </div>
      )}
      {action === 'approve' && !isNewItem && (
        <p className="text-sm text-[var(--muted-foreground)]">确认通过该{APP_TYPE_LABELS[app.type] || ''}申请？通过后将按报价更新目录价格。</p>
      )}
      {(action === 'reject' || action === 'return') && (
        <div>
          <label htmlFor={`${uid}-reason`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">{action === 'reject' ? '拒绝理由' : '退回原因'}<span className="text-[var(--danger)] ml-0.5">*</span></label>
          <textarea id={`${uid}-reason`} value={reason} onChange={e => { setReason(e.target.value); setError(''); }} rows={3}
            placeholder={action === 'reject' ? '如：报价高于市场平均 30%' : '如：请补充规格型号参数'} className="neu-input w-full text-sm resize-y" />
        </div>
      )}
      {action === 'counter' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {numInput('counter', '反报价（元）', counterPrice, setCounterPrice, true)}
          <div>
            <label htmlFor={`${uid}-note`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">议价说明</label>
            <input id={`${uid}-note`} value={counterNote} onChange={e => setCounterNote(e.target.value)} placeholder="如：参考市场价 95 元" className="workbench-input w-full text-sm" />
          </div>
        </div>
      )}
      {error && <p className="text-xs font-medium text-[var(--danger)]" role="alert">{error}</p>}
    </Modal>
  );
}

// ── 价格趋势 Tab ──

function TrendsTab() {
  const { tree, loading: treeLoading } = useCategoryTree();
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [seriesData, setSeriesData] = useState<{ name: string; color: string; data: { date: string; price: number }[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [itemCount, setItemCount] = useState(0);
  const [opportunity, setOpportunity] = useState<string | null>(null);
  const [predictionData, setPredictionData] = useState<{ date: string; price: number }[]>([]);

  // 按需加载：仅在选中品类后拉取该品类的目录项与价格历史，避免挂载即全量 + N+1
  const loadCategory = async (id: number) => {
    setLoading(true);
    setSeriesData([]); setOpportunity(null); setPredictionData([]); setItemCount(0);
    try {
      const items = await listCatalogItems({ categoryId: id });
      setItemCount(items.length);
      const candidates = items.filter(i => i.priceMin !== i.priceMax).slice(0, 5);
      if (candidates.length === 0) return;
      const series = await Promise.all(candidates.map(async (item, i) => {
        try {
          const h = await getPriceHistory(item.id);
          if (!Array.isArray(h) || h.length < 2) return null;
          return { name: item.name, color: PALETTE[i % PALETTE.length], data: h.map(p => ({ date: (p.recordedAt || '').slice(0, 10), price: Number(p.price) || 0 })) };
        } catch { return null; }
      }));
      setSeriesData(series.filter((s): s is NonNullable<typeof s> => s != null));
      // 仅在确有候选时，拉取首项预测作为采购时机提示
      const pred = await getPricePrediction(candidates[0].id);
      if (pred) {
        setOpportunity(pred.opportunity);
        if (pred.predictions?.length) {
          const lastDate = new Date();
          setPredictionData(pred.predictions.map((p, i) => {
            const d = new Date(lastDate); d.setMonth(d.getMonth() + i + 1);
            return { date: d.toISOString().slice(0, 10), price: p.price };
          }));
        }
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const handleCategoryChange = (id: number | null) => {
    setSelectedCategoryId(id);
    if (!id) { setSeriesData([]); setOpportunity(null); setPredictionData([]); setItemCount(0); return; }
    loadCategory(id);
  };

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 'calc(100vh - 340px)' }}>
      <div className="flex items-center gap-3">
        <CategoryTreeSelect value={selectedCategoryId} onChange={handleCategoryChange} placeholder="选择品类查看价格趋势" className="min-w-[220px]" />
        <span className="text-xs text-[var(--muted-foreground)]">
          {treeLoading ? '加载品类中...' : tree.length > 0 ? `${countLeaves(tree)} 个叶子品类` : ''}
          {itemCount > 0 && <span className="ml-2">· {itemCount} 个目录项</span>}
          {seriesData.length > 0 && <span className="text-[var(--accent)] font-semibold ml-2">已加载 {seriesData.length} 条价格曲线</span>}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" /></div>
      ) : selectedCategoryId === null ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-sm text-[var(--muted-foreground)]">
          <TrendingUp size={32} className="opacity-30" />
          <p>选择品类，查看该品类下目录项的价格走势与采购时机预测</p>
        </div>
      ) : (
        <>
          {opportunity && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--success-soft)] text-sm text-[var(--success)]">
              <Zap size={16} />{opportunity}
            </div>
          )}
          {seriesData.length > 0 ? (
            <PriceTrendChart series={seriesData} title="" predictionData={predictionData.length > 0 ? predictionData : undefined} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-sm text-[var(--muted-foreground)]">
              <TrendingUp size={32} className="opacity-30" />
              <p>该品类下暂无足够的价格历史数据</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 价格预警 Tab ──

function AlertsTab({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [subtab, setSubtab] = useState<'rules' | 'alerts'>('rules');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [ruleForm, setRuleForm] = useState<{ name: string; alertType: string; threshold: number; categoryId: number | null } | null>(null);
  const [editingRule, setEditingRule] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const saveRule = async () => {
    if (!ruleForm) return;
    if (!ruleForm.name.trim()) { toast.error('请填写规则名称'); return; }
    setSaving(true);
    try {
      if (editingRule) await updateAlertRule(editingRule, ruleForm);
      else await createAlertRule(ruleForm);
      toast.success(editingRule ? '规则已更新' : '规则已创建');
      setRuleForm(null); setEditingRule(null); loadRules();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const loadRules = async () => { try { setRules(await listAlertRules()); } catch (e: any) { toast.error(e.message); } };
  const loadAlerts = async () => { try { setAlerts(await listAlerts()); } catch (e: any) { toast.error(e.message); } };

  useEffect(() => { setLoading(true); (subtab === 'rules' ? loadRules() : loadAlerts()).finally(() => setLoading(false)); }, [subtab]);

  const unread = alerts.filter(a => !a.isRead).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="neu-tab-bar">
        <button onClick={() => setSubtab('rules')} className={`neu-tab ${subtab === 'rules' ? 'is-active' : ''}`}>预警规则</button>
        <button onClick={() => setSubtab('alerts')} className={`neu-tab ${subtab === 'alerts' ? 'is-active' : ''}`}>
          预警记录{unread > 0 && <span className="neu-tab-count">{unread}</span>}
        </button>
      </div>
      {loading ? <div className="flex justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" aria-label="加载中" /></div>
        : subtab === 'rules' ? (
          <div className="flex flex-col gap-3">
            {canManage && (
              <div className="flex justify-end">
                <button onClick={() => { setRuleForm({ name: '', alertType: 'PRICE_SURGE', threshold: 10, categoryId: null }); setEditingRule(null); }} className="neu-btn-xs is-info"><Plus size={14} /> 新增规则</button>
              </div>
            )}
            {ruleForm && (
              <div className="wb-panel">
                <div className="wb-panel-header"><h4 className="text-sm font-semibold">{editingRule ? '编辑预警规则' : '新增预警规则'}</h4></div>
                <div className="wb-panel-body">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="sm:col-span-2">
                      <label htmlFor="rule-name" className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">规则名称</label>
                      <input id="rule-name" value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="如：钢材涨幅监控" className="workbench-input w-full text-sm" />
                    </div>
                    <div>
                      <label htmlFor="rule-type" className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">预警类型</label>
                      <select id="rule-type" value={ruleForm.alertType} onChange={e => setRuleForm({ ...ruleForm, alertType: e.target.value })} className="workbench-input w-full text-sm">
                        {Object.entries(ALERT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="rule-threshold" className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">阈值{ruleForm.alertType === 'EXPIRING' ? '（天）' : '（%）'}</label>
                      <input id="rule-threshold" type="number" min={0} value={ruleForm.threshold} onChange={e => setRuleForm({ ...ruleForm, threshold: Number(e.target.value) })} className="workbench-input w-full text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">适用品类（留空为全部品类）</span>
                      <CategoryTreeSelect value={ruleForm.categoryId} onChange={id => setRuleForm({ ...ruleForm, categoryId: id })} placeholder="全部品类" />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <button onClick={() => { setRuleForm(null); setEditingRule(null); }} className="neu-btn-soft">取消</button>
                    <button onClick={saveRule} disabled={saving} className="neu-btn-primary is-info">{saving ? '保存中...' : '保存'}</button>
                  </div>
                </div>
              </div>
            )}
            <div className="neu-table-card">
              <table className="neu-table w-full">
                <thead><tr><th>规则名称</th><th className="text-center">类型</th><th className="text-center">阈值</th><th className="text-center">品类</th><th className="text-center">状态</th>{canManage && <th className="text-center">操作</th>}</tr></thead>
                <tbody>
                  {rules.length === 0 ? <tr><td colSpan={canManage ? 6 : 5} className="text-center py-8 text-sm text-[var(--muted-foreground)]">暂无规则{canManage && '，点击「新增规则」创建'}</td></tr>
                    : rules.map(r => (
                      <tr key={r.id}><td className="font-medium">{r.name}</td>
                        <td className="text-center"><span className="text-xs px-2 py-0.5 rounded bg-[var(--accent-tint)] text-[var(--accent)]">{ALERT_TYPE_LABELS[r.alertType] || r.alertType}</span></td>
                        <td className="text-center tabular-nums font-mono text-sm">{r.alertType === 'EXPIRING' ? `${r.threshold}天` : `${r.threshold}%`}</td>
                        <td className="text-center text-xs text-[var(--muted-foreground)]">{r.category?.name || '全部品类'}</td>
                        <td className="text-center">{r.enabled ? <span className="text-[var(--success)] text-xs font-semibold">启用</span> : <span className="text-[var(--muted-foreground)] text-xs">停用</span>}</td>
                        {canManage && (
                          <td className="text-center">
                            <button onClick={async () => { await toggleAlertRule(r.id); loadRules(); }} className="neu-btn-xs">{r.enabled ? '停用' : '启用'}</button>
                            <button onClick={() => { setRuleForm({ name: r.name, alertType: r.alertType, threshold: r.threshold, categoryId: r.category?.id ?? null }); setEditingRule(r.id); }} aria-label={`编辑规则「${r.name}」`} className="neu-btn-xs ml-1"><PenLine size={12} /></button>
                            <button onClick={async () => { if (await confirmDialog({ message: `确认删除预警规则「${r.name}」？`, danger: true, confirmText: '删除' })) { await deleteAlertRule(r.id); loadRules(); } }} aria-label={`删除规则「${r.name}」`} className="neu-btn-xs is-danger ml-1"><X size={12} /></button>
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="neu-table-card">
            <table className="neu-table w-full">
              <thead><tr><th>时间</th><th>目录项</th><th>规则</th><th>消息</th><th className="text-center">触发值</th><th className="text-center">状态</th><th className="text-center">操作</th></tr></thead>
              <tbody>
                {alerts.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-sm text-[var(--muted-foreground)]">暂无记录</td></tr>
                  : alerts.map(a => (
                    <tr key={a.id} className={a.isRead ? '' : 'bg-[var(--accent-tint)]'}>
                      <td className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">{new Date(a.createdAt).toLocaleString('zh-CN')}</td>
                      <td><span className="font-medium">{a.catalogItem?.name}</span><div className="text-[10px] font-mono text-[var(--accent)]">{a.catalogItem?.code}</div></td>
                      <td className="text-xs">{a.rule?.name}</td>
                      <td className="text-sm">{a.message}</td>
                      <td className="text-center tabular-nums font-mono text-sm">{a.triggerValue}</td>
                      <td className="text-center">
                        {a.isResolved ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--success-soft)] text-[var(--success)] font-semibold">已解决</span>
                          : a.isRead ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">已读</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-tint-strong)] text-[var(--accent)] font-semibold">未读</span>}
                      </td>
                      <td className="text-center whitespace-nowrap">
                        {/* 后端解决/已读接口为内部角色闸（@Roles）→ 非内部角色隐藏，避免 403 */}
                        {!a.isResolved && canManage && <button onClick={async () => { try { await markAlertResolved(a.id); toast.success('已标记解决'); loadAlerts(); } catch (e: any) { toast.error(e.message); } }} className="neu-btn-xs is-success">解决</button>}
                        {!a.isRead && canManage && <button onClick={async () => { try { await markAlertRead(a.id); loadAlerts(); } catch (e: any) { toast.error(e.message); } }} className="neu-btn-xs ml-1"><CheckCheck size={12} className="inline mr-0.5" />标已读</button>}
                        {a.catalogItem?.code && <button onClick={() => router.push(`/mall-management/catalog?tab=items&q=${encodeURIComponent(a.catalogItem!.code)}`)} className="neu-btn-xs is-info ml-1"><Eye size={12} className="inline mr-0.5" />查看条目</button>}
                      </td>
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

function VersionsTab({ canManage }: { canManage: boolean }) {
  const [versions, setVersions] = useState<CatalogVersionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', version: '', effectiveAt: '', description: '' });
  const [diffA, setDiffA] = useState<number | null>(null);
  const [diffB, setDiffB] = useState<number | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState<{ target: CatalogVersionData; base: CatalogVersionData; diff: VersionDiff } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = async () => { setLoading(true); try { setVersions(await listVersions()); } catch (e: any) { toast.error(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  /** 生效前：若已有生效版本，先拉取 diff 预览二次确认；否则普通确认 */
  const requestActivate = async (v: CatalogVersionData) => {
    const base = versions.find(x => x.status === 'ACTIVE' && x.id !== v.id);
    if (base) {
      try { setActivating({ target: v, base, diff: await compareVersions(base.id, v.id) }); }
      catch (e: any) { toast.error(e.message); }
      return;
    }
    if (await confirmDialog({ message: `确认生效版本「${v.name}」？` })) {
      try { await changeVersionStatus(v.id, 'ACTIVE'); toast.success('已生效'); load(); }
      catch (e: any) { toast.error(e.message); }
    }
  };
  const confirmActivate = async () => {
    if (!activating) return;
    setConfirming(true);
    try { await changeVersionStatus(activating.target.id, 'ACTIVE'); toast.success('已生效'); setActivating(null); load(); }
    catch (e: any) { toast.error(e.message); } finally { setConfirming(false); }
  };
  const requestArchive = async (v: CatalogVersionData) => {
    if (!await confirmDialog({ message: `确认归档版本「${v.name}」？归档后不再参与生效流转。`, confirmText: '归档' })) return;
    try { await changeVersionStatus(v.id, 'ARCHIVED'); toast.success('已归档'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex items-center justify-between">
          <button onClick={() => setShowCreate(s => !s)} className="neu-btn-primary is-info"><Plus size={16} /> 创建版本</button>
        </div>
      )}
      {showCreate && (
        <div className="wb-panel">
          <div className="wb-panel-header"><h3 className="text-sm font-semibold">创建目录版本快照</h3></div>
          <div className="wb-panel-body">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {[['name', '版本名称', 'text'], ['version', '版本号', 'text'], ['effectiveAt', '生效日期', 'date'], ['description', '备注', 'text']].map(([k, l, t]) => (
                <div key={k}><label htmlFor={`version-${k}`} className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">{l}</label>
                  <input id={`version-${k}`} type={t} value={(form as any)[k]} onChange={e => setForm((p: any) => ({ ...p, [k]: e.target.value }))} className="workbench-input w-full text-sm" /></div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="neu-btn-soft">取消</button>
              <button onClick={async () => { if (!form.name.trim() || !form.version.trim()) { toast.error('请填写版本名称和版本号'); return; } setSaving(true); try { await createVersion(form); toast.success('已创建'); setShowCreate(false); setForm({ name: '', version: '', effectiveAt: '', description: '' }); load(); } catch (e: any) { toast.error(e.message); } finally { setSaving(false); } }} disabled={saving} className="neu-btn-primary is-info">{saving ? '创建中...' : '创建快照'}</button>
            </div>
          </div>
        </div>
      )}
      {loading ? <div className="flex justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" aria-label="加载中" /></div>
        : versions.length === 0 ? <p className="text-center py-16 text-sm text-[var(--muted-foreground)]">暂无版本</p>
        : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {versions.map(v => (
            <div key={v.id} className="neu-card-static rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between"><span className="text-sm font-bold">{v.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded ${v.status === 'ACTIVE' ? 'bg-[var(--success-soft)] text-[var(--success)]' : v.status === 'ARCHIVED' ? 'bg-[var(--muted)] text-[var(--muted-foreground)]' : 'bg-[var(--accent-tint)] text-[var(--accent)]'}`}>{v.status === 'ACTIVE' ? '生效' : v.status === 'ARCHIVED' ? '归档' : '草稿'}</span></div>
              <code className="text-xs font-mono text-[var(--accent)]">{v.version}</code>
              <div className="text-xs text-[var(--muted-foreground)]">{v.effectiveAt?.slice(0, 10)} · {v.user?.displayName}</div>
              <div className="flex gap-1 mt-auto pt-2">
                <button onClick={() => setDiffA(diffA === v.id ? null : v.id)} aria-label="设为对比基准 A" className={`neu-btn-xs ${diffA === v.id ? 'is-info' : ''}`}>A</button>
                <button onClick={() => setDiffB(diffB === v.id ? null : v.id)} aria-label="设为对比基准 B" className={`neu-btn-xs ${diffB === v.id ? 'is-info' : ''}`}>B</button>
                {canManage && v.status !== 'ACTIVE' && v.status !== 'ARCHIVED' && <button onClick={() => requestActivate(v)} className="neu-btn-xs is-success ml-auto">生效</button>}
                {canManage && v.status !== 'ARCHIVED' && <button onClick={() => requestArchive(v)} className="neu-btn-xs ml-auto">归档</button>}
              </div>
            </div>
          ))}
        </div>}
      {(diffA && diffB) && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={diffA === diffB} onClick={async () => { try { setDiff(await compareVersions(diffA, diffB)); } catch (e: any) { toast.error(e.message); } }} className="neu-btn-soft">对比 A vs B</button>
          {diffA === diffB && <span className="text-xs text-[var(--muted-foreground)]">A/B 选择了同一版本，请选择两个不同版本再对比</span>}
        </div>
      )}
      {diff && (
        <div className="wb-panel">
          <div className="wb-panel-header"><h3 className="text-sm font-bold">{diff.versionA} → {diff.versionB}</h3>
            <button onClick={() => setDiff(null)} aria-label="关闭对比" className="neu-btn-xs"><X size={14} /></button></div>
          <div className="wb-panel-body">
            <VersionDiffBlocks diff={diff} />
          </div>
        </div>
      )}
      {activating && (
        <Modal open onClose={() => setActivating(null)} size="md"
          title={`生效前预览：${activating.base.version} → ${activating.target.version}`}
          description={`将用「${activating.target.name}」替换当前生效版本「${activating.base.name}」，请确认以下变更`}
          footer={<>
            <button onClick={() => setActivating(null)} className="neu-btn-soft">取消</button>
            <button onClick={confirmActivate} disabled={confirming} className="neu-btn-primary is-success">{confirming ? '生效中...' : '确认生效'}</button>
          </>}>
          <VersionDiffBlocks diff={activating.diff} />
        </Modal>
      )}
    </div>
  );
}

function VersionDiffBlocks({ diff }: { diff: VersionDiff }) {
  const preview = (list: any[], cls: string, empty: string) => (
    <div className={`p-3 rounded-xl ${cls}`}>
      {list.length === 0 ? <span className="text-xs opacity-70">{empty}</span>
        : <ul className="flex flex-col gap-1">{list.slice(0, 6).map((x: any, i: number) => (
          <li key={i} className="text-xs truncate">
            {x.name || x.code || JSON.stringify(x)}
            {x.oldPrice != null && x.newPrice != null && <span className="tabular-nums ml-1">¥{Number(x.oldPrice).toLocaleString()} → ¥{Number(x.newPrice).toLocaleString()}</span>}
          </li>))}
          {list.length > 6 && <li className="text-[10px] opacity-70">… 还有 {list.length - 6} 项</li>}
        </ul>}
    </div>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
      <div>
        <span className="font-semibold text-[var(--success)] text-xs">新增 {diff.added.length} 项</span>
        <div className="mt-1.5">{preview(diff.added, 'bg-[var(--success-soft)] text-[var(--success)]', '无新增')}</div>
      </div>
      <div>
        <span className="font-semibold text-[var(--danger)] text-xs">下架 {diff.removed.length} 项</span>
        <div className="mt-1.5">{preview(diff.removed, 'bg-[var(--danger-soft)] text-[var(--danger)]', '无下架')}</div>
      </div>
      <div>
        <span className="font-semibold text-[var(--warning)] text-xs">价格变化 {diff.priceChanges.length} 项</span>
        <div className="mt-1.5">{preview(diff.priceChanges, 'bg-[var(--warning-soft)] text-[var(--warning)]', '无变化')}</div>
      </div>
    </div>
  );
}

// ── 供应商维度 Tab ──

function SuppliersTab() {
  const [tab, setTab] = useState<'coverage' | 'price' | 'radar' | 'insights'>('coverage');
  const [coverage, setCoverage] = useState<SupplierCoverage[]>([]);
  const [priceData, setPriceData] = useState<SupplierPriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [radarData, setRadarData] = useState<PriceRadarData>({ minPrice: null, avgPrice: null, stdDeviation: null, outliers: [], items: [] });
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarPage, setRadarPage] = useState(1);
  const RADAR_PAGE_SIZE = 20;
  const radarPages = Math.max(1, Math.ceil(radarData.items.length / RADAR_PAGE_SIZE));
  const pagedRadarItems = useMemo(
    () => radarData.items.slice((radarPage - 1) * RADAR_PAGE_SIZE, radarPage * RADAR_PAGE_SIZE),
    [radarData.items, radarPage],
  );
  const [insights, setInsights] = useState<SearchInsights>({ gapKeywords: [], topSearches: [] });
  const [insightsLoading, setInsightsLoading] = useState(false);

  const loadRadar = async () => {
    setRadarLoading(true);
    try { setRadarData(await getPriceRadar()); } catch (e: any) { toast.error(e.message); }
    finally { setRadarLoading(false); }
  };
  const loadInsights = async () => {
    setInsightsLoading(true);
    try { setInsights(await getSearchInsights()); } catch (e: any) { toast.error(e.message); }
    finally { setInsightsLoading(false); }
  };

  useEffect(() => {
    if (tab === 'radar') { loadRadar(); return; }
    if (tab === 'insights') { loadInsights(); return; }
    setLoading(true);
    (tab === 'coverage' ? getSupplierCoverage() : getSupplierPriceComparison())
      .then(d => { if (tab === 'coverage') setCoverage(d as unknown as SupplierCoverage[]); else setPriceData(d as unknown as SupplierPriceItem[]); })
      .catch(e => toast.error(e.message)).finally(() => setLoading(false));
  }, [tab]);

  const subTabs = [
    { key: 'coverage', label: '品类覆盖' },
    { key: 'price', label: '价格对比' },
    { key: 'radar', label: '比价雷达' },
    { key: 'insights', label: '搜索洞察' },
  ] as const;

  const maxSearch = Math.max(1, ...insights.topSearches.map(s => s.count), ...insights.gapKeywords.map(s => s.count));

  return (
    <div className="flex flex-col gap-4">
      <div className="neu-tab-bar flex-wrap">
        {subTabs.map(s => (
          <button key={s.key} onClick={() => setTab(s.key)} className={`neu-tab ${tab === s.key ? 'is-active' : ''}`}>{s.label}</button>
        ))}
      </div>

      {(tab === 'coverage' || tab === 'price') && (loading ? <div className="flex justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" aria-label="加载中" /></div>
        : tab === 'coverage' ? (
          coverage.length === 0 ? <EmptyHint icon={Building2} text="暂无供应商覆盖数据" />
            : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {coverage.map(s => (
                <button key={s.supplier} type="button" onClick={() => setSelectedSupplier(selectedSupplier === s.supplier ? null : s.supplier)}
                  aria-expanded={selectedSupplier === s.supplier}
                  className="neu-card rounded-2xl p-4 text-left cursor-pointer transition-colors hover:bg-[var(--accent-tint)]">
                  <div className="flex items-center justify-between"><span className="text-sm font-bold">{s.supplier}</span><span className="text-xs font-mono text-[var(--accent)]">{s.categoryCount} 类</span></div>
                  {selectedSupplier === s.supplier && <p className="text-xs text-[var(--muted-foreground)] mt-2">{s.categories.join('、')}</p>}
                </button>
              ))}
            </div>
        ) : (
          priceData.length === 0 ? <EmptyHint icon={Building2} text="暂无价格对比数据" />
            : <div className="flex flex-col gap-4">
              {priceData.map(s => (
                <div key={s.supplier} className="neu-table-card">
                  <div className="neu-table-card-header flex items-center justify-between"><span className="text-sm font-bold">{s.supplier}</span><span className="text-xs text-[var(--muted-foreground)]">均价 <strong className="tabular-nums text-[var(--foreground)]">¥{(s.avgPrice ?? 0).toLocaleString()}</strong> · {s.items.length} 项</span></div>
                  <table className="neu-table w-full text-xs"><thead><tr><th>编码</th><th>名称</th><th className="text-right">参考价</th></tr></thead><tbody>{s.items.map(i => <tr key={i.code}><td className="font-mono text-[var(--accent)]">{i.code}</td><td>{i.name}</td><td className="text-right tabular-nums font-medium">¥{(i.price ?? 0).toLocaleString()}</td></tr>)}</tbody></table>
                </div>
              ))}
            </div>
        ))}

      {tab === 'radar' && (radarLoading ? <div className="flex justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" aria-label="加载中" /></div>
        : radarData.items.length === 0 ? <EmptyHint icon={Radar} text="暂无有效供货价格，无法生成比价雷达" />
        : <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ['样本量', `${radarData.items.length} 项`],
              ['最低价', radarData.minPrice != null ? `¥${radarData.minPrice.toLocaleString()}` : '—'],
              ['均价', radarData.avgPrice != null ? `¥${radarData.avgPrice.toLocaleString()}` : '—'],
              ['标准差', radarData.stdDeviation != null ? `¥${radarData.stdDeviation.toLocaleString()}` : '—'],
            ].map(([label, value]) => (
              <div key={label} className="kpi-card p-3 rounded-xl flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</span>
                <span className="text-[1.15rem] font-black tabular-nums text-[var(--foreground)]">{value}</span>
              </div>
            ))}
          </div>
          {radarData.outliers.length > 0 && (
            <div className="wb-panel">
              <div className="wb-panel-header"><h4 className="text-sm font-bold flex items-center gap-2"><AlertTriangle size={15} className="text-[var(--warning)]" /> 价格异常偏高（超均值 +2σ）· {radarData.outliers.length} 项</h4></div>
              <div className="wb-panel-body">
                <div className="flex flex-col gap-1.5">
                  {radarData.outliers.map(o => (
                    <div key={o.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--warning-soft)] text-sm">
                      <span><strong>{o.name}</strong> <span className="text-xs text-[var(--muted-foreground)]">{o.supplier}</span></span>
                      <span className="tabular-nums font-semibold text-[var(--warning)]">¥{(o.referencePrice ?? 0).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="neu-table-card">
            <table className="neu-table w-full text-xs">
              <thead><tr><th>编码</th><th>名称</th><th>供应商</th><th className="text-right">参考价</th><th className="text-center">标记</th></tr></thead>
              <tbody>
                {pagedRadarItems.map(it => (
                  <tr key={it.id} className={it.isOutlier ? 'bg-[var(--warning-soft)]' : ''}>
                    <td className="font-mono text-[var(--accent)]">{it.code}</td>
                    <td>{it.name}</td>
                    <td className="text-[var(--muted-foreground)]">{it.supplier || '—'}</td>
                    <td className="text-right tabular-nums font-medium">¥{(it.referencePrice ?? 0).toLocaleString()}</td>
                    <td className="text-center">
                      {it.isLowest ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--success-soft)] text-[var(--success)] font-semibold">最低价</span>
                        : it.isOutlier ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--warning-soft)] text-[var(--warning)] font-semibold">偏高</span>
                        : <span className="text-[10px] text-[var(--muted-foreground)]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {radarData.items.length > RADAR_PAGE_SIZE && (
              <div className="neu-table-card-footer flex justify-between items-center px-4 py-2 text-xs text-[var(--muted-foreground)]">
                <span>共 <strong className="tabular-nums text-[var(--foreground)]">{radarData.items.length}</strong> 条 · 第 {radarPage}/{radarPages} 页</span>
                <div className="flex gap-1">
                  <button disabled={radarPage <= 1} onClick={() => setRadarPage(p => p - 1)} aria-label="上一页" className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-[-90deg]" /></button>
                  <button disabled={radarPage >= radarPages} onClick={() => setRadarPage(p => p + 1)} aria-label="下一页" className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-90" /></button>
                </div>
              </div>
            )}
          </div>
        </div>)}

      {tab === 'insights' && (insightsLoading ? <div className="flex justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" aria-label="加载中" /></div>
        : (insights.topSearches.length === 0 && insights.gapKeywords.length === 0) ? <EmptyHint icon={Sparkles} text="近 30 天暂无搜索记录" />
        : <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="wb-panel">
            <div className="wb-panel-header"><h4 className="text-sm font-bold flex items-center gap-2"><TrendingUp size={15} className="text-[var(--accent)]" /> 热门搜索（近 30 天）</h4></div>
            <div className="wb-panel-body">
              {insights.topSearches.length === 0 ? <p className="text-xs text-[var(--muted-foreground)]">暂无记录</p>
                : <div className="flex flex-col gap-2">{insights.topSearches.map(s => (
                  <div key={s.keyword} className="flex items-center gap-3 text-xs">
                    <span className="w-28 truncate text-[var(--foreground)] font-medium">{s.keyword}</span>
                    <div className="flex-1 h-2 rounded bg-[var(--accent-tint)] overflow-hidden"><div className="h-full rounded bg-[var(--accent)]" style={{ width: `${Math.max(6, Math.round((s.count / maxSearch) * 100))}%` }} /></div>
                    <span className="tabular-nums text-[var(--muted-foreground)] w-8 text-right">{s.count}</span>
                  </div>
                ))}</div>}
            </div>
          </div>
          <div className="wb-panel">
            <div className="wb-panel-header"><h4 className="text-sm font-bold flex items-center gap-2"><TrendingDown size={15} className="text-[var(--warning)]" /> 目录缺口（搜索无结果）</h4></div>
            <div className="wb-panel-body">
              <p className="text-[11px] text-[var(--muted-foreground)] mb-3">这些关键词被反复搜索但目录中无匹配项，提示潜在采购空白</p>
              {insights.gapKeywords.length === 0 ? <p className="text-xs text-[var(--muted-foreground)]">暂无缺口，目录覆盖良好</p>
                : <div className="flex flex-wrap gap-1.5">{insights.gapKeywords.map(s => (
                  <span key={s.keyword} className="text-xs px-2 py-1 rounded-lg bg-[var(--warning-soft)] text-[var(--warning)] font-medium">{s.keyword} <span className="tabular-nums opacity-70">×{s.count}</span></span>
                ))}</div>}
            </div>
          </div>
        </div>)}
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
      <div className="wb-toolbar flex-wrap">
        <div className="neu-tab-bar">{actions.map(a => <button key={a} onClick={() => setAction(a)} className={`neu-tab ${action === a ? 'is-active' : ''}`}>{a === '全部' ? '全部' : LOG_LABELS[a] || a}</button>)}</div>
        <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" /><input value={search} onChange={e => setSearch(e.target.value)} aria-label="搜索操作日志" placeholder="搜索..." className="neu-input !pl-9 w-full text-sm" />{search && <button onClick={() => setSearch('')} aria-label="清除搜索" className="absolute right-2 top-1/2 -translate-y-1/2"><X size={14} /></button>}</div>
        <button onClick={() => { listCatalogAuditLogs().then(setLogs); }} disabled={loading} aria-label="刷新操作日志" className="neu-btn-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
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
                  <td><span className="text-xs px-1.5 py-0.5 rounded bg-[var(--accent-tint-strong)]">{LOG_LABELS[l.action] || l.action}</span></td>
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

function CatalogManagementPageInner() {
  const searchParams = useSearchParams();
  const validKeys = TABS.map(t => t.key);
  const queryTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<string>(queryTab && (validKeys as string[]).includes(queryTab) ? queryTab : 'items');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 统一走全站 fetchCurrentUser；role 未到达前按只读渲染（写按钮隐藏），不阻塞内容
  useEffect(() => {
    fetchCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setRoleReady(true));
  }, []);

  // 深链 ?tab= 变化时同步页签（预警「查看条目」等场景）
  useEffect(() => {
    if (queryTab && (validKeys as string[]).includes(queryTab)) setActiveTab(queryTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryTab]);

  const canManage = !!user && (INTERNAL_ROLES as readonly string[]).includes(user.role);
  const visibleTabs = TABS.filter(t => !t.roles || (user && t.roles.includes(user.role)));

  const doExport = async () => {
    setExporting(true);
    try {
      const blob = await exportCatalog();
      triggerBlobDownload(blob, `采购目录-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('目录已导出');
    } catch (e: any) { toast.error(e.message); }
    finally { setExporting(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <ConfirmHost />
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ShoppingCart size={17} /></div>
            <div>
              <div className="page-hero__title">目录管理</div>
              <div className="page-hero__sub">集中管理采购目录的品类树、目录项、价格审批、趋势分析、预警、版本、供应商维度及操作日志</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={doExport} disabled={exporting} className="neu-btn-soft">
              <Download size={14} /> {exporting ? '导出中...' : '导出目录'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ ...HAIRLINE, paddingTop: '1rem' }} className="flex flex-col gap-5">
        <div className="neu-tab-bar flex-wrap">
          {visibleTabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)} aria-current={activeTab === t.key ? 'page' : undefined} className={`neu-tab flex items-center gap-1.5 ${activeTab === t.key ? 'is-active' : ''}`}>
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>

        <div key={activeTab}>
          {activeTab === 'items' && <ItemsTab canManage={canManage} />}
          {activeTab === 'tree' && <CategoryTreeTab canManage={canManage} />}
          {activeTab === 'entry' && <EntryTab canManage={canManage} roleReady={roleReady} />}
          {activeTab === 'approval' && <ApprovalTab canManage={canManage} />}
          {activeTab === 'trends' && <TrendsTab />}
          {activeTab === 'alerts' && <AlertsTab canManage={canManage} />}
          {activeTab === 'versions' && <VersionsTab canManage={canManage} />}
          {activeTab === 'suppliers' && <SuppliersTab />}
          {activeTab === 'logs' && <LogsTab />}
        </div>
      </div>
    </div>
  );
}

export default function CatalogManagementPage() {
  // useSearchParams 须在 Suspense 边界内（Next.js App Router 构建要求）
  return (
    <Suspense fallback={<CatalogPageSkeleton />}>
      <CatalogManagementPageInner />
    </Suspense>
  );
}

function CatalogPageSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--muted)] animate-pulse" />
            <div className="flex flex-col gap-1.5">
              <div className="h-5 w-20 rounded bg-[var(--muted)] animate-pulse" />
              <div className="h-3 w-64 rounded bg-[var(--muted)] animate-pulse" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-8 w-20 rounded-lg bg-[var(--muted)] animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="kpi-card p-3 rounded-xl h-14 animate-pulse" />
        ))}
      </div>
      <div className="neu-table-card h-80 animate-pulse" />
    </div>
  );
}
