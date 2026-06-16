'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { portalURL } from '@water-erp/config';
import PriceChart from './price-chart';
import { MallAssistantEntry } from './assistant/mall-assistant-entry';
import type { MallAssistantContext } from './assistant/types';
import { useCountUp, useDataChanged, useScrollAwareHeader, useAsyncState, StateBoundary, InlineError, TableSkeleton, StatCardSkeleton, CardGridSkeleton, EmptyState, LiveRegion, AnimatedBadge, StaggerContainer, StaggerItem, useAutoSave, useGlobalHotkey, useUndoableAction } from './interactions';

type PriceStatus = '有效' | '价格波动' | '即将过期' | '待复核';
type PriceSource = '框架协议价' | '历史成交价' | '市场询价' | '人工维护';
type SupplierType = '协议供应商' | '入库供应商' | '市场询价';

interface CatalogItem {
  id: string;
  code: string;
  name: string;
  specification: string;
  category: string;
  group: string;
  unit: string;
  referencePrice: number;
  priceMin: number;
  priceMax: number;
  lastDealPrice: number;
  averagePrice: number;
  supplier: string;
  supplierType: SupplierType;
  priceSource: PriceSource;
  region: string;
  taxIncluded: boolean;
  freightIncluded: boolean;
  updatedAt: string;
  validUntil: string | null;
  status: PriceStatus;
  changeRate: number;
  minOrder: string;
  remark: string | null;
}

interface BudgetLine {
  id: string;
  catalogItemId: string | null;
  code: string;
  name: string;
  specification: string;
  unit: string;
  referencePrice: number;
  qty: number;
}

interface BudgetListSummary {
  id: string;
  name: string;
  status: string;
  itemCount: number;
  totalAmount: number | null;
  procurementProjectId: string | null;
  remark: string | null;
  updatedAt: string;
}

interface BudgetListDetail extends BudgetListSummary {
  items: BudgetLine[];
}

interface SupplierAgg {
  supplier: string;
  supplierType: string;
  regions: string[];
  categories: string[];
  itemCount: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
}



const DIRECTORY = [
  { group: '全部目录', children: ['全部'] },
  { group: '工程材料', children: ['钢材', '钢筋', '水泥', '混凝土', '砂石骨料', '外加剂', '灌浆材料', '管材', '给排水管材', '管件', '防水材料', '土工材料', '模板脚手架'] },
  { group: '机电设备', children: ['水泵', '泵站设备', '阀门', '水处理设备', '加药消毒设备', '电气设备', '发电机组'] },
  { group: '信息化设备', children: ['仪器仪表', '传感器', '自动化设备', '安防监控', '网络通信', '软件系统'] },
  { group: '劳保及通用物资', children: ['劳保用品'] },
  { group: '办公后勤', children: ['办公设备', '办公家具', '油料能源'] },
  { group: '服务采购', children: ['专业服务', '检测监测服务', '运维服务', '物流运输服务'] },
];

const REGIONS = ['全部', '全省', '成都', '德阳', '绵阳', '乐山', '泸州', '宜宾', '眉山', '达州'];
const STATUSES: Array<'全部' | PriceStatus> = ['全部', '有效', '价格波动', '即将过期', '待复核'];
const SOURCES: Array<'全部' | PriceSource> = ['全部', '框架协议价', '历史成交价', '市场询价', '人工维护'];

const statusStyles: Record<PriceStatus, string> = {
  有效: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  价格波动: 'bg-orange-50 text-orange-700 border-orange-200',
  即将过期: 'bg-amber-50 text-amber-700 border-amber-200',
  待复核: 'bg-slate-100 text-slate-600 border-slate-200',
};

const sourceStyles: Record<PriceSource, string> = {
  框架协议价: 'bg-blue-50 text-blue-700',
  历史成交价: 'bg-cyan-50 text-cyan-700',
  市场询价: 'bg-purple-50 text-purple-700',
  人工维护: 'bg-slate-100 text-slate-600',
};

// 表格/卡片短标签（≤限定字数），完整值通过 title 悬停或详情抽屉查看
const STATUS_SHORT: Record<PriceStatus, string> = { 有效: '有效', 价格波动: '波动', 即将过期: '临期', 待复核: '待复核' };
const SOURCE_SHORT: Record<PriceSource, string> = { 框架协议价: '协议价', 历史成交价: '成交价', 市场询价: '市场询价', 人工维护: '人工维护' };
const CATEGORY_SHORT: Record<string, string> = { 加药消毒设备: '加药消毒', 检测监测服务: '检测监测', 物流运输服务: '物流运输' };
const shortCategory = (c: string) => CATEGORY_SHORT[c] || c;

