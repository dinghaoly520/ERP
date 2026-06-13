'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import PriceChart from './price-chart';

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

const formatDate = (d: string | null) => (d ? d.slice(0, 10) : '长期');
const formatPrice = (price: number) => `¥${price.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

export default function MallPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [region, setRegion] = useState('全部');
  const [status, setStatus] = useState<'全部' | PriceStatus>('全部');
  const [source, setSource] = useState<'全部' | PriceSource>('全部');
  const [lists, setLists] = useState<BudgetListSummary[]>([]);
  const [currentList, setCurrentList] = useState<BudgetListDetail | null>(null);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [detail, setDetail] = useState<CatalogItem | null>(null);
  const [detailHistory, setDetailHistory] = useState<{ recordedAt: string; price: number }[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ username?: string; displayName?: string; role?: string } | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'catalog' | 'supplier'>('catalog');
  const [suppliers, setSuppliers] = useState<SupplierAgg[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

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

  useEffect(() => {
    fetch('/api/catalog', { headers: { 'X-Portal': 'mall' }, credentials: 'include' })
      .then(async r => {
        if (!r.ok) return;
        const data = await r.json().catch(() => null);
        setItems(Array.isArray(data) ? (data as CatalogItem[]) : []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!detail) { setDetailHistory([]); return; }
    fetch(`/api/catalog/${detail.id}/history`, { headers: { 'X-Portal': 'mall' }, credentials: 'include' })
      .then(async r => (r.ok ? await r.json() : []))
      .then(d => setDetailHistory(Array.isArray(d) ? d : []))
      .catch(() => setDetailHistory([]));
  }, [detail]);

  const daysLeft = detail?.validUntil ? Math.max(0, Math.ceil((new Date(detail.validUntil).getTime() - Date.now()) / 86400000)) : null;

  useEffect(() => {
    fetch('/api/catalog/suppliers', { headers: { 'X-Portal': 'mall' }, credentials: 'include' })
      .then(async r => { if (r.ok) setSuppliers(await r.json()); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/catalog/favorites', { headers: { 'X-Portal': 'mall' }, credentials: 'include' })
      .then(async r => { if (r.ok) setFavoriteIds((await r.json()).map((i: any) => i.id)); })
      .catch(() => {});
  }, []);

  const browseSupplier = (name: string) => { setSearch(name); setCategory('全部'); setView('catalog'); };

  const toggleFavorite = async (item: CatalogItem) => {
    const res = await api(`/api/catalog/${item.id}/favorite`, { method: 'POST' });
    if (!res.ok) return;
    const { favorited } = await res.json();
    setFavoriteIds(prev => (favorited ? [...prev, item.id] : prev.filter(id => id !== item.id)));
    toast.success(favorited ? `已收藏：${item.name}` : '已取消收藏');
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

  const getAiAdvice = (item: CatalogItem) => {
    if (item.status === '待复核') return { title: '暂不建议引用', className: 'bg-red-50 text-red-700 border-red-200' };
    if (item.status === '价格波动' || Math.abs(item.changeRate) >= 6) return { title: '建议二次询价', className: 'bg-orange-50 text-orange-700 border-orange-200' };
    if (item.status === '即将过期') return { title: '核价后使用', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { title: '可预算参考', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };

  const buildDetailPrompt = (item: CatalogItem) => `请对目录条目「${item.name}」做价格研判：参考价${formatPrice(item.referencePrice)}/${item.unit}，价格区间${formatPrice(item.priceMin)}-${formatPrice(item.priceMax)}，历史均价${formatPrice(item.averagePrice)}，价格变化${item.changeRate}%，来源${item.priceSource}，状态${item.status}，供应商${item.supplier}。请给出结论、风险点和采购建议。`;

  const askAi = async (message = aiQuestion) => {
    const question = message.trim();
    if (!question) {
      toast.error('请输入需要 AI 分析的问题');
      return;
    }
    setAiOpen(true);
    setAiQuestion(question);
    setAiLoading(true);
    setAiAnswer('');
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          context: {
            totalItems: items.length,
            currentFilters: { category, region, status, source, search },
            riskSummary: aiRiskSummary,
            visibleItems: aiContextItems,
            budget: lines.map(row => ({ code: row.code, name: row.name, qty: row.qty, unit: row.unit, referencePrice: row.referencePrice })),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'AI 调用失败');
      setAiAnswer(data.answer);
    } catch (error) {
      setAiAnswer(error instanceof Error ? error.message : 'AI 调用失败，请稍后重试。');
      toast.error('AI 调用失败');
    } finally {
      setAiLoading(false);
    }
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
    skipNextSave.current = true;
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

  const addToBudget = (item: CatalogItem) => {
    if (isConverted) { toast.error('当前清单已转换为采购立项，请新建或克隆清单后再添加'); return; }
    setLines(prev => {
      const idx = prev.findIndex(row => row.catalogItemId === item.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], qty: next[idx].qty + 1 }; return next; }
      return [...prev, { id: `${item.id}-${Date.now()}`, catalogItemId: item.id, code: item.code, name: item.name, specification: item.specification, unit: item.unit, referencePrice: item.referencePrice, qty: 1 }];
    });
    toast.success(`已加入预算清单：${item.name}`);
  };

  const addScenarioBudget = (scenario: string) => {
    SCENARIO_CODES[scenario]?.forEach(code => {
      const item = items.find(row => row.code === code);
      if (item) addToBudget(item);
    });
    toast.success(`已按「${scenario}」场景加入预算建议`);
  };

  const changeQty = (lineId: string, delta: number) =>
    setLines(prev => prev.flatMap(row => (row.id !== lineId ? [row] : row.qty + delta <= 0 ? [] : [{ ...row, qty: row.qty + delta }])));

  const removeLine = (lineId: string) => setLines(prev => prev.filter(row => row.id !== lineId));

  const budgetTotal = lines.reduce((sum, row) => sum + row.referencePrice * row.qty, 0);

  // 防抖自动保存：跳过载入触发的变更；已转换清单只读
  useEffect(() => {
    if (!currentList || isConverted) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = lines.map(row => ({ catalogItemId: row.catalogItemId, code: row.code, name: row.name, specification: row.specification, unit: row.unit, referencePrice: row.referencePrice, qty: row.qty }));
      const res = await api(`/api/budget/lists/${currentList.id}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: payload }) });
      if (res.ok) refreshLists();
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, currentList, isConverted]);

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
  const registeredName = currentUser?.displayName?.trim() || '注册名称未设置';
  const userInitial = registeredName.slice(0, 1);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Portal': 'mall' }, credentials: 'include' });
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-[#18243a]" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <header className="sticky top-0 z-50 border-b border-[#dce6f3] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-[1680px] items-center justify-between px-6">
          <a href="http://localhost:3006" className="flex items-center gap-3 no-underline">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-11 w-auto object-contain" />
            <span>
              <strong className="block text-xl font-black tracking-[0.12em] text-[#123a6e]" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>四川水发集团</strong>
            </span>
          </a>

          <div className="flex items-center gap-3">
            <button onClick={() => setBudgetOpen(true)} className="relative h-10 rounded-xl bg-[#064ea2] px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(6,78,162,.2)] transition hover:bg-[#043d82]">预算清单{lines.length > 0 && <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e74c3c] px-1 text-xs text-white">{lines.length}</span>}</button>
            <div className="flex items-center gap-2 rounded-xl bg-[#f3f7fc] px-3 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#064ea2] text-xs font-black text-white">{userInitial}</span>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-black text-[#18243a]">{registeredName}</div>
              </div>
            </div>
            <button onClick={handleLogout} className="rounded-xl border border-[#d5e0ef] bg-white px-3 py-2 text-sm font-semibold text-[#5a6d8a] transition hover:border-[#e74c3c] hover:text-[#e74c3c]">退出登录</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-6 py-6">
        <section className="overflow-hidden rounded-[28px] border border-[#dbe6f3] bg-[#063f86] text-white shadow-[0_24px_70px_rgba(6,78,162,.18)]">
          <div className="relative px-8 py-8 lg:px-10">
            <div className="absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,.24),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(24,165,108,.22),transparent_34%)]" />
            <div className="relative w-full">
              <h1 className="mb-3 text-3xl font-black tracking-wide lg:text-4xl">集中采购目录</h1>
              <p className="max-w-2xl text-sm leading-7 text-white/75">统一展示协议价、历史成交价与市场参考价，辅助预算编制、采购立项和询价比价。</p>
              <div className="relative mt-6 w-full">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索物资 / 规格 / 编码 / 供应商" className="h-12 w-full rounded-xl border border-white/20 bg-white/95 pl-11 pr-4 text-sm text-[#18243a] outline-none transition placeholder:text-[#8a96aa] focus:border-white focus:bg-white focus:shadow-[0_0_0_4px_rgba(255,255,255,.18)]" />
                <svg className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5a6d8a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-[#bfd4f4] bg-gradient-to-br from-white to-[#f4f8ff] p-5 shadow-[0_12px_34px_rgba(6,78,162,.07)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-black text-[#123a6e]">智能采购价格助手</h2>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-emerald-50 px-3 py-2"><div className="text-lg font-black text-emerald-700">{aiRiskSummary.safe}</div><div className="text-[11px] font-bold text-emerald-700">可参考</div></div>
              <div className="rounded-xl bg-orange-50 px-3 py-2"><div className="text-lg font-black text-orange-700">{aiRiskSummary.inquiry}</div><div className="text-[11px] font-bold text-orange-700">需询价</div></div>
              <div className="rounded-xl bg-amber-50 px-3 py-2"><div className="text-lg font-black text-amber-700">{aiRiskSummary.expiring}</div><div className="text-[11px] font-bold text-amber-700">将过期</div></div>
              <div className="rounded-xl bg-red-50 px-3 py-2"><div className="text-lg font-black text-red-700">{aiRiskSummary.review}</div><div className="text-[11px] font-bold text-red-700">待复核</div></div>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 lg:flex-row">
            <input value={aiQuestion} onChange={e => setAiQuestion(e.target.value)} placeholder="问 AI：帮我分析当前筛选结果、生成管网更新预算清单、哪些价格需要复核？" className="h-11 flex-1 rounded-xl border border-[#cdd9ea] bg-white px-4 text-sm outline-none focus:border-[#064ea2]" />
            <button onClick={() => askAi()} disabled={aiLoading} className="h-11 rounded-xl bg-[#064ea2] px-5 text-sm font-black text-white transition hover:bg-[#043d82] disabled:opacity-60">{aiLoading ? 'AI 分析中...' : 'AI 分析'}</button>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ['目录物资', stats.total.toLocaleString(), '纳入集团集中采购目录'],
            ['协议供应商', stats.suppliers.toLocaleString(), '已入库或框架协议供应商'],
            ['本月更新', stats.updated.toLocaleString(), '近30天维护价格条目'],
            ['价格预警', stats.alerts.toLocaleString(), '波动、过期或待复核条目'],
          ].map(([label, value, desc], idx) => <div key={label} className="rounded-2xl border border-[#e1e9f4] bg-white p-5 shadow-[0_10px_28px_rgba(15,35,65,.05)]"><div className="text-sm font-bold text-[#5a6d8a]">{label}</div><div className={`mt-2 text-3xl font-black ${idx === 3 ? 'text-[#e67e22]' : 'text-[#064ea2]'}`}>{value}</div><div className="mt-1 text-xs text-[#8a96aa]">{desc}</div></div>)}
        </section>

        <section className="mt-5 rounded-2xl border border-[#e1e9f4] bg-white p-4 shadow-[0_10px_28px_rgba(15,35,65,.04)]">
          <div className="grid gap-3 md:grid-cols-4">
            <select value={region} onChange={e => setRegion(e.target.value)} className="h-11 rounded-xl border border-[#cdd9ea] bg-white px-3 text-sm outline-none focus:border-[#064ea2]">{REGIONS.map(v => <option key={v}>{v}</option>)}</select>
            <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="h-11 rounded-xl border border-[#cdd9ea] bg-white px-3 text-sm outline-none focus:border-[#064ea2]">{STATUSES.map(v => <option key={v}>{v}</option>)}</select>
            <select value={source} onChange={e => setSource(e.target.value as typeof source)} className="h-11 rounded-xl border border-[#cdd9ea] bg-white px-3 text-sm outline-none focus:border-[#064ea2]">{SOURCES.map(v => <option key={v}>{v}</option>)}</select>
            <button onClick={() => { setSearch(''); setCategory('全部'); setRegion('全部'); setStatus('全部'); setSource('全部'); }} className="h-11 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#5a6d8a] transition hover:border-[#064ea2] hover:text-[#064ea2]">重置筛选</button>
          </div>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-[#e1e9f4] bg-white p-4 shadow-[0_10px_28px_rgba(15,35,65,.04)] lg:sticky lg:top-21 lg:self-start">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-black text-[#18243a]">集中采购目录</h2><span className="rounded-full bg-[#eef3fb] px-2 py-0.5 text-xs font-bold text-[#064ea2]">{filtered.length}项</span></div>
            <div className="space-y-3">{DIRECTORY.map(section => <div key={section.group}><div className="mb-1 text-xs font-bold text-[#8a96aa]">{section.group}</div><div className="grid gap-1">{section.children.map(child => <button key={child} onClick={() => setCategory(child)} className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${category === child ? 'bg-[#064ea2] text-white shadow-[0_8px_18px_rgba(6,78,162,.2)]' : 'text-[#344563] hover:bg-[#f3f7fc] hover:text-[#064ea2]'}`}><span>{child}</span><span className={`text-xs ${category === child ? 'text-white/70' : 'text-[#8a96aa]'}`}>{child === '全部' ? items.length : items.filter(item => item.category === child || item.group === child).length}</span></button>)}</div></div>)}</div>
          </aside>

          <div className="min-w-0 space-y-5">
            <section className="grid gap-4 xl:grid-cols-4">{focusItems.map(item => <button key={item.id} onClick={() => setDetail(item)} className="group rounded-2xl border border-[#e1e9f4] bg-white p-4 text-left shadow-[0_10px_28px_rgba(15,35,65,.04)] transition hover:-translate-y-0.5 hover:border-[#064ea2]/30 hover:shadow-[0_18px_42px_rgba(6,78,162,.10)]"><div className="mb-3 flex items-center justify-between gap-2"><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusStyles[item.status]}`}>{item.status}</span><span className={`text-xs font-black ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#8a96aa]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</span></div><h3 className="line-clamp-1 text-sm font-black text-[#18243a] group-hover:text-[#064ea2]">{item.name}</h3><p className="mt-1 line-clamp-1 text-xs text-[#8a96aa]">{item.specification}</p><div className="mt-3 flex items-end justify-between"><div><span className="text-xl font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#8a96aa]">/{item.unit}</span></div><span className="text-xs font-semibold text-[#5a6d8a]">{formatDate(item.validUntil)}</span></div></button>)}</section>

            {view === 'supplier' && (
              <section className="overflow-hidden rounded-2xl border border-[#e1e9f4] bg-white shadow-[0_10px_28px_rgba(15,35,65,.05)]">
                <div className="border-b border-[#e8eef6] px-5 py-4"><h2 className="text-lg font-black text-[#18243a]">供应商目录</h2><p className="mt-1 text-xs text-[#8a96aa]">共 {suppliers.length} 家供应商，点击查看其在目录中的物资</p></div>
                <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
                  {suppliers.map(s => (
                    <button key={s.supplier} onClick={() => browseSupplier(s.supplier)} className="group rounded-2xl border border-[#e1e9f4] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#064ea2]/30 hover:shadow-[0_18px_42px_rgba(6,78,162,.10)]">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="line-clamp-2 text-sm font-black text-[#18243a] group-hover:text-[#064ea2]">{s.supplier}</h3>
                        <span className="shrink-0 rounded-full bg-[#eef3fb] px-2 py-0.5 text-xs font-bold text-[#064ea2]">{s.itemCount}项</span>
                      </div>
                      <div className="mt-1 text-xs text-[#8a96aa]">{s.supplierType} · {s.regions.join(' / ')}</div>
                      <div className="mt-3 flex items-end justify-between">
                        <div><span className="text-lg font-black text-[#e74c3c]">¥{s.avgPrice.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span><span className="text-xs text-[#8a96aa]"> 均价</span></div>
                        <span className="text-xs text-[#8a96aa]">{formatPrice(s.minPrice)} ~ {formatPrice(s.maxPrice)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">{s.categories.slice(0, 4).map(c => <span key={c} className="rounded bg-[#f3f7fc] px-1.5 py-0.5 text-[10px] font-bold text-[#5a6d8a]">{c}</span>)}{s.categories.length > 4 && <span className="text-[10px] text-[#8a96aa]">+{s.categories.length - 4}</span>}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section className={`${view === 'supplier' ? 'hidden' : ''} overflow-hidden rounded-2xl border border-[#e1e9f4] bg-white shadow-[0_10px_28px_rgba(15,35,65,.05)]`}>
              <div className="flex items-center justify-between border-b border-[#e8eef6] px-5 py-4"><div><h2 className="text-lg font-black text-[#18243a]">目录清单</h2><p className="mt-1 text-xs text-[#8a96aa]">参考价用于预算编制与询价比价，最终采购价格以采购文件及成交结果为准。</p></div><div className="flex items-center gap-3">
              <button onClick={() => setShowFavoritesOnly(v => !v)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${showFavoritesOnly ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-[#cdd9ea] text-[#5a6d8a] hover:bg-[#f3f7fc]'}`}>★ 我的收藏{favoriteIds.length > 0 ? ` (${favoriteIds.length})` : ''}</button>
              <div className="flex items-center gap-1 rounded-xl border border-[#cdd9ea] p-1">
                <button onClick={() => setView('catalog')} className={`rounded-lg px-3 py-1 text-xs font-bold transition ${view === 'catalog' ? 'bg-[#064ea2] text-white' : 'text-[#5a6d8a] hover:text-[#064ea2]'}`}>目录视图</button>
                <button onClick={() => setView('supplier')} className={`rounded-lg px-3 py-1 text-xs font-bold transition ${view === 'supplier' ? 'bg-[#064ea2] text-white' : 'text-[#5a6d8a] hover:text-[#064ea2]'}`}>供应商视图</button>
              </div>
              <button onClick={() => toast.success('价格清单导出功能已预留，接入后端后生成 Excel 文件')} className="hidden rounded-xl border border-[#cdd9ea] px-4 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc] md:block">导出价格清单</button>
            </div></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[1180px] border-collapse text-sm"><thead className="bg-[#f7faff] text-xs font-bold text-[#5a6d8a]"><tr><th className="px-4 py-3 text-left">目录编码 / 物资</th><th className="px-4 py-3 text-left">规格型号</th><th className="px-4 py-3 text-left">分类</th><th className="px-4 py-3 text-right">参考价</th><th className="px-4 py-3 text-left">价格区间</th><th className="px-4 py-3 text-left">供应商</th><th className="px-4 py-3 text-left">来源</th><th className="px-4 py-3 text-left">状态</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-[#eef3f8]">{loading ? (<tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-[#8a96aa]">加载采购目录中…</td></tr>) : filtered.map(item => <tr key={item.id} className="transition hover:bg-[#f8fbff]"><td className="px-4 py-4"><button onClick={() => setDetail(item)} className="text-left"><div className="font-mono text-xs font-bold text-[#064ea2]">{item.code}</div><div className="mt-1 font-black text-[#18243a] hover:text-[#064ea2]">{item.name}</div></button></td><td className="max-w-[190px] px-4 py-4 text-[#344563]">{item.specification}</td><td className="px-4 py-4"><span className="rounded-full bg-[#eef3fb] px-2 py-1 text-xs font-bold text-[#064ea2]">{item.category}</span></td><td className="px-4 py-4 text-right"><span className="text-base font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#8a96aa]">/{item.unit}</span></td><td className="px-4 py-4 text-[#5a6d8a]">{formatPrice(item.priceMin)} - {formatPrice(item.priceMax)}</td><td className="max-w-[180px] px-4 py-4"><div className="truncate font-semibold text-[#18243a]">{item.supplier}</div><div className="mt-1 text-xs text-[#8a96aa]">{item.supplierType} · {item.region}</div></td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-xs font-bold ${sourceStyles[item.priceSource]}`}>{item.priceSource}</span></td><td className="px-4 py-4"><span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusStyles[item.status]}`}>{item.status}</span><div className={`mt-1 text-xs font-bold ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#8a96aa]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</div></td><td className="px-4 py-4 text-right"><button onClick={() => toggleFavorite(item)} className={`mr-1 text-base align-middle transition hover:scale-110 ${favoriteIds.includes(item.id) ? 'text-amber-400' : 'text-[#c3ccd8]'}`} title={favoriteIds.includes(item.id) ? '取消收藏' : '收藏'}>{favoriteIds.includes(item.id) ? '★' : '☆'}</button><button onClick={() => setDetail(item)} className="mr-2 text-xs font-bold text-[#064ea2] hover:underline">详情</button><button onClick={() => addToBudget(item)} className="rounded-lg bg-[#064ea2] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#043d82]">加入预算</button></td></tr>)}</tbody></table></div>
              {!loading && filtered.length === 0 && <div className="px-6 py-16 text-center"><div className="text-5xl">📋</div><h3 className="mt-3 text-lg font-black text-[#18243a]">未找到匹配的目录条目</h3><p className="mt-1 text-sm text-[#8a96aa]">请调整关键词、分类、区域或价格状态后重试。</p></div>}
            </section>
          </div>
        </section>
      </main>

      {budgetOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div className="absolute inset-0 bg-[#0f1f35]/35 backdrop-blur-sm" onClick={() => setBudgetOpen(false)} />
          <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
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
                        {!isConverted && <button onClick={() => removeLine(line.id)} className="text-sm text-[#c3ccd8] transition hover:text-[#e74c3c]">删除</button>}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isConverted ? (
                            <span className="text-sm font-black text-[#18243a]">数量 {line.qty}</span>
                          ) : (
                            <>
                              <button onClick={() => changeQty(line.id, -1)} className="h-7 w-7 rounded-lg bg-[#f0f3f8] font-bold text-[#5a6d8a]">−</button>
                              <span className="w-8 text-center text-sm font-black">{line.qty}</span>
                              <button onClick={() => changeQty(line.id, 1)} className="h-7 w-7 rounded-lg bg-[#f0f3f8] font-bold text-[#5a6d8a]">+</button>
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
                    <button onClick={() => toast.success('预算清单导出功能将在后续版本接入')} className="h-11 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc]">导出预算清单</button>
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
          </div>
        </div>
      )}

      {aiOpen && <div className="fixed bottom-6 right-6 z-[120] w-[min(460px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-[#bfd4f4] bg-white shadow-[0_22px_70px_rgba(6,78,162,.22)]"><div className="flex items-center justify-between bg-[#064ea2] px-5 py-4 text-white"><div><div className="text-sm font-black">DeepSeek AI 价格助手</div><div className="text-xs text-white/70">采购价格研判 / 预算建议 / 风险说明</div></div><button onClick={() => setAiOpen(false)} className="rounded-lg px-2 py-1 text-white/80 hover:bg-white/10">✕</button></div><div className="max-h-[420px] overflow-auto p-5"><textarea value={aiQuestion} onChange={e => setAiQuestion(e.target.value)} className="min-h-20 w-full rounded-xl border border-[#cdd9ea] p-3 text-sm outline-none focus:border-[#064ea2]" placeholder="输入你的采购问题..." /><button onClick={() => askAi()} disabled={aiLoading} className="mt-3 h-10 w-full rounded-xl bg-[#064ea2] text-sm font-black text-white disabled:opacity-60">{aiLoading ? 'DeepSeek 分析中...' : '发送给 AI'}</button><div className="mt-4 max-h-[300px] overflow-auto rounded-xl bg-[#f7faff] p-4 text-sm leading-7 text-[#344563]">{aiLoading ? <div className="flex items-center gap-2 text-[#5a6d8a]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#064ea2]" />正在调用 DeepSeek，请稍候...</div> : aiAnswer ? <AiMarkdown content={aiAnswer} /> : <div className="text-[#8a96aa]">可以询问：哪些价格需要复核？帮我生成管网更新预算清单；当前筛选结果有哪些价格风险？</div>}</div></div></div>}

      {detail && <div className="fixed inset-0 z-[110] flex justify-end"><div className="absolute inset-0 bg-[#0f1f35]/35 backdrop-blur-sm" onClick={() => setDetail(null)} /><div className="relative h-full w-full max-w-2xl overflow-auto bg-white shadow-2xl"><div className="border-b border-[#e5ecf4] bg-[#f8fbff] px-6 py-5"><div className="mb-3 flex items-center justify-between"><span className="font-mono text-xs font-black text-[#064ea2]">{detail.code}</span><button onClick={() => toggleFavorite(detail)} className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg transition hover:bg-white ${favoriteIds.includes(detail.id) ? 'text-amber-400' : 'text-[#c3ccd8]'}`} title={favoriteIds.includes(detail.id) ? '取消收藏' : '收藏'}>{favoriteIds.includes(detail.id) ? '★' : '☆'}</button><button onClick={() => setDetail(null)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a96aa] transition hover:bg-white">✕</button></div><h2 className="text-2xl font-black text-[#18243a]">{detail.name}</h2><p className="mt-2 text-sm text-[#5a6d8a]">{detail.specification}</p></div><div className="space-y-5 px-6 py-5"><div className="rounded-2xl border border-[#e1e9f4] p-5"><div className="mb-3 text-sm font-black text-[#18243a]">价格信息</div><div className="grid gap-4 sm:grid-cols-2"><Info label="当前参考价" value={`${formatPrice(detail.referencePrice)} / ${detail.unit}`} strong /><Info label="价格区间" value={`${formatPrice(detail.priceMin)} - ${formatPrice(detail.priceMax)}`} /><Info label="最近成交价" value={formatPrice(detail.lastDealPrice)} /><Info label="历史采购均价" value={formatPrice(detail.averagePrice)} /><Info label="价格变化" value={`${detail.changeRate > 0 ? '+' : ''}${detail.changeRate}%`} /><Info label="价格状态" value={detail.status} /></div></div><div className="rounded-2xl border border-[#e1e9f4] p-5"><div className="mb-3 text-sm font-black text-[#18243a]">供应商与适用范围</div><div className="grid gap-4 sm:grid-cols-2"><Info label="供应商" value={detail.supplier} /><Info label="供应商类型" value={detail.supplierType} /><Info label="适用区域" value={detail.region} /><Info label="最小参考采购量" value={detail.minOrder} /><Info label="含税" value={detail.taxIncluded ? '是' : '否'} /><Info label="含运费" value={detail.freightIncluded ? '是' : '否'} /></div></div><div className="rounded-2xl border border-[#e1e9f4] p-5"><div className="mb-3 text-sm font-black text-[#18243a]">价格依据</div><div className="grid gap-4 sm:grid-cols-2"><Info label="价格来源" value={detail.priceSource} /><Info label="更新时间" value={formatDate(detail.updatedAt)} /><Info label="有效期至" value={formatDate(detail.validUntil)} /><Info label="分类目录" value={`${detail.group} / ${detail.category}`} /></div><p className="mt-4 rounded-xl bg-[#f7faff] p-3 text-sm leading-6 text-[#5a6d8a]">{detail.remark}</p></div><div className="rounded-2xl border border-[#e1e9f4] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-black text-[#18243a]">价格趋势</div>
              {daysLeft !== null && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${daysLeft > 60 ? 'bg-emerald-50 text-emerald-700' : daysLeft > 30 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{daysLeft > 30 ? '剩余有效期' : '即将过期'} {daysLeft} 天</span>}
            </div>
            <PriceChart points={detailHistory} />
          </div>
          <div className="rounded-2xl border border-[#bfd4f4] bg-gradient-to-br from-[#f8fbff] to-white p-5"><div className="mb-3 flex items-center justify-between"><div className="text-sm font-black text-[#123a6e]">AI 价格研判</div><button onClick={() => askAi(buildDetailPrompt(detail))} className="rounded-full bg-[#064ea2] px-3 py-1 text-xs font-black text-white">调用 DeepSeek 分析</button></div><p className="text-sm leading-6 text-[#5a6d8a]">点击分析后，AI 将结合参考价、价格区间、历史均价、供应商、价格来源和有效期，生成风险结论、询价建议和预算引用说明。</p></div><div className="grid grid-cols-2 gap-3"><button onClick={() => { navigator.clipboard?.writeText(detail.code); toast.success('目录编码已复制'); }} className="h-11 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc]">复制目录编码</button><button onClick={() => { addToBudget(detail); setDetail(null); }} className="h-11 rounded-xl bg-[#064ea2] text-sm font-bold text-white transition hover:bg-[#043d82]">加入预算清单</button></div></div></div></div>}
    </div>
  );
}

function AiMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let tableBuffer: string[] = [];
  let listBuffer: string[] = [];

  const inline = (text: string) => text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^[-*]\s+/, '')
    .trim();

  const flushList = () => {
    if (!listBuffer.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="my-3 space-y-1.5 rounded-xl bg-white/70 p-3 text-sm text-[#344563]">
        {listBuffer.map((item, idx) => <li key={idx} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#064ea2]" /><span>{inline(item)}</span></li>)}
      </ul>,
    );
    listBuffer = [];
  };

  const flushTable = () => {
    if (tableBuffer.length < 2) {
      tableBuffer = [];
      return;
    }
    const rows = tableBuffer
      .filter(row => !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row))
      .map(row => row.split('|').map(cell => inline(cell)).filter(Boolean));
    const [head, ...body] = rows;
    blocks.push(
      <div key={`table-${blocks.length}`} className="my-4 overflow-x-auto rounded-xl border border-[#dfe8f5] bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-[#eef5ff] text-[#123a6e]">
            <tr>{head.map((cell, idx) => <th key={idx} className="whitespace-nowrap px-3 py-2 font-black">{cell}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[#edf2f8]">
            {body.map((row, idx) => <tr key={idx}>{row.map((cell, cellIdx) => <td key={cellIdx} className="max-w-[220px] px-3 py-2 align-top text-[#344563]">{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </div>,
    );
    tableBuffer = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      flushTable();
      return;
    }
    if (trimmed.startsWith('|')) {
      flushList();
      tableBuffer.push(trimmed);
      return;
    }
    flushTable();
    if (/^[-*]\s+/.test(trimmed)) {
      listBuffer.push(trimmed);
      return;
    }
    flushList();
    if (/^#{1,4}\s+/.test(trimmed)) {
      blocks.push(<h3 key={idx} className="mt-4 mb-2 border-l-4 border-[#064ea2] pl-3 text-base font-black text-[#123a6e]">{inline(trimmed.replace(/^#{1,4}\s+/, ''))}</h3>);
      return;
    }
    if (/^---+$/.test(trimmed)) return;
    blocks.push(<p key={idx} className="my-2 text-sm leading-7 text-[#344563]">{inline(trimmed)}</p>);
  });

  flushList();
  flushTable();
  return <div>{blocks}</div>;
}

function Info({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><div className="text-xs font-bold text-[#8a96aa]">{label}</div><div className={`mt-1 text-sm ${strong ? 'text-xl font-black text-[#e74c3c]' : 'font-semibold text-[#18243a]'}`}>{value}</div></div>;
}
