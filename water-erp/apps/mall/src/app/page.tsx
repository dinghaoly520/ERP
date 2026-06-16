'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, LayoutGroup, Reorder } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { portalURL } from '@water-erp/config';
import PriceChart from './price-chart';
import { HeroSection } from '@/components/hero-section';
import type { MallAssistantContext } from './assistant/types';
import { useCountUp, useDataChanged, useAsyncState, StateBoundary, InlineError, TableSkeleton, CardGridSkeleton, EmptyState, LiveRegion, AnimatedBadge, StaggerContainer, StaggerItem, useAutoSave, useUndoableAction, useFocusTrap, useDismissable } from './interactions';

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
  const ReorderGroup = Reorder.Group as React.ComponentType<any>;
  const ReorderItem = Reorder.Item as React.ComponentType<any>;
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('mall-search-history') || '[]'); } catch { return []; }
  });
  const addSearchHistory = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    const next = [trimmed, ...searchHistory.filter(s => s !== trimmed)].slice(0, 8);
    setSearchHistory(next);
    try { localStorage.setItem('mall-search-history', JSON.stringify(next)); } catch {}
  };
  const clearSearchHistory = () => { setSearchHistory([]); try { localStorage.removeItem('mall-search-history'); } catch {} };
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
  const [successOverlay, setSuccessOverlay] = useState<{ projectCode: string } | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
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

  // 数据最后更新时间
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const prevItemsLen = useRef(0);

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

  // 追踪数据更新时间
  useEffect(() => {
    if (items.length > 0 && items.length !== prevItemsLen.current) {
      setLastUpdatedAt(new Date());
      prevItemsLen.current = items.length;
    }
  }, [items.length]);

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

  const lastToggledIdxRef = useRef<number>(0);
  const toggleSelectOne = (id: string, idx?: number, shiftKey?: boolean) => {
    if (shiftKey && typeof idx === 'number') {
      const lo = Math.min(idx, lastToggledIdxRef.current);
      const hi = Math.max(idx, lastToggledIdxRef.current);
      setSelectedIds(prev => { const next = new Set(prev); sorted.slice(lo, hi + 1).forEach(i => next.add(i.id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    }
    if (typeof idx === 'number') lastToggledIdxRef.current = idx;
  };
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
          case 'category': return item.category;
          case 'name': return item.name;
          default: return 0;
        }
      };
      const va = getVal(a), vb = getVal(b);
      if (typeof va === 'string' && typeof vb === 'string') {
        return sort.dir === 'desc' ? vb.localeCompare(va, 'zh') : va.localeCompare(vb, 'zh');
      }
      return sort.dir === 'desc' ? (vb as number) - (va as number) : (va as number) - (vb as number);
    });
  }, [filtered, sort]);

  const searchSuggestions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term || term.length < 1) return [];
    return items.filter(i => i.name.toLowerCase().includes(term) || i.code.toLowerCase().includes(term)).slice(0, 5);
  }, [items, search]);

  const compareItems = useMemo(() => sorted.filter(i => selectedIds.has(i.id)), [sorted, selectedIds]);

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

  /** 生成随机的分析提问，每次点击都不同 */
  const buildAnalysisQuestion = () => {
    const ctx = {
      total: filtered.length,
      warning: filtered.filter(i => i.status !== '有效').length,
      categories: [...new Set(filtered.slice(0, 30).map(i => i.category))],
      suppliers: [...new Set(filtered.slice(0, 30).map(i => i.supplier))],
      priceRange: filtered.length > 0
        ? `${formatPrice(Math.min(...filtered.map(i => i.referencePrice)))} ~ ${formatPrice(Math.max(...filtered.map(i => i.referencePrice)))}`
        : '',
      topSupplier: filtered.length > 0
        ? filtered.reduce((a, b) => (filtered.filter(x => x.supplier === a.supplier).length >= filtered.filter(x => x.supplier === b.supplier).length) ? a : b).supplier
        : '',
    };

    const angles = [
      // 价格维度
      `当前共 ${ctx.total} 项物资，请从价格合理性角度分析，指出价格偏高或偏低的条目，并给出询价建议。`,
      `请对当前 ${ctx.total} 项物资做价格竞争力分析：哪些物资价格高于市场均价，哪些存在降价空间？`,
      `对比分析当前筛选结果中各供应商的报价水平，判断是否存在明显的价格差异，指出需重点关注的品类。`,

      // 供应商维度
      `从供应商集中度角度分析当前 ${ctx.total} 项物资：是否存在单一供应商依赖？分布是否合理？给出分散采购风险的建议。`,
      `当前物资来自 ${ctx.suppliers.length} 家供应商，请评估供应商结构是否健康，是否存在供应风险。`,
      `分析当前供应商的报价特征：哪些供应商在特定品类有价格优势？哪些品类供应商竞争不足？`,

      // 风险维度
      `对当前 ${ctx.total} 项物资进行风险扫描：哪些条目临近有效期、价格波动异常或来源不可靠？按风险优先级列出。`,
      `请审视当前筛选结果中的潜在风险：价格异常波动、供应商单一来源、即将过期的条目，逐一标注风险等级。`,
      `${ctx.warning > 0 ? `当前有 ${ctx.warning} 项预警物资` : '当前物资状态均为正常'}，请深入分析这些物资的价格趋势和供应稳定性，给出采购时点建议。`,

      // 预算维度
      `基于当前 ${ctx.total} 项物资，生成一份预算编制参考：按品类给出建议的预算区间和注意事项。`,
      `请结合当前的价格数据和供应商分布，为编制采购预算提供具体的数据支撑和风险提示。`,
      `从成本控制角度分析：哪些品类可以选择替代供应商以降低成本？哪些品类建议维持现有供应商？`,

      // 趋势与建议
      `综合分析当前 ${ctx.total} 项物资的价格走势、供应商格局和风险分布，给出本月采购优先级排序和行动建议。`,
      `请对当前筛选结果做全面的价格体检：覆盖价格合理性、供应商健康度、风险预警三个维度，给出可操作的改进建议。`,
      `假设需要从当前物资中优先采购一批，请给出你的推荐清单和理由，综合考虑价格、供应商可靠性和风险因素。`,
    ];

    // 随机选取一个角度 + 附加一些上下文细节让问题更具体
    const seed = Date.now();
    const idx = seed % angles.length;
    return angles[idx];
  };

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
    setBudgetOpen(false);
    setSuccessOverlay({ projectCode: (data as any).projectCode });
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

  // ===== 对话框无障碍：focusTrap + dismissable =====
  const budgetTrapRef = useFocusTrap({ active: budgetOpen });
  const { overlayRef: budgetOverlayRef, onOverlayClick: onBudgetOverlay } = useDismissable({ active: budgetOpen, onClose: () => setBudgetOpen(false) });
  const detailTrapRef = useFocusTrap({ active: !!detail });
  const { overlayRef: detailOverlayRef, onOverlayClick: onDetailOverlay } = useDismissable({ active: !!detail, onClose: () => setDetail(null) });
  const auditTrapRef = useFocusTrap({ active: auditOpen });
  const { overlayRef: auditOverlayRef, onOverlayClick: onAuditOverlay } = useDismissable({ active: auditOpen, onClose: () => setAuditOpen(false) });

  const undoableDelete = useUndoableAction<BudgetLine>({ windowMs: 5000, label: (item) => `已删除「${item.name}」` });
  const removeLine = (line: BudgetLine) => {
    undoableDelete.execute({
      item: line,
      apply: () => setLines(prev => prev.filter(row => row.id !== line.id)),
      restore: () => setLines(prev => [...prev, line]),
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
    <div className="min-h-screen glass-surface text-[#334155]" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      {/* ═══════ 顶栏 · 品牌 + 操作区 ═══════ */}
      <motion.header
        className="sticky top-0 z-50 border-b border-[#dbe6f3] bg-white/86 backdrop-blur-xl"
        initial={{ y: -80 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className="flex h-[68px] items-center justify-between px-6">
          <a href={portalURL('public')} className="flex items-center gap-3 no-underline">
            <img src="/assets/logo.png" alt="智慧水发 · 蜀水云采" className="h-10 w-auto object-contain" />
            <span>
              <strong
                className="block text-lg font-black tracking-[0.10em]"
                style={{
                  fontFamily: '"SimHei","黑体",sans-serif',
                  backgroundImage: 'linear-gradient(to right, #334155, #2563EB, #0891b2, #18a56c, #334155)',
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
            <div className="flex items-center gap-2 rounded-xl bg-[#f3f7fc] px-3 py-2">
              <motion.span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#5b9bd5] text-xs font-black text-white"
                whileHover={{ rotate: 5, scale: 1.1 }}
              >
                {userInitial}
              </motion.span>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-black text-[#334155]">{registeredName}</div>
              </div>
            </div>
            <button onClick={handleLogout} className="rounded-xl border border-[#d5e0ef] bg-white px-3 py-2 text-sm font-semibold text-[#5a6d8a] transition hover:border-[#e74c3c] hover:text-[#e74c3c]">退出登录</button>
          </div>
        </div>
      </motion.header>

      <main className="px-4 pb-4 pt-2">
        {/* ===== Hero · 水叮当指挥中心 ===== */}
        <HeroSection
          search={search}
          onSearchChange={setSearch}
          searchHistory={searchHistory}
          onAddSearchHistory={addSearchHistory}
          onClearSearchHistory={clearSearchHistory}
          searchSuggestions={searchSuggestions}
          filteredCount={filtered.length}
          assistantContext={assistantContext}
          assistantInitialQuestion={assistantInitialQuestion}
          onAssistantInitialQuestionConsumed={() => setAssistantInitialQuestion('')}
          formatPrice={formatPrice}
        />

        {/* ── 指挥台：六区功能面板 ── */}
        <motion.section
          className="mt-3 flex items-center rounded-xl border border-[#cdd9ea] bg-white overflow-hidden h-12"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          {/* ━━ ① 数据脉搏 · 浅色系同行统计 ━━ */}
          <div className="flex items-center h-full shrink-0 bg-[#f1f5f9] border-r-2 border-[#e2e8f0]">
            {catalogLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`flex items-center gap-1.5 px-3 ${i > 0 ? 'border-l border-[#e2e8f0]' : ''}`}>
                  <div className="h-2.5 w-8 skeleton-shimmer rounded" />
                  <div className="h-4 w-5 skeleton-shimmer rounded" />
                </div>
              ))
            ) : (
              <>
                <div className="flex items-center gap-1.5 px-3 h-full">
                  <span className="text-xs font-semibold text-[#64748b]">目录</span>
                  <span className="text-sm font-black text-[#5b9bd5] tabular-nums" style={{fontFamily:"'SF Mono','Menlo',monospace"}}>{stats.total}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 h-full border-l border-[#e5ecf4]">
                  <span className="text-xs font-semibold text-[#64748b]">供应商</span>
                  <span className="text-sm font-black text-[#0891b2] tabular-nums" style={{fontFamily:"'SF Mono','Menlo',monospace"}}>{stats.suppliers}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 h-full border-l border-[#e5ecf4]">
                  <span className="text-xs font-semibold text-[#64748b]">月更</span>
                  <span className="text-sm font-black text-[#059669] tabular-nums" style={{fontFamily:"'SF Mono','Menlo',monospace"}}>{stats.updated}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 h-full border-l border-[#fde68a] bg-amber-50/30">
                  <span className="text-xs font-semibold text-[#64748b]">预警</span>
                  <span className="text-sm font-black text-[#d97706] tabular-nums" style={{fontFamily:"'SF Mono','Menlo',monospace"}}>{stats.alerts}</span>
                </div>
              </>
            )}
          </div>

          {/* ━━ ② 视切 · 石板灰 ━━ */}
          <div className="flex items-center h-full shrink-0 bg-[#f1f5f9] border-r-2 border-[#cbd5e1]">
            <div className="flex items-center gap-0 rounded border border-[#cbd5e1] bg-white p-0.5 mx-2.5 relative">
              <motion.button onClick={() => setView('catalog')}
                className={`relative z-10 rounded-sm px-3 py-1 text-[11px] font-bold transition-colors ${view === 'catalog' ? 'text-white' : 'text-[#64748b] hover:text-[#334155]'}`}
                whileTap={{ scale: 0.95 }}>目录清单</motion.button>
              <motion.button onClick={() => setView('supplier')}
                className={`relative z-10 rounded-sm px-3 py-1 text-[11px] font-bold transition-colors ${view === 'supplier' ? 'text-white' : 'text-[#64748b] hover:text-[#334155]'}`}
                whileTap={{ scale: 0.95 }}>供应商清单</motion.button>
              <motion.div className="absolute z-0 rounded-sm bg-[#5b9bd5]"
                layoutId="toolbar-view-toggle"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                style={{ width: 'calc(50% - 1px)', height: 'calc(100% - 2px)', top: 1, left: view === 'catalog' ? 1 : 'calc(50% + 0.5px)' }} />
            </div>
          </div>

          {/* ━━ ③ 筛选 · 冰川蓝底 ━━ */}
          <div className="flex items-center h-full gap-0 bg-gradient-to-r from-[#eff6ff] to-[#f0f9ff] border-r-2 border-[#93c5fd]/40 flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-1 flex-wrap px-3">
              {([
                ['区域', region, setRegion, REGIONS] as const,
                ['状态', status, setStatus, STATUSES] as const,
                ['来源', source, setSource, SOURCES] as const,
              ]).map(([label, val, setter, options]) => {
                const hasValue = (val as string) !== '全部';
                return (
                  <div key={label} className="flex items-center gap-1.5 group">
                    <span className="text-xs font-semibold text-[#64748b] group-hover:text-[#334155] select-none">{label}</span>
                    <div className="relative">
                      <select value={val as string} onChange={e => setter(e.target.value as never)}
                        className={`h-7 rounded-md border bg-white pl-2 pr-5 text-xs font-semibold outline-none transition appearance-none cursor-pointer ${
                          hasValue ? 'border-[#5b9bd5] text-[#5b9bd5] bg-[#eff6ff]' : 'border-transparent text-[#475569] hover:border-[#cbd5e1] hover:bg-white'
                        }`}
                        style={{ textAlignLast: 'center', textAlign: 'center' as React.CSSProperties['textAlign'] }}>
                        {options.map(v => <option key={v as string} value={v as string}>{v as string}</option>)}
                      </select>
                      <svg className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={hasValue ? '#5b9bd5' : '#94a3b8'} strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6"/></svg>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-0 shrink-0 border-l border-[#bfd4f4]/50 pl-2">
              <button onClick={() => setShowFavoritesOnly(v => !v)}
                  className={`flex items-center h-7 rounded px-2 text-xs font-semibold transition ${
                    showFavoritesOnly ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200' : 'text-[#94a3b8] hover:text-[#5b9bd5] hover:bg-white'
                  }`} title="只看收藏">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill={showFavoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                  收藏
                </button>
                <button onClick={resetFilters}
                  className={`flex items-center h-7 rounded px-2 text-xs font-semibold transition ${
                    (search || category !== '全部' || region !== '全部' || status !== '全部' || source !== '全部' || showFavoritesOnly)
                      ? 'text-[#ef4444] hover:bg-red-50' : 'text-[#cbd5e1] cursor-default'
                  }`} title="重置筛选">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  重置
                </button>
            </div>
          </div>

          {/* ━━ ④ 排序 · 翡翠绿底 ━━ */}
          <div className="flex items-center h-full gap-1.5 px-3 bg-gradient-to-r from-[#ecfdf5] to-[#f0fdf4] border-r-2 border-[#6ee7b7]/40 shrink-0">
            <div className="flex items-center gap-1 h-7 rounded-md bg-[#059669]/8 px-2.5 mr-1 ring-1 ring-[#34d399]/20">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="16" y2="6"/><line x1="4" y1="12" x2="12" y2="12"/><line x1="4" y1="18" x2="8" y2="18"/>
                <polyline points="14 15 18 18 22 12"/>
              </svg>
              <span className="text-xs font-bold text-[#059669] select-none">排序</span>
            </div>
            {([
              ['updatedAt', '时间'],
              ['referencePrice', '价格'],
              ['category', '分类'],
              ['changeRate', '变化'],
            ] as const).map(([col, label]) => {
              const isActive = sort?.col === col;
              const dir = isActive ? sort!.dir : null;
              return (
                <button key={col} onClick={() => toggleSort(col)}
                  className={`flex items-center justify-center gap-0.5 h-7 rounded px-2.5 text-sm font-semibold transition min-w-[4.25rem] ring-1 ${
                    isActive ? 'bg-white text-[#059669] ring-[#34d399]/30 shadow-sm' : 'text-[#64748b] ring-transparent hover:text-[#059669] hover:bg-white'
                  }`}>
                  <span>{label}</span>
                  <span className="inline-flex items-center w-3 h-3">
                    {isActive ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        {dir === 'asc' ? <path d="m18 15-6-6-6 6"/> : <path d="m6 9 6 6 6-6"/>}
                      </svg>
                    ) : null}
                  </span>
                </button>
              );
            })}
            <button onClick={sort ? () => setSort(null) : undefined}
              className={`ml-0.5 text-[11px] transition ${sort ? 'text-[#94a3b8] hover:text-[#ef4444] cursor-pointer' : 'text-transparent cursor-default'}`}
              title={sort ? '取消排序' : ''}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>

          {/* ━━ ⑤ 行动 · 暖橙底 ━━ */}
          <div className="flex items-center h-full gap-1.5 px-2.5 bg-gradient-to-r from-[#fff7ed] to-[#fffbeb] border-r-2 border-[#fdba74]/40 shrink-0">
            <motion.button onClick={() => setBudgetOpen(true)}
              className="relative h-7 rounded bg-[#5b9bd5] px-2.5 text-xs font-bold text-white hover:bg-[#4a89c4] active:scale-95 transition"
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }}>预算清单
              {saveStatus === 'saving' && <span className="ml-1 inline-block h-1.5 w-1.5 animate-spin rounded-full border border-white/30 border-t-white" />}
              <AnimatePresence>{lines.length > 0 && (
                <motion.span key="badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                  className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10px] font-bold text-white">{lines.length}</motion.span>
              )}</AnimatePresence>
            </motion.button>
            <button onClick={openAudit}
              className="flex items-center h-7 rounded border border-[#e5e7eb] bg-white px-2 text-xs font-semibold text-[#64748b] hover:border-[#5b9bd5] hover:text-[#5b9bd5] transition">操作记录</button>
          </div>

          {/* ━━ 密度模块 ━━ */}
          <div className="flex items-center h-full gap-1.5 px-3 bg-gradient-to-r from-[#f8fafc] to-[#f1f5f9] border-r-2 border-[#e2e8f0] shrink-0">
            <button onClick={() => setDensity(d => d === 'compact' ? 'comfortable' : 'compact')}
              className="flex items-center gap-1.5 h-7 rounded-md px-2.5 text-xs font-semibold transition hover:bg-white"
              title={density === 'compact' ? '切换到舒适视图' : '切换到紧凑视图'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={density === 'compact' ? 'text-[#059669]' : 'text-[#64748b]'}>
                {density === 'compact'
                  ? <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>
                  : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>}</svg>
              <span className="text-[#64748b]">{density === 'compact' ? '紧凑' : '舒适'}</span>
            </button>
          </div>

          {/* ━━ ⑥ 操作 · 熏衣草淡紫底 ━━ */}
          <div className="flex items-center h-full gap-1 px-2 bg-gradient-to-r from-[#f5f3ff] to-[#faf5ff] border-r-2 border-[#c4b5fd]/40 shrink-0">
            <AnimatePresence>{selectedIds.size > 0 && (
              <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}
                className="flex items-center gap-1 overflow-hidden">
                <span className="text-[11px] font-semibold text-[#7c3aed] tabular-nums whitespace-nowrap">已选{selectedIds.size}</span>
                <button onClick={batchAddToBudget} className="flex items-center gap-0.5 h-7 rounded bg-[#7c3aed] px-2 text-[11px] font-bold text-white hover:bg-[#6d28d9] active:scale-95 transition">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>加入预算
                </button>
                {selectedIds.size >= 2 && selectedIds.size <= 4 && (
                  <button onClick={() => setCompareOpen(true)} className="flex items-center h-7 rounded border border-[#c4b5fd]/50 bg-white px-1.5 text-[11px] font-bold text-[#7c3aed] hover:bg-[#f5f3ff] active:scale-95 transition">对比</button>
                )}
                <button onClick={clearSelection} className="h-6 rounded px-1 text-[11px] font-semibold text-[#94a3b8] hover:text-[#334155] transition">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l10 10M11 1L1 11"/></svg>
                </button>
              </motion.div>
            )}</AnimatePresence>
            <button onClick={() => setAssistantInitialQuestion(buildAnalysisQuestion())}
              className="flex items-center gap-0.5 h-7 rounded border border-[#bfd4f4] bg-gradient-to-r from-[#eef6ff] to-[#f8faff] px-2.5 text-xs font-bold text-[#5b9bd5] hover:border-[#5b9bd5] hover:from-[#dae9f8] hover:to-[#eef6ff] active:scale-95 transition">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>分析
            </button>
            <button onClick={() => { catalogAsync.retry(); suppliersAsync.retry(); favoritesAsync.retry(); }} disabled={catalogLoading}
              className="flex items-center gap-0.5 h-7 rounded px-1.5 text-[11px] font-semibold text-[#94a3b8] hover:text-[#5b9bd5] hover:bg-white transition disabled:opacity-50" title="刷新">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={catalogLoading ? 'animate-spin' : ''}>
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
            {lastUpdatedAt && (
              <span className="text-[11px] text-[#bcc6d4] tabular-nums" title={`最后更新：${lastUpdatedAt.toLocaleString('zh-CN')}`}>
                {(() => {const d=Math.floor((Date.now()-lastUpdatedAt.getTime())/1000);if(d<60)return'刚刚';if(d<3600)return`${Math.floor(d/60)}分`;if(d<86400)return`${Math.floor(d/3600)}时`;return lastUpdatedAt.toLocaleDateString('zh-CN',{month:'short',day:'numeric'});})()}
              </span>
            )}
            <button onClick={exportCatalog} disabled={exporting === 'catalog'}
              className="flex items-center gap-0.5 h-7 rounded border border-[#e5e7eb] px-2.5 text-xs font-semibold text-[#64748b] hover:border-[#5b9bd5] hover:text-[#5b9bd5] disabled:opacity-50 transition">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Excel
            </button>
          </div>

          {/* ━━ 实时计数 ━━ */}
          <div className="flex items-center h-full border-l-2 border-[#e2e8f0] px-3 shrink-0 bg-[#f8fafc]">
            <span className={`text-sm font-semibold tabular-nums ${filtered.length === 0 ? 'text-[#ef4444]' : 'text-[#475569]'}`}>
              总共 <span className={`text-sm font-black ${filtered.length === 0 ? 'text-[#ef4444]' : 'text-[#5b9bd5]'}`}>{filtered.length}</span> 项
            </span>
          </div>
        </motion.section>
        <LiveRegion>{filtered.length > 0 ? `当前显示 ${filtered.length} 项物资` : '未找到匹配条目'}</LiveRegion>

        <section className="mt-3 grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-xl border border-[#e1e9f4] bg-white p-3.5 shadow-[0_4px_12px_rgba(15,35,65,.03)] lg:sticky lg:top-20 lg:self-start">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-sm font-black text-[#334155]">集中采购目录</h2>
              <motion.span
                className="rounded-md bg-[#f1f5fb] px-1.5 py-0.5 text-[10px] font-bold text-[#5b9bd5] tabular-nums"
                key={filtered.length}
                initial={{ scale: 1.15 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                {filtered.length}
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
                  className="overflow-hidden rounded-2xl border border-[#e1e9f4] bg-white shadow-[0_4px_12px_rgba(15,35,65,.03)]"
                >
                  <div className="flex items-center justify-between border-b border-[#e8eef6] px-5 py-3.5">
                    <div>
                      <h2 className="text-base font-black text-[#334155]">供应商清单</h2>
                      <p className="mt-0.5 text-[11px] text-[#8a96aa]">{suppliersAsync.status === 'loading' ? '加载供应商中…' : `共 ${suppliers.length} 家供应商，点击查看其在目录中的物资`}</p>
                    </div>
                  </div>
                  {suppliersAsync.status === 'error' ? (
                    <InlineError message="供应商加载失败" onRetry={suppliersAsync.retry} />
                  ) : suppliersAsync.status === 'loading' ? (
                    <div className="p-5"><CardGridSkeleton count={6} cols={3} /></div>
                  ) : suppliers.length === 0 ? (
                    <EmptyState icon={<IconBuilding />} title="暂无供应商" description="尚未有供应商纳入集中采购目录" />
                  ) : density === 'compact' ? (
                    <div className="divide-y divide-[#eef3f8]">
                      {suppliers.map(s => (
                        <button
                          key={s.supplier}
                          onClick={() => browseSupplier(s.supplier)}
                          className="flex items-center gap-4 w-full px-5 py-2.5 text-left hover:bg-[#f8fbff] transition group border-l-[3px] border-l-transparent hover:border-l-[#5b9bd5]"
                        >
                          <span className="text-sm font-bold text-[#334155] group-hover:text-[#5b9bd5] min-w-0 flex-1 truncate">{s.supplier}</span>
                          <span className="text-xs text-[#6a7890] shrink-0">{s.supplierType}</span>
                          <span className="text-xs text-[#8a96aa] shrink-0 max-w-[140px] truncate">{s.regions.join(' / ')}</span>
                          <span className="text-xs font-bold tabular-nums text-[#e74c3c] shrink-0">¥{s.avgPrice.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span>
                          <span className="text-xs tabular-nums text-[#8a96aa] shrink-0">{formatPrice(s.minPrice).replace('¥','')}~{formatPrice(s.maxPrice).replace('¥','')}</span>
                          <span className="rounded-md bg-[#f1f5fb] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[#5b9bd5] shrink-0">{s.itemCount}项</span>
                        </button>
                      ))}
                    </div>
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
                        className="group rounded-xl border border-[#e1e9f4] bg-white p-4 text-left shadow-[0_1px_3px_rgba(15,35,65,.03)]"
                        whileHover={{ y: -2, borderColor: 'rgba(91,155,213,.25)', boxShadow: '0 8px 24px rgba(91,155,213,.07)' }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="line-clamp-2 text-sm font-bold text-[#334155] group-hover:text-[#5b9bd5] leading-snug">{s.supplier}</h3>
                          <span className="shrink-0 rounded-md bg-[#f1f5fb] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[#5b9bd5]">{s.itemCount}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-[#8a96aa]">{s.supplierType} · {s.regions.slice(0, 2).join(' / ')}{s.regions.length > 2 ? ` +${s.regions.length - 2}` : ''}</div>
                        <div className="mt-3 flex items-end justify-between">
                          <div><span className="text-base font-black tabular-nums text-[#e74c3c]">¥{s.avgPrice.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span><span className="text-[10px] text-[#8a96aa]"> 均价</span></div>
                          <span className="text-[10px] tabular-nums text-[#8a96aa]">{formatPrice(s.minPrice).replace('¥','')} ~ {formatPrice(s.maxPrice).replace('¥','')}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">{s.categories.slice(0, 4).map(c => <span key={c} title={c} className="rounded-md bg-[#f3f7fc] px-1.5 py-0.5 text-[10px] font-semibold text-[#5a6d8a]">{shortCategory(c)}</span>)}{s.categories.length > 4 && <span className="text-[10px] text-[#8a96aa]">+{s.categories.length - 4}</span>}</div>
                      </motion.button>
                    ))}
                  </motion.div>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
            <section className={`${view === 'supplier' ? 'hidden' : ''} overflow-hidden rounded-2xl border border-[#e1e9f4] bg-white shadow-[0_4px_12px_rgba(15,35,65,.03)]`}>
              <div className="flex items-center justify-between border-b border-[#e8eef6] px-5 py-3.5">
                <div>
                  <h2 className="text-base font-black text-[#334155]">目录清单</h2>
                  <p className="mt-0.5 text-[11px] text-[#8a96aa]">参考价用于预算编制与询价比价，最终以采购文件及成交结果为准。</p>
                </div>
              </div>
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
              <div className={`hidden overflow-x-auto md:block ${density === 'compact' ? '[&_td]:py-1.5 [&_td]:px-2 [&_td]:text-xs [&_th]:py-1.5 [&_th]:px-2' : ''}`}><table className="w-full min-w-[1180px] border-collapse text-center text-sm"><thead className="bg-[#f7faff] text-xs font-bold"><tr><th className="w-10 px-2 py-3"><input type="checkbox" checked={sorted.length > 0 && selectedIds.size === sorted.length} onChange={toggleSelectAll} className="h-3.5 w-3.5 cursor-pointer accent-[#5b9bd5]" aria-label="全选" /></th><th className="px-3 py-3 text-[#5a6d8a]">目录编码 / 物资</th><th className="px-3 py-3 text-[#5a6d8a]">规格型号</th><th className="cursor-pointer select-none px-3 py-3 transition hover:text-[#5b9bd5]" onClick={() => toggleSort('category')}><span className={`inline-flex items-center gap-1 ${sort?.col === 'category' ? 'text-[#5b9bd5]' : ''}`}>分类 {sort?.col === 'category' ? (sort.dir === 'desc' ? '↓' : '↑') : <span className="text-[#bcc6d4]">↕</span>}</span></th><th className="cursor-pointer select-none px-3 py-3 transition hover:text-[#5b9bd5]" onClick={() => toggleSort('referencePrice')}><span className={`inline-flex items-center gap-1 ${sort?.col === 'referencePrice' ? 'text-[#5b9bd5]' : ''}`}>参考价 {sort?.col === 'referencePrice' ? (sort.dir === 'desc' ? '↓' : '↑') : <span className="text-[#bcc6d4]">↕</span>}</span></th><th className="px-3 py-3 text-[#5a6d8a]">价格区间</th><th className="px-3 py-3 text-[#5a6d8a]">供应商</th><th className="px-3 py-3 text-[#5a6d8a]">来源</th><th className="cursor-pointer select-none px-3 py-3 transition hover:text-[#5b9bd5]" onClick={() => toggleSort('changeRate')}><span className={`inline-flex items-center gap-1 ${sort?.col === 'changeRate' ? 'text-[#5b9bd5]' : ''}`}>状态 {sort?.col === 'changeRate' ? (sort.dir === 'desc' ? '↓' : '↑') : <span className="text-[#bcc6d4]">↕</span>}</span></th><th className="px-3 py-3 text-center text-[#5a6d8a]">操作</th></tr></thead><tbody className="divide-y divide-[#eef3f8]"><AnimatePresence mode="popLayout">{sorted.map(item => <motion.tr layout key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} onClick={() => setDetail(item)} className={`cursor-pointer border-l-[3px] border-l-transparent transition hover:border-l-[#5b9bd5] hover:bg-[#f8fbff] active:bg-[#eef3fb] ${density === 'compact' ? 'h-10' : ''}`}><td className="w-10 px-2 py-4" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelectOne(item.id)} className="h-3.5 w-3.5 cursor-pointer accent-[#5b9bd5]" aria-label={`选择 ${item.name}`} /></td><td className="px-3 py-4"><button onClick={() => setDetail(item)} className="text-center"><div className="font-mono text-xs font-bold text-[#5b9bd5]">{item.code}</div><div className="mt-1 font-black text-[#334155] hover:text-[#5b9bd5]">{item.name}</div></button></td><td className="max-w-[190px] px-4 py-4 text-[#344563]" title={item.specification}><div className="truncate">{item.specification}</div></td><td className="px-4 py-4"><span title={item.category} className="rounded-full bg-[#eef3fb] px-2 py-1 text-xs font-bold text-[#5b9bd5]">{shortCategory(item.category)}</span></td><td className="px-4 py-4"><span className="text-base font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#6a7890]">/{item.unit}</span></td><td className="px-4 py-4 text-[#5a6d8a]">{formatPrice(item.priceMin)} - {formatPrice(item.priceMax)}</td><td className="max-w-[180px] px-4 py-4"><div className="truncate font-semibold text-[#334155]" title={item.supplier}>{item.supplier}</div><div className="mt-1 text-xs text-[#6a7890]">{item.supplierType} · {item.region}</div></td><td className="px-4 py-4"><span title={item.priceSource} className={`rounded-full px-2 py-1 text-xs font-bold ${sourceStyles[item.priceSource]}`}>{SOURCE_SHORT[item.priceSource]}</span></td><td className="px-4 py-4"><span title={item.status} className={`rounded-full border px-2 py-1 text-xs font-bold ${statusStyles[item.status]}`}>{STATUS_SHORT[item.status]}</span><div className={`mt-1 text-xs font-bold ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#6a7890]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</div></td><td className="px-4 py-4 text-center"><button onClick={(e) => { e.stopPropagation(); toggleFavorite(item); }} className={`mr-1 text-base align-middle transition hover:scale-110 ${favoriteIds.includes(item.id) ? 'text-amber-400' : 'text-[#c3ccd8]'}`} title={favoriteIds.includes(item.id) ? '取消收藏' : '收藏'}>{favoriteIds.includes(item.id) ? '★' : '☆'}</button><button onClick={() => setDetail(item)} className="mr-2 text-xs font-bold text-[#5b9bd5] hover:underline">详情</button><button onClick={(e) => { e.stopPropagation(); addToBudget(item); }} className="rounded-lg bg-[#5b9bd5] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#4a89c4]">加入预算</button></td></motion.tr>)}</AnimatePresence></tbody></table></div>
              <div className="divide-y divide-[#eef3f8] md:hidden">
              {sorted.map(item => (
                <div key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelectOne(item.id)} className="mt-0.5 h-3.5 w-3.5 accent-[#5b9bd5]" />
                    <button onClick={() => setDetail(item)} className="min-w-0 flex-1 text-left">
                      <div className="font-mono text-xs font-bold text-[#5b9bd5]">{item.code}</div>
                      <div className="mt-0.5 truncate text-sm font-black text-[#334155]">{item.name}</div>
                      <div className="mt-0.5 truncate text-xs text-[#6a7890]">{item.specification}</div>
                    </button>
                    <button onClick={() => toggleFavorite(item)} className={`shrink-0 text-lg ${favoriteIds.includes(item.id) ? 'text-amber-400' : 'text-[#c3ccd8]'}`} title={favoriteIds.includes(item.id) ? '取消收藏' : '收藏'}>{favoriteIds.includes(item.id) ? '★' : '☆'}</button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span title={item.status} className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusStyles[item.status]}`}>{STATUS_SHORT[item.status]}</span>
                    <span className={`text-xs font-bold ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#6a7890]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</span>
                    <span title={item.priceSource} className={`rounded-full px-2 py-0.5 text-xs font-bold ${sourceStyles[item.priceSource]}`}>{SOURCE_SHORT[item.priceSource]}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div><span className="text-lg font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#6a7890]">/{item.unit}</span></div>
                    <button onClick={(e) => { e.stopPropagation(); addToBudget(item); }} className="rounded-lg bg-[#5b9bd5] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#4a89c4]">加入预算</button>
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
                ref={budgetOverlayRef}
                className="absolute inset-0 bg-[#475569]/40 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onBudgetOverlay}
              />
              <motion.div
                ref={budgetTrapRef}
                role="dialog"
                aria-modal="true"
                aria-label="预算清单"
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
                  <select value={currentList?.id ?? ''} onChange={e => switchList(e.target.value)} className="min-w-0 max-w-[55%] truncate rounded-lg border border-[#cdd9ea] bg-white px-2 py-1.5 text-sm font-black text-[#334155] outline-none focus:border-[#5b9bd5]">
                    {lists.map(l => <option key={l.id} value={l.id}>{l.name}{l.status === 'CONVERTED' ? '（已转询价单）' : l.itemCount > 0 ? `（${l.itemCount}项 · ¥${l.totalAmount ?? 0}）` : ''}</option>)}
                  </select>
                  {isConverted && <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">已转询价单</span>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => createList()} title="新建清单" className="rounded-lg border border-[#cdd9ea] px-2 py-1 text-xs font-bold text-[#5b9bd5] hover:bg-[#f3f7fc]">+ 新建</button>
                  <button onClick={renameList} title="重命名" className="rounded-lg border border-[#cdd9ea] px-2 py-1 text-xs font-bold text-[#5a6d8a] hover:bg-[#f3f7fc]">重命名</button>
                  <button onClick={cloneList} title="克隆" className="rounded-lg border border-[#cdd9ea] px-2 py-1 text-xs font-bold text-[#5a6d8a] hover:bg-[#f3f7fc]">克隆</button>
                  <button onClick={removeList} title="删除" className="rounded-lg border border-[#cdd9ea] px-2 py-1 text-xs font-bold text-[#e74c3c] hover:bg-[#fdf2f2]">删除</button>
                  <button onClick={() => setBudgetOpen(false)} className="ml-1 flex h-8 w-8 items-center justify-center rounded-xl text-[#6a7890] hover:bg-[#f3f7fc]">✕</button>
                </div>
              </div>
              <p className="mt-2 text-xs text-[#6a7890]">用于项目预算、采购立项附件和询价前准备 · 自动保存</p>
              {!isConverted && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {['乡镇供水站改造', '管网更新工程', '泵站设备维保', '智慧水务监测'].map(scenario => <button key={scenario} onClick={() => addScenarioBudget(scenario)} className="rounded-full bg-[#eef3fb] px-3 py-1 text-xs font-bold text-[#5b9bd5] hover:bg-[#dfeeff]">AI生成：{scenario}</button>)}
                </div>
              )}
            </div>
            {lines.length > 0 ? (
              <>
                <div className="flex-1 overflow-auto px-6 py-3">
                  <ReorderGroup axis="y" values={lines} onReorder={setLines}>
                  {lines.map(line => (
                    <ReorderItem key={line.id} value={line} className="border-b border-[#eef3f8] py-4">
                      <div className="flex items-center gap-2">
                        {!isConverted && <span className="cursor-grab text-[#bcc6d4] hover:text-[#5a6d8a] select-none" title="拖拽调整顺序">⋮⋮</span>}
                        <div className="min-w-0 flex-1"><div className="flex justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-mono text-xs font-bold text-[#5b9bd5]">{line.code}</div>
                          <div className="mt-1 truncate text-sm font-black text-[#334155]">{line.name}</div>
                          <div className="mt-1 text-xs text-[#6a7890]">{line.specification}</div>
                        </div>
                        {!isConverted && <button onClick={() => removeLine(line)} className="text-sm text-[#c3ccd8] transition hover:text-[#e74c3c]">删除</button>}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isConverted ? (
                            <span className="text-sm font-black text-[#334155]">数量 {line.qty}</span>
                          ) : (
                            <>
                              <QtyButton delta={-1} onChange={() => changeQty(line.id, -1)} />
                              {editingQtyId === line.id ? (
                                <form onSubmit={e => { e.preventDefault(); const v = parseInt(editingQtyValue); if (v > 0) setLines(prev => prev.map(r => r.id === line.id ? {...r, qty: v} : r)); setEditingQtyId(null); }} className="flex">
                                  <input autoFocus value={editingQtyValue} onChange={e => setEditingQtyValue(e.target.value)} onBlur={() => { const v = parseInt(editingQtyValue); if (v > 0) setLines(prev => prev.map(r => r.id === line.id ? {...r, qty: v} : r)); setEditingQtyId(null); }} className="w-10 rounded-md border border-[#5b9bd5] px-1 text-center text-sm font-black outline-none" />
                                </form>
                              ) : (
                                <button onClick={() => { setEditingQtyId(line.id); setEditingQtyValue(String(line.qty)); }} className="w-8 text-center text-sm font-black hover:text-[#5b9bd5]">{line.qty}</button>
                              )}
                              <QtyButton delta={1} onChange={() => changeQty(line.id, 1)} />
                            </>
                          )}
                          <span className="text-xs text-[#6a7890]">{line.unit}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-[#6a7890]">参考小计</div>
                          <div className="font-black text-[#e74c3c]">{formatPrice(line.referencePrice * line.qty)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </ReorderItem>
              ))}
            </ReorderGroup>
          </div>
                <div className="border-t border-[#e5ecf4] px-6 py-4">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm font-bold text-[#5a6d8a]">预算参考合计</span>
                    <span className="text-2xl font-black text-[#e74c3c]">{formatPrice(budgetTotal)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={exportBudget} disabled={exporting === 'budget'} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#5b9bd5] transition hover:bg-[#f3f7fc] disabled:opacity-60">
                      {exporting === 'budget' && <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>}
                      {exporting === 'budget' ? '生成中…' : '导出预算清单'}
                    </button>
                    {isConverted ? (
                      <button onClick={() => setBudgetOpen(false)} className="h-12 rounded-xl bg-emerald-600 text-sm font-bold text-white">已完成，关闭</button>
                    ) : (
                      <button onClick={convertList} className="h-12 rounded-xl bg-[#5b9bd5] text-sm font-bold text-white transition hover:bg-[#4a89c4]">生成询价单</button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className="text-5xl">📑</div>
                <p className="mt-3 text-sm font-bold text-[#6a7890]">{isConverted ? '该清单已转换' : '预算清单为空'}</p>
                {!isConverted && <button onClick={() => setBudgetOpen(false)} className="mt-3 text-sm font-bold text-[#5b9bd5] hover:underline">返回目录选择物资</button>}
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
                ref={detailOverlayRef}
                className="absolute inset-0 bg-[#475569]/40 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onDetailOverlay}
              />
              <motion.div
                ref={detailTrapRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="detail-dialog-title"
                className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white shadow-2xl"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 30 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                drag="x"
                dragConstraints={{ left: 0 }}
                dragElastic={0.1}
                onDragEnd={(_, info) => { if (info.offset.x > 120) setDetail(null); }}
              ><div className="border-b border-[#e5ecf4] bg-[#f8fbff] px-6 py-5"><div className="mb-3 flex items-center justify-between"><span className="font-mono text-xs font-black text-[#5b9bd5]">{detail.code}</span><button onClick={() => toggleFavorite(detail)} className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg transition hover:bg-white ${favoriteIds.includes(detail.id) ? 'text-amber-400' : 'text-[#c3ccd8]'}`} title={favoriteIds.includes(detail.id) ? '取消收藏' : '收藏'}>{favoriteIds.includes(detail.id) ? '★' : '☆'}</button><button onClick={() => setDetail(null)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#6a7890] transition hover:bg-white">✕</button></div><h2 id="detail-dialog-title" className="text-2xl font-black text-[#334155]">{detail.name}</h2><p className="mt-2 text-sm text-[#5a6d8a]">{detail.specification}</p></div><div className="space-y-5 px-6 py-5"><div className="rounded-2xl border border-[#e1e9f4] p-5"><button onClick={() => setPriceOpen(o => !o)} className="mb-3 flex w-full items-center gap-2 text-left text-sm font-black text-[#334155] transition hover:text-[#5b9bd5]"><svg className={`h-3 w-3 shrink-0 text-[#5a6d8a] transition-transform duration-200 ${priceOpen ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>价格信息</button>{priceOpen && <div className="grid gap-4 sm:grid-cols-2"><Info label="当前参考价" value={`${formatPrice(detail.referencePrice)} / ${detail.unit}`} strong /><Info label="价格区间" value={`${formatPrice(detail.priceMin)} - ${formatPrice(detail.priceMax)}`} /><Info label="最近成交价" value={formatPrice(detail.lastDealPrice)} /><Info label="历史采购均价" value={formatPrice(detail.averagePrice)} /><Info label="价格变化" value={`${detail.changeRate > 0 ? '+' : ''}${detail.changeRate}%`} /><Info label="价格状态" value={detail.status} /></div>}</div><div className="rounded-2xl border border-[#e1e9f4] p-5"><button onClick={() => setSupplierOpen(o => !o)} className="mb-3 flex w-full items-center gap-2 text-left text-sm font-black text-[#334155] transition hover:text-[#5b9bd5]"><svg className={`h-3 w-3 shrink-0 text-[#5a6d8a] transition-transform duration-200 ${supplierOpen ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>供应商与适用范围</button>{supplierOpen && <div className="grid gap-4 sm:grid-cols-2"><Info label="供应商" value={detail.supplier} /><Info label="供应商类型" value={detail.supplierType} /><Info label="适用区域" value={detail.region} /><Info label="最小参考采购量" value={detail.minOrder} /><Info label="含税" value={detail.taxIncluded ? '是' : '否'} /><Info label="含运费" value={detail.freightIncluded ? '是' : '否'} /></div>}</div><div className="rounded-2xl border border-[#e1e9f4] p-5"><button onClick={() => setBasisOpen(o => !o)} className="mb-3 flex w-full items-center gap-2 text-left text-sm font-black text-[#334155] transition hover:text-[#5b9bd5]"><svg className={`h-3 w-3 shrink-0 text-[#5a6d8a] transition-transform duration-200 ${basisOpen ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>价格依据</button>{basisOpen && <div className="grid gap-4 sm:grid-cols-2"><Info label="价格来源" value={detail.priceSource} /><Info label="更新时间" value={formatDate(detail.updatedAt)} /><Info label="有效期至" value={formatDate(detail.validUntil)} /><Info label="分类目录" value={`${detail.group} / ${detail.category}`} /></div>}{basisOpen && <p className="mt-4 rounded-xl bg-[#f7faff] p-3 text-sm leading-6 text-[#5a6d8a]">{detail.remark}</p>}</div><div className="rounded-2xl border border-[#e1e9f4] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-black text-[#334155]">价格趋势</div>
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
              <PriceChart points={detailHistory} referencePrice={detail.referencePrice} />
            )}
          </div>
          <div className="rounded-2xl border border-[#bfd4f4] bg-gradient-to-br from-[#f8fbff] to-white p-5"><div className="mb-3 flex items-center justify-between"><div className="text-sm font-black text-[#2c5282]">AI 价格研判</div><button onClick={() => openAssistantWithQuestion(buildDetailPrompt(detail))} className="rounded-full bg-[#5b9bd5] px-3 py-1 text-xs font-black text-white">AI 智能分析</button></div><p className="text-sm leading-6 text-[#5a6d8a]">点击分析后，AI 将结合参考价、价格区间、历史均价、供应商、价格来源和有效期，生成风险结论、询价建议和预算引用说明。</p></div><div className="grid grid-cols-2 gap-3"><button onClick={() => { navigator.clipboard?.writeText(detail.code); toast.success('目录编码已复制'); }} className="h-12 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#5b9bd5] transition hover:bg-[#f3f7fc]">复制目录编码</button><button onClick={() => { addToBudget(detail); setDetail(null); }} className="h-12 rounded-xl bg-[#5b9bd5] text-sm font-bold text-white transition hover:bg-[#4a89c4]">加入预算清单</button></div></div></motion.div></motion.div>)}</AnimatePresence>, document.body)}
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
                ref={auditOverlayRef}
                className="absolute inset-0 bg-[#475569]/40 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onAuditOverlay}
              />
              <motion.div
                ref={auditTrapRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="audit-dialog-title"
                className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                initial={{ opacity: 0, y: 30, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
            <div className="flex items-center justify-between border-b border-[#e5ecf4] px-6 py-4">
              <div><h2 id="audit-dialog-title" className="text-lg font-black text-[#334155]">操作记录</h2><p className="mt-1 text-xs text-[#6a7890]">关键操作审计留痕（生成询价单 / 导出）</p></div>
              <button onClick={() => setAuditOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#6a7890] hover:bg-[#f3f7fc]">✕</button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-3">
              {auditLogs.length === 0 ? (
                <div className="py-16 text-center text-sm text-[#6a7890]">暂无操作记录</div>
              ) : auditLogs.map(log => (
                <div key={log.id} className="border-b border-[#eef3f8] py-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-[#eef3fb] px-2 py-0.5 text-xs font-bold text-[#5b9bd5]">{AUDIT_LABELS[log.action] || log.action}</span>
                    <span className="text-xs text-[#6a7890]">{new Date(log.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[#334155]">{log.target}</p>
                  {log.detail && typeof log.detail === 'object' && Object.keys(log.detail).length > 0 && (
                    <p className="mt-1 text-xs text-[#6a7890]">{Object.entries(log.detail).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
                  )}
                </div>
              ))}
            </div>
            </motion.div></motion.div>)}</AnimatePresence>,
        document.body,
      )}
      {mounted && createPortal(
        <AnimatePresence>
          {successOverlay && (
            <motion.div
              className="fixed inset-0 z-[200] flex items-center justify-center p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div className="absolute inset-0 bg-[#475569]/55 backdrop-blur-md" onClick={() => setSuccessOverlay(null)} />
              <motion.div
                className="relative flex max-w-sm flex-col items-center rounded-3xl bg-white px-8 py-10 text-center shadow-[0_40px_120px_rgba(7,24,52,.35)]"
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.15 }}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100"
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#18a56c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </motion.div>
                <h2 className="mt-5 text-xl font-black text-[#334155]">询价单已生成</h2>
                <p className="mt-2 text-sm text-[#5a6d8a]">采购立项编号</p>
                <p className="mt-1 font-mono text-lg font-black text-[#5b9bd5]">{successOverlay.projectCode}</p>
                <div className="mt-6 flex w-full gap-3">
                  <button onClick={() => setSuccessOverlay(null)} className="flex-1 rounded-xl border border-[#cdd9ea] px-4 py-2.5 text-sm font-bold text-[#5a6d8a] transition hover:bg-[#f3f7fc]">继续编辑清单</button>
                  <a href={portalURL('web')} className="flex-1 rounded-xl bg-[#5b9bd5] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#4a89c4] no-underline">前往采购管理端</a>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
      {mounted && createPortal(
        <AnimatePresence>
          {compareOpen && compareItems.length >= 2 && (
            <motion.div className="fixed inset-0 z-[200] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.div className="absolute inset-0 bg-[#475569]/45 backdrop-blur-md" onClick={() => setCompareOpen(false)} />
              <motion.div
                className="relative max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white shadow-2xl"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e5ecf4] bg-white px-6 py-4">
                  <h2 className="text-lg font-black text-[#334155]">物资对比</h2>
                  <button onClick={() => setCompareOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#6a7890] hover:bg-[#f3f7fc]">✕</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] border-collapse text-sm">
                    <thead className="bg-[#f7faff] text-xs font-bold text-[#5a6d8a]"><tr><th className="sticky left-0 bg-[#f7faff] px-4 py-3 text-left">属性</th>{compareItems.map(item => <th key={item.id} className="px-4 py-3">{item.name}</th>)}</tr></thead>
                    <tbody className="divide-y divide-[#eef3f8]">
                      <CompareRows items={compareItems} />
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-[#e5ecf4] px-6 py-4 text-center">
                  <button onClick={() => { compareItems.forEach(i => addToBudget(i, 1, true)); toast.success(`已加入 ${compareItems.length} 项`); setCompareOpen(false); }} className="rounded-xl bg-[#5b9bd5] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#4a89c4]">全部加入预算清单</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

/** 工具栏指标值 —— 独立组件确保 useCountUp hook 在顶层安全调用 */
function MetricValue({ value, color, warn }: { value: number; color: string; warn?: boolean }) {
  const display = useCountUp(value, { duration: 0.8, spring: true });
  return (
    <motion.span
      className="text-base font-black tabular-nums tracking-tight"
      style={{ fontFamily: "'SF Mono','Menlo','Consolas',monospace", color }}
      animate={warn && value > 0 ? { scale: [1, 1.06, 1] } : {}}
      transition={{ duration: 0.5, repeat: value > 0 ? Infinity : 0, repeatDelay: 3 }}
    >
      {display}
    </motion.span>
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
  return <div><div className="text-xs font-bold text-[#6a7890]">{label}</div><div className={`mt-1 text-sm ${strong ? 'text-xl font-black text-[#e74c3c]' : 'font-semibold text-[#334155]'}`}>{value}</div></div>;
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
      className="group rounded-xl border border-[#e1e9f4] bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(15,35,65,.03)]"
      whileHover={{ y: -2, borderColor: 'rgba(91,155,213,.3)', boxShadow: '0 8px 24px rgba(91,155,213,.08)' }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span title={item.status} className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${statusStyles[item.status]}`}>{STATUS_SHORT[item.status]}</span>
        <span className={`text-[10px] font-bold tabular-nums ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#6a7890]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</span>
      </div>
      <h3 className="line-clamp-1 text-sm font-bold text-[#334155] group-hover:text-[#5b9bd5]">{item.name}</h3>
      <p className="mt-0.5 line-clamp-1 text-[11px] text-[#8a96aa]">{item.specification}</p>
      <div className="mt-2.5 flex items-end justify-between">
        <div><span className="text-lg font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-[10px] text-[#8a96aa]">/{item.unit}</span></div>
        <span className="text-[10px] font-semibold text-[#8a96aa]">{formatDate(item.validUntil)}</span>
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
  const groupCount = section.children.reduce((sum, child) =>
    sum + (child === '全部' ? items.length : items.filter(item => item.category === child || item.group === child).length), 0
  );
  return (
    <div key={section.group}>
      <button
        onClick={() => setCollapsed(c => !c)}
        onKeyDown={e => { if (e.key === 'ArrowRight') setCollapsed(false); else if (e.key === 'ArrowLeft') setCollapsed(true); }}
        aria-expanded={!collapsed}
        className={`mb-1 flex w-full items-center gap-1.5 text-xs font-bold ${hasSearchMatch ? 'text-[#5b9bd5]' : 'text-[#6a7890]'} transition hover:text-[#334155]`}
      >
        <motion.svg
          animate={{ rotate: collapsed ? -90 : 0 }}
          transition={{ duration: 0.2 }}
          className="h-3 w-3 shrink-0"
          viewBox="0 0 12 12" fill="none"
        >
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </motion.svg>
        <span className="flex-1 text-left">{section.group}</span>
        <span className="text-[10px] tabular-nums text-[#bcc6d4] font-medium">{groupCount}</span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="grid gap-0.5 ml-1.5">
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
                      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs font-semibold transition ${
                        active
                          ? 'bg-[#5b9bd5]/10 text-[#5b9bd5] font-bold'
                          : hasMatch ? 'bg-[#eff6ff] text-[#5b9bd5]'
                          : 'text-[#5a6d8a] hover:bg-[#f3f7fc] hover:text-[#334155]'
                      }`}
                    >
                      <span>{child}</span>
                      <span className={`text-xs ${active ? 'text-white/70' : 'text-[#6a7890]'}`}>{count}</span>
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

// ===== 物资对比表行 =====
function CompareRows({ items }: { items: CatalogItem[] }) {
  if (items.length < 2) return null;
  const fp = (n: number) => `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
  const fd = (d: string | null) => d ? d.slice(0, 10) : '长期';
  const minPrice = Math.min(...items.map(i => i.referencePrice));
  return <>
    <tr><td className="sticky left-0 bg-white px-4 py-3 font-bold text-[#5a6d8a]">参考价</td>{items.map(i => <td key={i.id} className="px-4 py-3"><span className={i.referencePrice === minPrice ? 'text-[#18a56c] font-bold' : ''}>{fp(i.referencePrice)}</span></td>)}</tr>
    <tr><td className="sticky left-0 bg-white px-4 py-3 font-bold text-[#5a6d8a]">价格区间</td>{items.map(i => <td key={i.id} className="px-4 py-3">{fp(i.priceMin)}~{fp(i.priceMax)}</td>)}</tr>
    <tr><td className="sticky left-0 bg-white px-4 py-3 font-bold text-[#5a6d8a]">历史均价</td>{items.map(i => <td key={i.id} className="px-4 py-3">{fp(i.averagePrice)}</td>)}</tr>
    <tr><td className="sticky left-0 bg-white px-4 py-3 font-bold text-[#5a6d8a]">供应商</td>{items.map(i => <td key={i.id} className="px-4 py-3">{i.supplier}</td>)}</tr>
    <tr><td className="sticky left-0 bg-white px-4 py-3 font-bold text-[#5a6d8a]">来源</td>{items.map(i => <td key={i.id} className="px-4 py-3">{i.priceSource}</td>)}</tr>
    <tr><td className="sticky left-0 bg-white px-4 py-3 font-bold text-[#5a6d8a]">有效期</td>{items.map(i => <td key={i.id} className="px-4 py-3">{fd(i.validUntil)}</td>)}</tr>
  </>;
}