const formatDate = (d: string | null) => (d ? d.slice(0, 10) : '长期');
const formatPrice = (price: number) => `¥${price.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

const AUDIT_LABELS: Record<string, string> = {
  BUDGET_CONVERTED: '生成询价单',
  BUDGET_EXPORTED: '导出预算清单',
  CATALOG_EXPORTED: '导出价格清单',
};

export default function MallPage() {
  const router = useRouter();
  const headerVisible = useScrollAwareHeader({ threshold: 80 });
  const searchInputRef = useRef<HTMLInputElement>(null);
  useGlobalHotkey('/', () => { searchInputRef.current?.focus(); searchInputRef.current?.select(); });
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [region, setRegion] = useState('全部');
  const [status, setStatus] = useState<'全部' | PriceStatus>('全部');
  const [source, setSource] = useState<'全部' | PriceSource>('全部');
  const [lists, setLists] = useState<BudgetListSummary[]>([]);
  const [currentList, setCurrentList] = useState<BudgetListDetail | null>(null);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const saveSkipRef = useRef(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const saveEnabled = !!currentList && currentList.status !== 'CONVERTED';
  const { status: saveStatus } = useAutoSave({
    data: lines,
    onSave: async (payload) => {
      const items = payload.map(row => ({ catalogItemId: row.catalogItemId, code: row.code, name: row.name, specification: row.specification, unit: row.unit, referencePrice: row.referencePrice, qty: row.qty }));
      const res = await api(`/api/budget/lists/${currentList!.id}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      if (!res.ok) throw new Error('保存失败');
      refreshLists();
    },
    debounceMs: 700,
    skipRef: saveSkipRef,
    enabled: saveEnabled,
  });
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; action: string; target: string; detail: any; createdAt: string }>>([]);
  const [detail, setDetail] = useState<CatalogItem | null>(null);
  const [detailHistory, setDetailHistory] = useState<{ recordedAt: string; price: number }[]>([]);
  const [detailHistoryLoading, setDetailHistoryLoading] = useState(false);
  const [assistantInitialQuestion, setAssistantInitialQuestion] = useState('');
  const [currentUser, setCurrentUser] = useState<{ username?: string; displayName?: string; role?: string } | null>(null);
  const [view, setView] = useState<'catalog' | 'supplier'>('catalog');
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [density, setDensity] = useState<'compact' | 'comfortable'>(() => {
    try { return (localStorage.getItem('mall-density') as 'compact' | 'comfortable') || 'comfortable'; } catch { return 'comfortable'; }
  });
  useEffect(() => { try { localStorage.setItem('mall-density', density); } catch {} }, [density]);
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSort = (col: string) => {
    setSort(prev => prev?.col === col ? (prev.dir === 'desc' ? { col, dir: 'asc' as const } : null) : { col, dir: 'desc' as const });
  };
  const [priceOpen, setPriceOpen] = useState(true);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [basisOpen, setBasisOpen] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    fetch('/api/auth/me', { headers: { 'X-Portal': 'mall' }, credentials: 'include' })
      .then(async r => {
        if (!r.ok) {
          router.push('/login');
          return;
        }
        const data = await r.json().catch(() => null);
        setCurrentUser(data?.user || data || null);
      })
      .catch(() => router.push('/login'));
  }, [router]);

  // ===== 数据获取：useAsyncState（消灭静默吞错） =====
  const catalogAsync = useAsyncState(async () => {
    const r = await fetch('/api/catalog', { headers: { 'X-Portal': 'mall' }, credentials: 'include' });
    if (!r.ok) throw new Error(`目录加载失败（${r.status}）`);
    const data = await r.json();
    return (Array.isArray(data) ? (data as CatalogItem[]) : []).filter(item => item.status === '有效');
  }, { deps: [] });

  const items = catalogAsync.data ?? [];
  const catalogLoading = catalogAsync.status === 'loading' || catalogAsync.status === 'idle';

  const suppliersAsync = useAsyncState(async () => {
    const r = await fetch('/api/catalog/suppliers', { headers: { 'X-Portal': 'mall' }, credentials: 'include' });
    if (!r.ok) throw new Error('供应商加载失败');
    return (await r.json()) as SupplierAgg[];
  }, { deps: [] });
  const suppliers = suppliersAsync.data ?? [];

  const favoritesAsync = useAsyncState(async () => {
    const r = await fetch('/api/catalog/favorites', { headers: { 'X-Portal': 'mall' }, credentials: 'include' });
    if (!r.ok) throw new Error('收藏加载失败');
    const data = await r.json();
    return (Array.isArray(data) ? data : []).map((i: any) => i.id as string);
  }, { deps: [] });
  useEffect(() => { if (favoritesAsync.data) setFavoriteIds(favoritesAsync.data); }, [favoritesAsync.data]);

  useEffect(() => {
    if (!detail) { setDetailHistory([]); setDetailHistoryLoading(false); return; }
    setDetailHistoryLoading(true);
    fetch(`/api/catalog/${detail.id}/history`, { headers: { 'X-Portal': 'mall' }, credentials: 'include' })
      .then(async r => (r.ok ? await r.json() : []))
      .then(d => setDetailHistory(Array.isArray(d) ? d : []))
      .catch(() => setDetailHistory([]))
      .finally(() => setDetailHistoryLoading(false));
  }, [detail]);

  const daysLeft = detail?.validUntil ? Math.max(0, Math.ceil((new Date(detail.validUntil).getTime() - Date.now()) / 86400000)) : null;

  const browseSupplier = (name: string) => { setSearch(name); setCategory('全部'); setView('catalog'); };

  const toggleFavorite = async (item: CatalogItem) => {
    const res = await api(`/api/catalog/${item.id}/favorite`, { method: 'POST' });
    if (!res.ok) return;
    const { favorited } = await res.json();
    setFavoriteIds(prev => (favorited ? [...prev, item.id] : prev.filter(id => id !== item.id)));
    toast.success(favorited ? `已收藏：${item.name}` : '已取消收藏');
  };

  const toggleSelectOne = (id: string) => setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleSelectAll = () => setSelectedIds(prev => prev.size === sorted.length ? new Set() : new Set(sorted.map(i => i.id)));
  const clearSelection = () => setSelectedIds(new Set());
  const batchAddToBudget = () => { sorted.filter(i => selectedIds.has(i.id)).forEach(i => addToBudget(i, 1, true)); toast.success(`已加入 ${selectedIds.size} 项`); clearSelection(); };

  const resetFilters = () => { setSearch(''); setCategory('全部'); setRegion('全部'); setStatus('全部'); setSource('全部'); setShowFavoritesOnly(false); };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const [exporting, setExporting] = useState<null | 'catalog' | 'budget'>(null);

  const exportCatalog = async () => {
    if (exporting) return;
    setExporting('catalog');
    try {
      const params = new URLSearchParams();
      if (category !== '全部') params.set('category', category);
      if (region !== '全部') params.set('region', region);
      if (status !== '全部') params.set('status', status);
      if (source !== '全部') params.set('source', source);
      if (search.trim()) params.set('search', search.trim());
      const res = await api(`/api/catalog/export${params.toString() ? '?' + params : ''}`);
      if (!res.ok) { toast.error('导出失败'); return; }
      triggerDownload(await res.blob(), `采购目录-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('价格清单已导出为 Excel');
    } finally { setExporting(null); }
  };

  const exportBudget = async () => {
    if (exporting) return;
    if (!currentList) { toast.error('请先选择预算清单'); return; }
    setExporting('budget');
    try {
      const res = await api(`/api/budget/lists/${currentList.id}/export`);
      if (!res.ok) { toast.error('导出失败'); return; }
      triggerDownload(await res.blob(), `预算清单-${currentList.name}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('预算清单已导出为 Excel');
    } finally { setExporting(null); }
  };

  const openAudit = async () => {
    setAuditOpen(true);
    const res = await api('/api/audit');
    if (res.ok) setAuditLogs(await res.json());
  };


  const filtered = useMemo(() => items.filter(item => {
    const keyword = search.trim();
    const matchSearch = !keyword || [item.code, item.name, item.specification, item.category, item.supplier].some(v => v.includes(keyword));
    const matchCategory = category === '全部' || item.category === category || item.group === category;
    const matchRegion = region === '全部' || item.region === region || item.region === '全省';
    const matchStatus = status === '全部' || item.status === status;
    const matchSource = source === '全部' || item.priceSource === source;
    const matchFav = !showFavoritesOnly || favoriteIds.includes(item.id);
    return matchSearch && matchCategory && matchRegion && matchStatus && matchSource && matchFav;
  }), [items, category, region, search, source, status, showFavoritesOnly, favoriteIds]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    return [...filtered].sort((a, b) => {
      const getVal = (item: CatalogItem) => {
        switch (sort.col) {
          case 'referencePrice': return item.referencePrice;
          case 'changeRate': return item.changeRate;
          case 'updatedAt': return new Date(item.updatedAt).getTime();
          case 'validUntil': return item.validUntil ? new Date(item.validUntil).getTime() : 0;
          default: return 0;
        }
      };
      const va = getVal(a), vb = getVal(b);
      return sort.dir === 'desc' ? vb - va : va - vb;
    });
  }, [filtered, sort]);

  const stats = useMemo(() => ({
    total: items.length,
    suppliers: new Set(items.map(item => item.supplier)).size,
    updated: items.filter(item => new Date(item.updatedAt) >= new Date(Date.now() - 30 * 86400000)).length,
    alerts: items.filter(item => item.status !== '有效').length,
  }), [items]);

  const focusItems = useMemo(() => items.filter(item => item.status !== '有效' || Math.abs(item.changeRate) >= 6).slice(0, 4), [items]);

  const aiRiskSummary = useMemo(() => ({
    safe: items.filter(item => item.status === '有效' && Math.abs(item.changeRate) < 6).length,
    inquiry: items.filter(item => item.status === '价格波动' || Math.abs(item.changeRate) >= 6).length,
    expiring: items.filter(item => item.status === '即将过期').length,
    review: items.filter(item => item.status === '待复核').length,
  }), [items]);

  const aiContextItems = useMemo(() => filtered.slice(0, 12).map(item => ({
    code: item.code,
    name: item.name,
    specification: item.specification,
    category: item.category,
    referencePrice: item.referencePrice,
    unit: item.unit,
    priceRange: `${item.priceMin}-${item.priceMax}`,
    averagePrice: item.averagePrice,
    supplier: item.supplier,
    priceSource: item.priceSource,
    region: item.region,
    validUntil: item.validUntil,
    status: item.status,
    changeRate: item.changeRate,
  })), [filtered]);

  const assistantContext: MallAssistantContext = useMemo(() => ({
    totalItems: items.length,
    currentFilters: { category, region, status, source, search },
    riskSummary: aiRiskSummary,
    visibleItems: aiContextItems,
    budget: lines.map(row => ({ code: row.code, name: row.name, qty: row.qty, unit: row.unit, referencePrice: row.referencePrice })),
    selectedItem: detail ? {
      id: detail.id,
      code: detail.code,
      name: detail.name,
      specification: detail.specification,
      category: detail.category,
      referencePrice: detail.referencePrice,
      unit: detail.unit,
      priceRange: `${detail.priceMin}-${detail.priceMax}`,
      averagePrice: detail.averagePrice,
      supplier: detail.supplier,
      supplierType: detail.supplierType,
      priceSource: detail.priceSource,
      region: detail.region,
      validUntil: detail.validUntil,
      status: detail.status,
      changeRate: detail.changeRate,
      minOrder: detail.minOrder,
      remark: detail.remark,
    } : null,
  }), [aiContextItems, aiRiskSummary, category, detail, items.length, lines, region, search, source, status]);

  const getAiAdvice = (item: CatalogItem) => {
    if (item.status === '待复核') return { title: '暂不建议引用', className: 'bg-red-50 text-red-700 border-red-200' };
    if (item.status === '价格波动' || Math.abs(item.changeRate) >= 6) return { title: '建议二次询价', className: 'bg-orange-50 text-orange-700 border-orange-200' };
    if (item.status === '即将过期') return { title: '核价后使用', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { title: '可预算参考', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };

  const buildDetailPrompt = (item: CatalogItem) => `请对目录条目「${item.name}」做价格研判：参考价${formatPrice(item.referencePrice)}/${item.unit}，价格区间${formatPrice(item.priceMin)}-${formatPrice(item.priceMax)}，历史均价${formatPrice(item.averagePrice)}，价格变化${item.changeRate}%，来源${item.priceSource}，状态${item.status}，供应商${item.supplier}。请给出结论、风险点和采购建议。`;

  const openAssistantWithQuestion = (message: string) => {
    const question = message.trim();
    if (!question) return;
    setAssistantInitialQuestion(question);
  };

  const api = (path: string, init?: RequestInit) =>
    fetch(path, { ...init, headers: { 'X-Portal': 'mall', ...((init?.headers as Record<string, string> | undefined) || {}) }, credentials: 'include' });

  const refreshLists = async () => {
    const res = await api('/api/budget/lists');
    if (res.ok) setLists(await res.json());
  };

  const loadList = async (id: string) => {
    const res = await api(`/api/budget/lists/${id}`);
    if (!res.ok) return;
    const data: BudgetListDetail = await res.json();
    saveSkipRef.current = true;
    setCurrentList(data);
    setLines(data.items);
    try { localStorage.setItem('mall_budget_list_id', id); } catch { /* ignore */ }
  };

  const createList = async (name?: string) => {
    const res = await api('/api/budget/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || '我的预算清单' }) });
    if (!res.ok) { toast.error('新建清单失败'); return; }
    const data: BudgetListDetail = await res.json();
    await refreshLists();
    await loadList(data.id);
    toast.success('已新建预算清单');
  };

  const switchList = (id: string) => { if (id !== currentList?.id) loadList(id); };

  const renameList = async () => {
    if (!currentList) return;
    const name = window.prompt('请输入清单名称', currentList.name);
    if (name === null || !name.trim() || name.trim() === currentList.name) return;
    const res = await api(`/api/budget/lists/${currentList.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
    if (res.ok) { setCurrentList({ ...currentList, name: name.trim() }); refreshLists(); toast.success('已重命名'); }
  };

  const removeList = async () => {
    if (!currentList) return;
    if (!window.confirm(`确认删除清单「${currentList.name}」？此操作不可恢复。`)) return;
    const id = currentList.id;
    const res = await api(`/api/budget/lists/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('删除失败'); return; }
    const remaining = lists.filter(l => l.id !== id);
    setLists(remaining);
    const next = remaining.find(l => l.status !== 'CONVERTED') || remaining[0];
    if (next) await loadList(next.id);
    else { setCurrentList(null); setLines([]); await createList(); }
    toast.success('已删除清单');
  };

  const cloneList = async () => {
    if (!currentList) return;
    const res = await api(`/api/budget/lists/${currentList.id}/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    if (!res.ok) { toast.error('克隆失败'); return; }
    const data: BudgetListDetail = await res.json();
    await refreshLists();
    await loadList(data.id);
    toast.success('已克隆清单');
  };

  const convertList = async () => {
    if (!currentList || lines.length === 0) { toast.error('预算清单为空，无法生成询价单'); return; }
    const res = await api(`/api/budget/lists/${currentList.id}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json().catch(() => null);
    if (!res.ok) { toast.error((data as any)?.error || '生成询价单失败'); return; }
    await refreshLists();
    await loadList(currentList.id);
    toast.success(`已生成询价单（采购立项 ${(data as any).projectCode}），可在采购管理端继续审批`);
  };

  const SCENARIO_CODES: Record<string, string[]> = {
    乡镇供水站改造: ['CGML-SB-TREAT-026', 'CGML-SB-DOSING-027', 'CGML-SB-DISINF-028', 'CGML-XX-METER-006', 'CGML-XX-SENSOR-029', 'CGML-XX-NET-033', 'CGML-XX-CAMERA-032', 'CGML-TY-LABOR-008'],
    管网更新工程: ['CGML-GC-PIPE-020', 'CGML-GC-PIPE-019', 'CGML-GC-FITTING-021', 'CGML-SB-VALVE-010', 'CGML-SB-VALVE-022', 'CGML-SB-VALVE-023', 'CGML-XX-SENSOR-029', 'CGML-GC-GEO-007'],
    泵站设备维保: ['CGML-SB-PUMP-004', 'CGML-SB-PUMP-024', 'CGML-SB-ELEC-011', 'CGML-FW-MAINT-041', 'CGML-XX-SENSOR-029', 'CGML-XX-SENSOR-030', 'CGML-TY-LABOR-008'],
    智慧水务监测: ['CGML-XX-METER-006', 'CGML-XX-SENSOR-029', 'CGML-XX-SENSOR-030', 'CGML-XX-RTU-031', 'CGML-XX-CAMERA-032', 'CGML-XX-NET-033', 'CGML-XX-SOFT-034'],
  };

  const isConverted = currentList?.status === 'CONVERTED';

  const addToBudget = (item: CatalogItem, qty = 1, silent = false) => {
    if (isConverted) { if (!silent) toast.error('当前清单已转换为采购立项，请新建或克隆清单后再添加'); return; }
    setLines(prev => {
      const idx = prev.findIndex(row => row.catalogItemId === item.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], qty: next[idx].qty + qty }; return next; }
      return [...prev, { id: `${item.id}-${Date.now()}`, catalogItemId: item.id, code: item.code, name: item.name, specification: item.specification, unit: item.unit, referencePrice: item.referencePrice, qty }];
    });
    if (!silent) toast.success(`已加入预算清单：${item.name}`);
  };

  /** 调 AI 为场景推荐目录物资（严格 JSON）；失败返回 null 由调用方兜底。 */
  const aiScenarioBudget = async (scenario: string): Promise<{ code: string; qty: number }[] | null> => {
    try {
      const catalog = items.map(i => ({ code: i.code, name: i.name, unit: i.unit, price: i.referencePrice, category: i.category }));
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `采购场景：${scenario}。请从下列采购目录中为该场景挑选合适物资并给出数量建议。严格只返回一个JSON数组，不要解释或markdown代码块，元素形如 {"code":"目录编码","qty":数量,"reason":"简短理由"}，code 必须为目录中真实编码，推荐6-10项。目录：${JSON.stringify(catalog)}`,
          context: { scenario, totalItems: catalog.length },
        }),
      });
      if (!res.ok) return null;
      const { answer } = await res.json();
      const match = answer && String(answer).match(/\[[\s\S]*\]/);
      if (!match) return null;
      const arr = JSON.parse(match[0]);
      if (!Array.isArray(arr)) return null;
      return arr.map((x: any) => ({ code: String(x.code || ''), qty: Number(x.qty) || 1 })).filter((x: { code: string }) => x.code);
    } catch { return null; }
  };

  const addScenarioBudget = async (scenario: string) => {
    if (isConverted) { toast.error('当前清单已转换为采购立项，请新建或克隆清单后再添加'); return; }
    toast.loading(`AI 正在为「${scenario}」推荐物资…`, { id: 'ai-scenario' });
    const ai = await aiScenarioBudget(scenario);
    const picks = ai && ai.length ? ai : (SCENARIO_CODES[scenario] || []).map(code => ({ code, qty: 1 }));
    const source = ai && ai.length ? 'AI' : '模板';
    let added = 0;
    for (const p of picks) {
      const item = items.find(row => row.code === p.code);
      if (item) { addToBudget(item, p.qty, true); added += 1; }
    }
    toast.dismiss('ai-scenario');
    if (added > 0) toast.success(`已按「${scenario}」加入 ${added} 项（${source}）`);
    else toast.error('未能生成推荐，请稍后重试');
  };

  const changeQty = (lineId: string, delta: number) =>
    setLines(prev => prev.flatMap(row => (row.id !== lineId ? [row] : row.qty + delta <= 0 ? [] : [{ ...row, qty: row.qty + delta }])));

  const undoableDelete = useUndoableAction<BudgetLine>({ windowMs: 5000, label: (item) => `已删除「${item.name}」` });
  const removeLine = (line: BudgetLine) => {
    undoableDelete.execute({
      item: line,
      apply: () => setLines(prev => prev.filter(row => row.id !== line.id)),
      restore: () => setLines(prev => {
        const idx = prev.findIndex(row => row.referencePrice >= line.referencePrice && row.code > line.code);
        const next = [...prev];
        if (idx === -1) next.push(line);
        else next.splice(idx, 0, line);
        return next;
      }),
    });
  };

  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState('');

  const budgetTotal = lines.reduce((sum, row) => sum + row.referencePrice * row.qty, 0);


  // 初始化：载入或创建当前预算清单
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api('/api/budget/lists');
        if (!res.ok || cancelled) return;
        const ls: BudgetListSummary[] = await res.json();
        let stored: string | null = null;
        try { stored = localStorage.getItem('mall_budget_list_id'); } catch { /* ignore */ }
        const target = ls.find(l => l.id === stored) || ls.find(l => l.status !== 'CONVERTED') || ls[0];
        if (cancelled) return;
        setLists(ls);
        if (target) await loadList(target.id);
        else await createList('我的预算清单');
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (budgetOpen || !!detail || auditOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [budgetOpen, detail, auditOpen]);
  const registeredName = currentUser?.displayName?.trim() || '注册名称未设置';
  const userInitial = registeredName.slice(0, 1);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Portal': 'mall' }, credentials: 'include' });
    router.push('/login');
  };

  return (
    <div className="min-h-screen glass-surface text-[#18243a]" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <motion.header
        className="sticky top-0 z-50 border-b border-[#dbe6f3] bg-white/86 backdrop-blur-xl"
        animate={{ y: headerVisible ? 0 : -72 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className="flex h-[68px] items-center justify-between px-6">
          <a href={portalURL('public')} className="flex items-center gap-3 no-underline">
            <img src="/assets/logo.jpg" alt="智慧水发 · 蜀水云采" className="h-10 w-auto object-contain" />
            <span>
              <strong
                className="block text-lg font-black tracking-[0.10em]"
                style={{
                  fontFamily: '"SimHei","黑体",sans-serif',
                  background: 'linear-gradient(to right, #1a2332, #2563EB, #0891b2, #18a56c, #1a2332)',
                  backgroundSize: '200% auto',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  animation: 'brandShift 6s ease infinite',
                }}
              >智慧水发 · 蜀水云采</strong>
            </span>
          </a>

          <div className="flex items-center gap-3">
            <motion.button
              onClick={() => setBudgetOpen(true)}
              className="relative h-10 rounded-xl bg-[#064ea2] px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(6,78,162,.2)] transition hover:bg-[#043d82]"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              预算清单
              {saveStatus === 'saving' && <span className="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" title="保存中" />}
              {saveStatus === 'saved' && <motion.span key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="ml-2 text-white/80" title="已保存">✓</motion.span>}
              <AnimatePresence>
                {lines.length > 0 && (
                  <motion.span
                    key="badge"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                    className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e74c3c] px-1 text-xs text-white"
                  >
                    {lines.length}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
            <button onClick={openAudit} className="rounded-xl border border-[#d5e0ef] bg-white px-3 py-2 text-sm font-semibold text-[#5a6d8a] transition hover:border-[#064ea2] hover:text-[#064ea2]">操作记录</button>
            <div className="flex items-center gap-2 rounded-xl bg-[#f3f7fc] px-3 py-2">
              <motion.span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#064ea2] text-xs font-black text-white"
                whileHover={{ rotate: 5, scale: 1.1 }}
              >
                {userInitial}
              </motion.span>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-black text-[#18243a]">{registeredName}</div>
              </div>
            </div>
            <button onClick={handleLogout} className="rounded-xl border border-[#d5e0ef] bg-white px-3 py-2 text-sm font-semibold text-[#5a6d8a] transition hover:border-[#e74c3c] hover:text-[#e74c3c]">退出登录</button>
          </div>
        </div>
      </motion.header>

      <main className="px-6 py-6">
        {/* ===== Hero Banner ===== */}
        <section className="overflow-hidden rounded-[28px] border border-[#dbe6f3] bg-[#063f86] text-white shadow-[0_24px_70px_rgba(6,78,162,.18)]">
          <div className="relative px-8 py-8 lg:px-10">
            <motion.div
              className="absolute right-0 top-0 h-full w-1/2"
              animate={{ x: [0, '2%', '-1%', 0], y: [0, '-1%', '1%', 0], rotate: [0, 1, -1, 0] }}
              transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                background: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,.24), transparent 30%), radial-gradient(circle at 50% 80%, rgba(24,165,108,.22), transparent 34%)',
              }}
            />
            <div className="relative w-full">
              <motion.h1
                className="mb-3 text-3xl font-black tracking-wide lg:text-4xl"
                initial={{ backgroundPosition: '-200% 0' }}
                animate={{ backgroundPosition: '200% 0' }}
                transition={{ duration: 2, ease: 'easeInOut' }}
                style={{
                  background: 'linear-gradient(90deg, #fff 0%, rgba(255,255,255,.5) 50%, #fff 100%)',
                  backgroundSize: '200% 100%',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                集中采购目录
              </motion.h1>
              <p className="max-w-2xl text-sm leading-7 text-white/75">统一展示协议价、历史成交价与市场参考价，辅助预算编制、采购立项和询价比价。</p>
              <div className="relative mt-6 w-full">
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); (e.target as HTMLInputElement).blur(); } }}
                  placeholder={`搜索物资 / 规格 / 编码 / 供应商${typeof window !== 'undefined' && window.innerWidth > 768 ? '（按 / 聚焦）' : ''}`}
                  className="h-12 w-full rounded-xl border border-white/20 bg-white/95 py-0 pl-11 pr-10 text-sm text-[#18243a] outline-none transition placeholder:text-[#8a96aa] focus:border-white focus:bg-white focus:shadow-[0_0_0_4px_rgba(255,255,255,.18)]"
                />
                <motion.svg
                  className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
                  animate={{ color: search.trim() ? '#fff' : '#5a6d8a', scale: search.trim() ? 1.1 : 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </motion.svg>
                {search.trim() && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#bcc6d4] transition hover:bg-white/20 hover:text-[#5a6d8a]"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l10 10M11 1L1 11"/></svg>
                  </motion.button>
                )}
              </div>
              {search.trim() && (
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2 text-xs text-white/60"
                >
                  {filtered.length > 0 ? `找到 ${filtered.length} 项匹配物资` : '未找到匹配项'}
                </motion.p>
              )}
            </div>
          </div>
        </section>

        <MallAssistantEntry
          context={assistantContext}
          initialQuestion={assistantInitialQuestion}
          onInitialQuestionConsumed={() => setAssistantInitialQuestion('')}
        />

        <motion.section
          className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1 } } }}
        >
          {catalogLoading ? (
            Array.from({ length: 4 }).map((_, i) => <motion.div key={i} variants={{ hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0 } }}><StatCardSkeleton /></motion.div>)
          ) : [
            ['目录物资', stats.total, '纳入集团集中采购目录'],
            ['协议供应商', stats.suppliers, '已入库或框架协议供应商'],
            ['本月更新', stats.updated, '近30天维护价格条目'],
            ['价格预警', stats.alerts, '波动、过期或待复核条目'],
          ].map(([label, value, desc], idx) => (
            <StatsCard
              key={label}
              label={label as string}
              value={value as number}
              desc={desc as string}
              warn={idx === 3}
              changed={true}
            />
          ))}
        </motion.section>

        <section className="mt-5 rounded-2xl border border-[#e1e9f4] bg-white p-4 shadow-[0_10px_28px_rgba(15,35,65,.04)]">
          <div className="flex flex-wrap items-center gap-3 md:grid md:grid-cols-4">
            {[
              ['region', region, setRegion, REGIONS] as const,
              ['status', status, setStatus, STATUSES] as const,
              ['source', source, setSource, SOURCES] as const,
            ].map(([name, val, setter, options]) => {
              const hasValue = (val as string) !== '全部';
              const SelectCmp = (
                <motion.select
                  value={val as string}
                  onChange={e => setter(e.target.value as never)}
                  className={`h-11 rounded-xl border bg-white px-3 text-sm outline-none transition focus:border-[#064ea2] ${hasValue ? 'border-[#064ea2] ring-1 ring-[#064ea2]/20' : 'border-[#cdd9ea]'}`}
                  animate={hasValue ? { borderColor: '#064ea2' } : { borderColor: '#cdd9ea' }}
                >
                  {options.map(v => <option key={v as string}>{v as string}</option>)}
                </motion.select>
              );
              return hasValue ? (
                <div key={name} className="relative">
                  <span className="absolute -left-1 -top-1 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#064ea2]/30" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-[#064ea2]" />
                  </span>
                  {SelectCmp}
                </div>
              ) : <div key={name}>{SelectCmp}</div>;
            })}
            <motion.button
              onClick={resetFilters}
              className="h-11 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#5a6d8a] transition hover:border-[#064ea2] hover:text-[#064ea2]"
              whileTap={{ scale: 0.96 }}
            >
              重置筛选
            </motion.button>
          </div>
          <motion.p
            className="mt-2 text-xs font-semibold text-[#5a6d8a]"
            key={filtered.length}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            当前显示 <span className={filtered.length === 0 ? 'text-[#e74c3c]' : 'text-[#064ea2] font-bold'}>{filtered.length}</span> 项
            {filtered.length === 0 && <span className="ml-1 text-[#e74c3c]">— 请调整筛选条件</span>}
          </motion.p>
          <LiveRegion>{filtered.length > 0 ? `当前显示 ${filtered.length} 项物资` : '未找到匹配条目'}</LiveRegion>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-[#e1e9f4] bg-white p-4 shadow-[0_10px_28px_rgba(15,35,65,.04)] lg:sticky lg:top-20 lg:self-start">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-black text-[#18243a]">集中采购目录</h2>
              <motion.span
                className="rounded-full bg-[#eef3fb] px-2 py-0.5 text-xs font-bold text-[#064ea2]"
                key={filtered.length}
                initial={{ scale: 1.2 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                {filtered.length}项
              </motion.span>
            </div>
            <LayoutGroup>
              <div className="space-y-3">
                {DIRECTORY.map(section => (
                  <CategoryGroup
                    key={section.group}
                    section={section}
                    selectedCategory={category}
                    onSelect={setCategory}
                    items={items}
                    searchActive={!!search.trim()}
                    searchTerm={search.trim()}
                    filtered={filtered}
                  />
                ))}
              </div>
            </LayoutGroup>
          </aside>

          <div className="min-w-0 space-y-5">
            {focusItems.length > 0 && (
              <motion.section
                className="grid gap-4 xl:grid-cols-4"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } } }}
              >
                {focusItems.map(item => (
                  <FocusCard key={item.id} item={item} onSelect={setDetail} formatPrice={formatPrice} formatDate={formatDate} statusStyles={statusStyles} STATUS_SHORT={STATUS_SHORT} />
                ))}
              </motion.section>
            )}

            <AnimatePresence mode="wait">
              {view === 'supplier' && (
                <motion.section
                  key="supplier-view"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden rounded-2xl border border-[#e1e9f4] bg-white shadow-[0_10px_28px_rgba(15,35,65,.05)]"
                >
                  <div className="border-b border-[#e8eef6] px-5 py-4">
                    <h2 className="text-lg font-black text-[#18243a]">供应商目录</h2>
                    <p className="mt-1 text-xs text-[#8a96aa]">{suppliersAsync.status === 'loading' ? '加载供应商中…' : `共 ${suppliers.length} 家供应商，点击查看其在目录中的物资`}</p>
                  </div>
                  {suppliersAsync.status === 'error' ? (
                    <InlineError message="供应商加载失败" onRetry={suppliersAsync.retry} />
                  ) : suppliersAsync.status === 'loading' ? (
                    <div className="p-5"><CardGridSkeleton count={6} cols={3} /></div>
                  ) : suppliers.length === 0 ? (
                    <EmptyState icon={<IconBuilding />} title="暂无供应商" description="尚未有供应商纳入集中采购目录" />
                  ) : (
                  <motion.div
                    className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3"
                    initial="hidden"
                    animate="show"
                    variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
                  >
                    {suppliers.map(s => (
                      <motion.button
                        key={s.supplier}
                        variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 28 } } }}
                        onClick={() => browseSupplier(s.supplier)}
                        className="group rounded-2xl border border-[#e1e9f4] bg-white p-4 text-left"
                        whileHover={{ y: -4, borderColor: 'rgba(6,78,162,.3)', boxShadow: '0 18px 42px rgba(6,78,162,.1)' }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="line-clamp-2 text-sm font-black text-[#18243a] group-hover:text-[#064ea2]">{s.supplier}</h3>
                          <span className="shrink-0 rounded-full bg-[#eef3fb] px-2 py-0.5 text-xs font-bold text-[#064ea2]">{s.itemCount}项</span>
                        </div>
                        <div className="mt-1 text-xs text-[#8a96aa]">{s.supplierType} · {s.regions.join(' / ')}</div>
                        <div className="mt-3 flex items-end justify-between">
                          <div><span className="text-lg font-black text-[#e74c3c]">¥{s.avgPrice.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span><span className="text-xs text-[#8a96aa]"> 均价</span></div>
                          <span className="text-xs text-[#8a96aa]">{formatPrice(s.minPrice)} ~ {formatPrice(s.maxPrice)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">{s.categories.slice(0, 4).map(c => <span key={c} title={c} className="rounded bg-[#f3f7fc] px-1.5 py-0.5 text-[10px] font-bold text-[#5a6d8a]">{shortCategory(c)}</span>)}{s.categories.length > 4 && <span className="text-[10px] text-[#8a96aa]">+{s.categories.length - 4}</span>}</div>
                      </motion.button>
                    ))}
                  </motion.div>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
            <section className={`${view === 'supplier' ? 'hidden' : ''} overflow-hidden rounded-2xl border border-[#e1e9f4] bg-white shadow-[0_10px_28px_rgba(15,35,65,.05)]`}>
              <div className="flex items-center justify-between border-b border-[#e8eef6] px-5 py-4"><div><h2 className="text-lg font-black text-[#18243a]">目录清单</h2><p className="mt-1 text-xs text-[#8a96aa]">参考价用于预算编制与询价比价，最终采购价格以采购文件及成交结果为准。</p></div><div className="flex items-center gap-3">
              <button onClick={() => setShowFavoritesOnly(v => !v)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${showFavoritesOnly ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-[#cdd9ea] text-[#5a6d8a] hover:bg-[#f3f7fc]'}`}>★ 我的收藏{favoriteIds.length > 0 ? ` (${favoriteIds.length})` : ''}</button>
              <button onClick={() => setDensity(d => d === 'compact' ? 'comfortable' : 'compact')} className="rounded-lg border border-[#cdd9ea] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] transition hover:bg-[#f3f7fc]" title={density === 'compact' ? '切换舒适模式' : '切换紧凑模式'}>{density === 'compact' ? '紧凑' : '舒适'}</button>
              <div className="flex items-center gap-1 rounded-xl border border-[#cdd9ea] p-1 relative">
                <div className="relative z-20 flex">
                  <motion.button
                    onClick={() => setView('catalog')}
                    className={`relative rounded-lg px-3 py-1 text-xs font-bold transition-colors ${view === 'catalog' ? 'text-white' : 'text-[#5a6d8a] hover:text-[#064ea2]'}`}
                    whileTap={{ scale: 0.95 }}
                  >目录视图</motion.button>
                  <motion.button
                    onClick={() => setView('supplier')}
                    className={`relative rounded-lg px-3 py-1 text-xs font-bold transition-colors ${view === 'supplier' ? 'text-white' : 'text-[#5a6d8a] hover:text-[#064ea2]'}`}
                    whileTap={{ scale: 0.95 }}
                  >供应商视图</motion.button>
                </div>
                <motion.div
                  className="absolute z-[1] rounded-lg bg-[#064ea2]"
                  layoutId="view-toggle"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  style={{ width: 'calc(50% - 2px)', height: 'calc(100% - 2px)', top: 1, left: view === 'catalog' ? 1 : '50%' }}
                />
              </div>
              <button onClick={exportCatalog} disabled={exporting === 'catalog'} className="hidden items-center gap-2 rounded-xl border border-[#cdd9ea] px-4 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc] disabled:opacity-60 md:flex">
                {exporting === 'catalog' && <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>}
                {exporting === 'catalog' ? '生成中…' : '导出价格清单'}
              </button>
            </div></div>
              {/* ===== 内容区：error / loading / empty / filtered-empty / success ===== */}
              {catalogAsync.status === 'error' ? (
                <InlineError message="采购目录加载失败" detail={catalogAsync.error?.message} onRetry={catalogAsync.retry} />
              ) : catalogLoading ? (
                <>
                  <div className="hidden md:block"><TableSkeleton rows={6} /></div>
                  <div className="md:hidden"><TableSkeleton rows={4} /></div>
                </>
              ) : items.length === 0 ? (
                <EmptyState icon={<IconPackageOpen />} title="采购目录暂无数据" description="请联系管理员导入集中采购目录物资" />
              ) : filtered.length === 0 ? (
                <EmptyState icon={<IconSearchX />} title="未找到匹配条目" description="请调整关键词、分类、区域或价格状态后重试" action={{ label: '重置筛选', onClick: resetFilters }} />
              ) : (
                <>
              <div className={`hidden overflow-x-auto md:block ${density === 'compact' ? '[&_td]:py-1.5 [&_td]:px-2 [&_td]:text-xs [&_th]:py-1.5 [&_th]:px-2' : ''}`}><table className="w-full min-w-[1180px] border-collapse text-center text-sm"><thead className="bg-[#f7faff] text-xs font-bold"><tr><th className="w-10 px-2 py-3"><input type="checkbox" checked={sorted.length > 0 && selectedIds.size === sorted.length} onChange={toggleSelectAll} className="h-3.5 w-3.5 cursor-pointer accent-[#064ea2]" aria-label="全选" /></th><th className="px-3 py-3 text-[#5a6d8a]">目录编码 / 物资</th><th className="px-3 py-3 text-[#5a6d8a]">规格型号</th><th className="px-3 py-3 text-[#5a6d8a]">分类</th><th className="cursor-pointer select-none px-3 py-3 transition hover:text-[#064ea2]" onClick={() => toggleSort('referencePrice')}><span className={`inline-flex items-center gap-1 ${sort?.col === 'referencePrice' ? 'text-[#064ea2]' : ''}`}>参考价 {sort?.col === 'referencePrice' ? (sort.dir === 'desc' ? '↓' : '↑') : <span className="text-[#bcc6d4]">↕</span>}</span></th><th className="px-3 py-3 text-[#5a6d8a]">价格区间</th><th className="px-3 py-3 text-[#5a6d8a]">供应商</th><th className="px-3 py-3 text-[#5a6d8a]">来源</th><th className="cursor-pointer select-none px-3 py-3 transition hover:text-[#064ea2]" onClick={() => toggleSort('changeRate')}><span className={`inline-flex items-center gap-1 ${sort?.col === 'changeRate' ? 'text-[#064ea2]' : ''}`}>状态 {sort?.col === 'changeRate' ? (sort.dir === 'desc' ? '↓' : '↑') : <span className="text-[#bcc6d4]">↕</span>}</span></th><th className="px-3 py-3 text-center text-[#5a6d8a]">操作</th></tr></thead><tbody className="divide-y divide-[#eef3f8]"><AnimatePresence mode="popLayout">{sorted.map(item => <motion.tr layout key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} onClick={() => setDetail(item)} className={`cursor-pointer border-l-[3px] border-l-transparent transition hover:border-l-[#064ea2] hover:bg-[#f8fbff] active:bg-[#eef3fb] ${density === 'compact' ? 'h-10' : ''}`}><td className="w-10 px-2 py-4" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelectOne(item.id)} className="h-3.5 w-3.5 cursor-pointer accent-[#064ea2]" aria-label={`选择 ${item.name}`} /></td><td className="px-3 py-4"><button onClick={() => setDetail(item)} className="text-center"><div className="font-mono text-xs font-bold text-[#064ea2]">{item.code}</div><div className="mt-1 font-black text-[#18243a] hover:text-[#064ea2]">{item.name}</div></button></td><td className="max-w-[190px] px-4 py-4 text-[#344563]" title={item.specification}><div className="truncate">{item.specification}</div></td><td className="px-4 py-4"><span title={item.category} className="rounded-full bg-[#eef3fb] px-2 py-1 text-xs font-bold text-[#064ea2]">{shortCategory(item.category)}</span></td><td className="px-4 py-4"><span className="text-base font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#8a96aa]">/{item.unit}</span></td><td className="px-4 py-4 text-[#5a6d8a]">{formatPrice(item.priceMin)} - {formatPrice(item.priceMax)}</td><td className="max-w-[180px] px-4 py-4"><div className="truncate font-semibold text-[#18243a]" title={item.supplier}>{item.supplier}</div><div className="mt-1 text-xs text-[#8a96aa]">{item.supplierType} · {item.region}</div></td><td className="px-4 py-4"><span title={item.priceSource} className={`rounded-full px-2 py-1 text-xs font-bold ${sourceStyles[item.priceSource]}`}>{SOURCE_SHORT[item.priceSource]}</span></td><td className="px-4 py-4"><span title={item.status} className={`rounded-full border px-2 py-1 text-xs font-bold ${statusStyles[item.status]}`}>{STATUS_SHORT[item.status]}</span><div className={`mt-1 text-xs font-bold ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#8a96aa]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</div></td><td className="px-4 py-4 text-center"><button onClick={(e) => { e.stopPropagation(); toggleFavorite(item); }} className={`mr-1 text-base align-middle transition hover:scale-110 ${favoriteIds.includes(item.id) ? 'text-amber-400' : 'text-[#c3ccd8]'}`} title={favoriteIds.includes(item.id) ? '取消收藏' : '收藏'}>{favoriteIds.includes(item.id) ? '★' : '☆'}</button><button onClick={() => setDetail(item)} className="mr-2 text-xs font-bold text-[#064ea2] hover:underline">详情</button><button onClick={(e) => { e.stopPropagation(); addToBudget(item); }} className="rounded-lg bg-[#064ea2] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#043d82]">加入预算</button></td></motion.tr>)}</AnimatePresence></tbody></table></div>
              <div className="divide-y divide-[#eef3f8] md:hidden">
              {sorted.map(item => (
                <div key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelectOne(item.id)} className="mt-0.5 h-3.5 w-3.5 accent-[#064ea2]" />
                    <button onClick={() => setDetail(item)} className="min-w-0 flex-1 text-left">
                      <div className="font-mono text-xs font-bold text-[#064ea2]">{item.code}</div>
                      <div className="mt-0.5 truncate text-sm font-black text-[#18243a]">{item.name}</div>
                      <div className="mt-0.5 truncate text-xs text-[#8a96aa]">{item.specification}</div>
                    </button>
                    <button onClick={() => toggleFavorite(item)} className={`shrink-0 text-lg ${favoriteIds.includes(item.id) ? 'text-amber-400' : 'text-[#c3ccd8]'}`} title={favoriteIds.includes(item.id) ? '取消收藏' : '收藏'}>{favoriteIds.includes(item.id) ? '★' : '☆'}</button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span title={item.status} className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusStyles[item.status]}`}>{STATUS_SHORT[item.status]}</span>
                    <span className={`text-xs font-bold ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#8a96aa]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</span>
                    <span title={item.priceSource} className={`rounded-full px-2 py-0.5 text-xs font-bold ${sourceStyles[item.priceSource]}`}>{SOURCE_SHORT[item.priceSource]}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div><span className="text-lg font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#8a96aa]">/{item.unit}</span></div>
                    <button onClick={(e) => { e.stopPropagation(); addToBudget(item); }} className="rounded-lg bg-[#064ea2] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#043d82]">加入预算</button>
                  </div>
                </div>
              ))}
            </div>
                </>
              )}
            </section>
          </div>
        </section>
      </main>

      {/* ===== 批量操作浮动栏 ===== */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="fixed bottom-6 left-1/2 z-[120] -translate-x-1/2"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-[#064ea2]/20 bg-white px-5 py-3 shadow-[0_8px_40px_rgba(6,78,162,.15)]">
              <span className="text-sm font-bold text-[#18243a]">已选 <span className="text-[#064ea2]">{selectedIds.size}</span> 项</span>
              <button onClick={batchAddToBudget} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#043d82] active:scale-95">加入预算清单</button>
              <button onClick={clearSelection} className="text-sm font-semibold text-[#8a96aa] transition hover:text-[#18243a]">清空选择</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {mounted && createPortal(
        <AnimatePresence>
          {budgetOpen && (
            <motion.div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                className="absolute inset-0 bg-[#0f1f35]/40 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setBudgetOpen(false)}
              />
              <motion.div
                className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                initial={{ opacity: 0, y: 40, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 30, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                drag="y"
                dragConstraints={{ top: 0 }}
                dragElastic={0.1}
                onDragEnd={(_, info) => { if (info.offset.y > 100) setBudgetOpen(false); }}
              >
            <div className="border-b border-[#e5ecf4] px-6 py-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <select value={currentList?.id ?? ''} onChange={e => switchList(e.target.value)} className="min-w-0 max-w-[55%] truncate rounded-lg border border-[#cdd9ea] bg-white px-2 py-1.5 text-sm font-black text-[#18243a] outline-none focus:border-[#064ea2]">
                    {lists.map(l => <option key={l.id} value={l.id}>{l.name}{l.status === 'CONVERTED' ? '（已转询价单）' : l.itemCount > 0 ? `（${l.itemCount}项 · ¥${l.totalAmount ?? 0}）` : ''}</option>)}
                  </select>
                  {isConverted && <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">已转询价单</span>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => createList()} title="新建清单" className="rounded-lg border border-[#cdd9ea] px-2 py-1 text-xs font-bold text-[#064ea2] hover:bg-[#f3f7fc]">+ 新建</button>
                  <button onClick={renameList} title="重命名" className="rounded-lg border border-[#cdd9ea] px-2 py-1 text-xs font-bold text-[#5a6d8a] hover:bg-[#f3f7fc]">重命名</button>
                  <button onClick={cloneList} title="克隆" className="rounded-lg border border-[#cdd9ea] px-2 py-1 text-xs font-bold text-[#5a6d8a] hover:bg-[#f3f7fc]">克隆</button>
                  <button onClick={removeList} title="删除" className="rounded-lg border border-[#cdd9ea] px-2 py-1 text-xs font-bold text-[#e74c3c] hover:bg-[#fdf2f2]">删除</button>
                  <button onClick={() => setBudgetOpen(false)} className="ml-1 flex h-8 w-8 items-center justify-center rounded-xl text-[#8a96aa] hover:bg-[#f3f7fc]">✕</button>
                </div>
              </div>
              <p className="mt-2 text-xs text-[#8a96aa]">用于项目预算、采购立项附件和询价前准备 · 自动保存</p>
              {!isConverted && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {['乡镇供水站改造', '管网更新工程', '泵站设备维保', '智慧水务监测'].map(scenario => <button key={scenario} onClick={() => addScenarioBudget(scenario)} className="rounded-full bg-[#eef3fb] px-3 py-1 text-xs font-bold text-[#064ea2] hover:bg-[#dfeeff]">AI生成：{scenario}</button>)}
                </div>
              )}
            </div>
            {lines.length > 0 ? (
              <>
                <div className="flex-1 overflow-auto px-6 py-3">
                  {lines.map(line => (
                    <div key={line.id} className="border-b border-[#eef3f8] py-4">
                      <div className="flex justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-mono text-xs font-bold text-[#064ea2]">{line.code}</div>
                          <div className="mt-1 truncate text-sm font-black text-[#18243a]">{line.name}</div>
                          <div className="mt-1 text-xs text-[#8a96aa]">{line.specification}</div>
                        </div>
                        {!isConverted && <button onClick={() => removeLine(line)} className="text-sm text-[#c3ccd8] transition hover:text-[#e74c3c]">删除</button>}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isConverted ? (
                            <span className="text-sm font-black text-[#18243a]">数量 {line.qty}</span>
                          ) : (
                            <>
                              <QtyButton delta={-1} onChange={() => changeQty(line.id, -1)} />
                              {editingQtyId === line.id ? (
                                <form onSubmit={e => { e.preventDefault(); const v = parseInt(editingQtyValue); if (v > 0) setLines(prev => prev.map(r => r.id === line.id ? {...r, qty: v} : r)); setEditingQtyId(null); }} className="flex">
                                  <input autoFocus value={editingQtyValue} onChange={e => setEditingQtyValue(e.target.value)} onBlur={() => { const v = parseInt(editingQtyValue); if (v > 0) setLines(prev => prev.map(r => r.id === line.id ? {...r, qty: v} : r)); setEditingQtyId(null); }} className="w-10 rounded-md border border-[#064ea2] px-1 text-center text-sm font-black outline-none" />
                                </form>
                              ) : (
                                <button onClick={() => { setEditingQtyId(line.id); setEditingQtyValue(String(line.qty)); }} className="w-8 text-center text-sm font-black hover:text-[#064ea2]">{line.qty}</button>
                              )}
                              <QtyButton delta={1} onChange={() => changeQty(line.id, 1)} />
                            </>
                          )}
                          <span className="text-xs text-[#8a96aa]">{line.unit}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-[#8a96aa]">参考小计</div>
                          <div className="font-black text-[#e74c3c]">{formatPrice(line.referencePrice * line.qty)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-[#e5ecf4] px-6 py-4">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm font-bold text-[#5a6d8a]">预算参考合计</span>
                    <span className="text-2xl font-black text-[#e74c3c]">{formatPrice(budgetTotal)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={exportBudget} disabled={exporting === 'budget'} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc] disabled:opacity-60">
                      {exporting === 'budget' && <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>}
                      {exporting === 'budget' ? '生成中…' : '导出预算清单'}
                    </button>
                    {isConverted ? (
                      <button onClick={() => setBudgetOpen(false)} className="h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white">已完成，关闭</button>
                    ) : (
                      <button onClick={convertList} className="h-11 rounded-xl bg-[#064ea2] text-sm font-bold text-white transition hover:bg-[#043d82]">生成询价单</button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className="text-5xl">📑</div>
                <p className="mt-3 text-sm font-bold text-[#8a96aa]">{isConverted ? '该清单已转换' : '预算清单为空'}</p>
                {!isConverted && <button onClick={() => setBudgetOpen(false)} className="mt-3 text-sm font-bold text-[#064ea2] hover:underline">返回目录选择物资</button>}
              </div>
            )}
          </motion.div>
        </motion.div>
        )}
        </AnimatePresence>,
        document.body,
      )}


      {mounted && createPortal(
        <AnimatePresence>
          {detail && (
            <motion.div
              className="fixed inset-0 z-[110] flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                className="absolute inset-0 bg-[#0f1f35]/40 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDetail(null)}
              />
              <motion.div
                className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white shadow-2xl"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 30 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                drag="x"
                dragConstraints={{ left: 0 }}
                dragElastic={0.1}
                onDragEnd={(_, info) => { if (info.offset.x > 120) setDetail(null); }}
              ><div className="border-b border-[#e5ecf4] bg-[#f8fbff] px-6 py-5"><div className="mb-3 flex items-center justify-between"><span className="font-mono text-xs font-black text-[#064ea2]">{detail.code}</span><button onClick={() => toggleFavorite(detail)} className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg transition hover:bg-white ${favoriteIds.includes(detail.id) ? 'text-amber-400' : 'text-[#c3ccd8]'}`} title={favoriteIds.includes(detail.id) ? '取消收藏' : '收藏'}>{favoriteIds.includes(detail.id) ? '★' : '☆'}</button><button onClick={() => setDetail(null)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a96aa] transition hover:bg-white">✕</button></div><h2 className="text-2xl font-black text-[#18243a]">{detail.name}</h2><p className="mt-2 text-sm text-[#5a6d8a]">{detail.specification}</p></div><div className="space-y-5 px-6 py-5"><div className="rounded-2xl border border-[#e1e9f4] p-5"><button onClick={() => setPriceOpen(o => !o)} className="mb-3 flex w-full items-center gap-2 text-left text-sm font-black text-[#18243a] transition hover:text-[#064ea2]"><svg className={`h-3 w-3 shrink-0 text-[#5a6d8a] transition-transform duration-200 ${priceOpen ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>价格信息</button>{priceOpen && <div className="grid gap-4 sm:grid-cols-2"><Info label="当前参考价" value={`${formatPrice(detail.referencePrice)} / ${detail.unit}`} strong /><Info label="价格区间" value={`${formatPrice(detail.priceMin)} - ${formatPrice(detail.priceMax)}`} /><Info label="最近成交价" value={formatPrice(detail.lastDealPrice)} /><Info label="历史采购均价" value={formatPrice(detail.averagePrice)} /><Info label="价格变化" value={`${detail.changeRate > 0 ? '+' : ''}${detail.changeRate}%`} /><Info label="价格状态" value={detail.status} /></div>}</div><div className="rounded-2xl border border-[#e1e9f4] p-5"><button onClick={() => setSupplierOpen(o => !o)} className="mb-3 flex w-full items-center gap-2 text-left text-sm font-black text-[#18243a] transition hover:text-[#064ea2]"><svg className={`h-3 w-3 shrink-0 text-[#5a6d8a] transition-transform duration-200 ${supplierOpen ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>供应商与适用范围</button>{supplierOpen && <div className="grid gap-4 sm:grid-cols-2"><Info label="供应商" value={detail.supplier} /><Info label="供应商类型" value={detail.supplierType} /><Info label="适用区域" value={detail.region} /><Info label="最小参考采购量" value={detail.minOrder} /><Info label="含税" value={detail.taxIncluded ? '是' : '否'} /><Info label="含运费" value={detail.freightIncluded ? '是' : '否'} /></div>}</div><div className="rounded-2xl border border-[#e1e9f4] p-5"><button onClick={() => setBasisOpen(o => !o)} className="mb-3 flex w-full items-center gap-2 text-left text-sm font-black text-[#18243a] transition hover:text-[#064ea2]"><svg className={`h-3 w-3 shrink-0 text-[#5a6d8a] transition-transform duration-200 ${basisOpen ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>价格依据</button>{basisOpen && <div className="grid gap-4 sm:grid-cols-2"><Info label="价格来源" value={detail.priceSource} /><Info label="更新时间" value={formatDate(detail.updatedAt)} /><Info label="有效期至" value={formatDate(detail.validUntil)} /><Info label="分类目录" value={`${detail.group} / ${detail.category}`} /></div>}{basisOpen && <p className="mt-4 rounded-xl bg-[#f7faff] p-3 text-sm leading-6 text-[#5a6d8a]">{detail.remark}</p>}</div><div className="rounded-2xl border border-[#e1e9f4] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-black text-[#18243a]">价格趋势</div>
              {daysLeft !== null && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${daysLeft > 60 ? 'bg-emerald-50 text-emerald-700' : daysLeft > 30 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{daysLeft > 30 ? '剩余有效期' : '即将过期'} {daysLeft} 天</span>}
            </div>
            {detailHistoryLoading ? (
              <div className="py-6" role="status" aria-label="加载价格趋势中" aria-busy="true">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <div className="skeleton-shimmer h-3 w-32 rounded" />
                  <div className="skeleton-shimmer h-3 w-16 rounded" />
                </div>
                <div className="skeleton-shimmer h-[170px] w-full rounded-md" />
              </div>
            ) : (
              <PriceChart points={detailHistory} />
            )}
          </div>
          <div className="rounded-2xl border border-[#bfd4f4] bg-gradient-to-br from-[#f8fbff] to-white p-5"><div className="mb-3 flex items-center justify-between"><div className="text-sm font-black text-[#123a6e]">AI 价格研判</div><button onClick={() => openAssistantWithQuestion(buildDetailPrompt(detail))} className="rounded-full bg-[#064ea2] px-3 py-1 text-xs font-black text-white">AI 智能分析</button></div><p className="text-sm leading-6 text-[#5a6d8a]">点击分析后，AI 将结合参考价、价格区间、历史均价、供应商、价格来源和有效期，生成风险结论、询价建议和预算引用说明。</p></div><div className="grid grid-cols-2 gap-3"><button onClick={() => { navigator.clipboard?.writeText(detail.code); toast.success('目录编码已复制'); }} className="h-11 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc]">复制目录编码</button><button onClick={() => { addToBudget(detail); setDetail(null); }} className="h-11 rounded-xl bg-[#064ea2] text-sm font-bold text-white transition hover:bg-[#043d82]">加入预算清单</button></div></div></motion.div></motion.div>)}</AnimatePresence>, document.body)}
      {mounted && createPortal(
        <AnimatePresence>
          {auditOpen && (
            <motion.div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                className="absolute inset-0 bg-[#0f1f35]/40 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setAuditOpen(false)}
              />
              <motion.div
                className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                initial={{ opacity: 0, y: 30, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
            <div className="flex items-center justify-between border-b border-[#e5ecf4] px-6 py-4">
              <div><h2 className="text-lg font-black text-[#18243a]">操作记录</h2><p className="mt-1 text-xs text-[#8a96aa]">关键操作审计留痕（生成询价单 / 导出）</p></div>
              <button onClick={() => setAuditOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a96aa] hover:bg-[#f3f7fc]">✕</button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-3">
              {auditLogs.length === 0 ? (
                <div className="py-16 text-center text-sm text-[#8a96aa]">暂无操作记录</div>
              ) : auditLogs.map(log => (
                <div key={log.id} className="border-b border-[#eef3f8] py-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-[#eef3fb] px-2 py-0.5 text-xs font-bold text-[#064ea2]">{AUDIT_LABELS[log.action] || log.action}</span>
                    <span className="text-xs text-[#8a96aa]">{new Date(log.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[#18243a]">{log.target}</p>
                  {log.detail && typeof log.detail === 'object' && Object.keys(log.detail).length > 0 && (
                    <p className="mt-1 text-xs text-[#8a96aa]">{Object.entries(log.detail).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
                  )}
                </div>
              ))}
            </div>
            </motion.div></motion.div>)}</AnimatePresence>,
        document.body,
      )}
    </div>
  );
}


// ===== 空状态内联 SVG 图标（1.2px 描边，匹配 .impeccable.md） =====
function IconPackageOpen() {
  return <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M3.3 7 12 12l8.7-5" /><path d="M12 12v10" /></svg>;
}
function IconSearchX() {
  return <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="m13.5 13.5 5 5" /><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="m8 8 6 6" /><path d="m14 8-6 6" /></svg>;
}
function IconBuilding() {
  return <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" /></svg>;
}

function Info({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><div className="text-xs font-bold text-[#8a96aa]">{label}</div><div className={`mt-1 text-sm ${strong ? 'text-xl font-black text-[#e74c3c]' : 'font-semibold text-[#18243a]'}`}>{value}</div></div>;
}

/** Stats card with animated count-up */
function StatsCard({ label, value, desc, warn, changed }: { label: string; value: number; desc: string; warn?: boolean; changed?: boolean }) {
  const display = useCountUp(value, { duration: 0.8, spring: true });
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 28 } } }}
      className="rounded-2xl border border-[#e1e9f4] bg-white p-5 shadow-[0_10px_28px_rgba(15,35,65,.05)]"
      whileHover={{ y: -4, boxShadow: '0 18px 40px rgba(15,35,65,.08)' }}
    >
      <div className="text-sm font-bold text-[#5a6d8a]">{label}</div>
      <motion.div
        className={`mt-2 text-3xl font-black ${warn ? 'text-[#e67e22]' : 'text-[#064ea2]'}`}
        animate={changed ? { scale: [1, 1.05, 1] } : {}}
        transition={{ duration: 0.4 }}
      >
        <motion.span>{display}</motion.span>
      </motion.div>
      <div className="mt-1 text-xs text-[#8a96aa]">{desc}</div>
    </motion.div>
  );
}

/** Focus item card */
function FocusCard({ item, onSelect, formatPrice, formatDate, statusStyles, STATUS_SHORT }: {
  item: CatalogItem; onSelect: (item: CatalogItem) => void;
  formatPrice: (p: number) => string; formatDate: (d: string | null) => string;
  statusStyles: Record<PriceStatus, string>; STATUS_SHORT: Record<PriceStatus, string>;
}) {
  return (
    <motion.button
      variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 28 } } }}
      onClick={() => onSelect(item)}
      className="group rounded-2xl border border-[#e1e9f4] bg-white p-4 text-left shadow-[0_10px_28px_rgba(15,35,65,.04)]"
      whileHover={{ y: -4, borderColor: 'rgba(6,78,162,.3)', boxShadow: '0 18px 42px rgba(6,78,162,.1)' }}
      whileTap={{ scale: 0.97 }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span title={item.status} className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusStyles[item.status]}`}>{STATUS_SHORT[item.status]}</span>
        <span className={`text-xs font-black ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#8a96aa]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</span>
      </div>
      <h3 className="line-clamp-1 text-sm font-black text-[#18243a] group-hover:text-[#064ea2]">{item.name}</h3>
      <p className="mt-1 line-clamp-1 text-xs text-[#8a96aa]">{item.specification}</p>
      <div className="mt-3 flex items-end justify-between">
        <div><span className="text-xl font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#8a96aa]">/{item.unit}</span></div>
        <span className="text-xs font-semibold text-[#5a6d8a]">{formatDate(item.validUntil)}</span>
      </div>
    </motion.button>
  );
}

/** Collapsible category group */
function CategoryGroup({ section, selectedCategory, onSelect, items, searchActive, searchTerm, filtered }: {
  section: { group: string; children: string[] };
  selectedCategory: string; onSelect: (cat: string) => void;
  items: CatalogItem[]; searchActive: boolean; searchTerm: string; filtered: CatalogItem[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasSearchMatch = searchActive && section.children.some(
    child => child === '全部' ? items.some(i => i.name.includes(searchTerm) || i.code.includes(searchTerm)) :
    items.some(i => (i.category === child || i.group === child) && (i.name.includes(searchTerm) || i.code.includes(searchTerm)))
  );
  return (
    <div key={section.group}>
      <button
        onClick={() => setCollapsed(c => !c)}
        className={`mb-1 flex w-full items-center gap-1 text-xs font-bold ${hasSearchMatch ? 'text-[#064ea2]' : 'text-[#8a96aa]'} transition`}
      >
        <motion.svg
          animate={{ rotate: collapsed ? -90 : 0 }}
          transition={{ duration: 0.2 }}
          className="h-3 w-3 shrink-0"
          viewBox="0 0 12 12" fill="none"
        >
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </motion.svg>
        {section.group}
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="grid gap-1">
              <LayoutGroup>
                {section.children.map(child => {
                  const count = child === '全部' ? items.length : items.filter(item => item.category === child || item.group === child).length;
                  const active = selectedCategory === child;
                  const hasMatch = searchActive && (
                    child === '全部'
                      ? items.some(i => i.name.includes(searchTerm) || i.code.includes(searchTerm))
                      : items.some(i => (i.category === child || i.group === child) && (i.name.includes(searchTerm) || i.code.includes(searchTerm)))
                  );
                  return (
                    <motion.button
                      key={child}
                      layout
                      onClick={() => onSelect(child)}
                      className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                        active
                          ? 'bg-[#064ea2] text-white shadow-[0_8px_18px_rgba(6,78,162,.2)]'
                          : hasMatch ? 'bg-[#eef6ff] text-[#064ea2] border-l-[3px] border-l-[#064ea2] pl-[9px]'
                          : 'text-[#344563] hover:bg-[#f3f7fc] hover:text-[#064ea2]'
                      }`}
                    >
                      <span>{child}</span>
                      <span className={`text-xs ${active ? 'text-white/70' : 'text-[#8a96aa]'}`}>{count}</span>
                    </motion.button>
                  );
                })}
              </LayoutGroup>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ===== 长按数量按钮 =====
function QtyButton({ delta, onChange }: { delta: number; onChange: () => void }) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const start = useCallback(() => {
    onChangeRef.current();
    setTimeout(() => {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        const speed = Math.max(80, 300 - elapsed / 10); // 加速：300ms→80ms
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = setInterval(() => onChangeRef.current(), speed); }
      }, 350); // 400ms 后开始长按
    }, 400);
  }, []);

  return (
    <button
      onClick={onChange}
      onPointerDown={e => { e.preventDefault(); start(); }}
      onPointerUp={stop}
      onPointerLeave={stop}
      className="h-7 w-7 select-none rounded-lg bg-[#f0f3f8] font-bold text-[#5a6d8a] transition active:bg-[#e1e9f4]"
    >{delta > 0 ? '+' : '−'}</button>
  );
}

