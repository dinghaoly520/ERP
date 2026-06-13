'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

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
  validUntil: string;
  status: PriceStatus;
  changeRate: number;
  minOrder: string;
  remark: string;
}

interface BudgetItem { item: CatalogItem; qty: number; }

const CATALOG_ITEMS: CatalogItem[] = [
  { id: '1', code: 'CGML-GC-STEEL-001', name: 'Q235B 热轧带钢', specification: 'δ=6mm，宽度1250mm', category: '钢材', group: '工程材料', unit: '吨', referencePrice: 4280, priceMin: 4150, priceMax: 4360, lastDealPrice: 4210, averagePrice: 4245, supplier: '攀钢集团成都钢钒有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-01', validUntil: '2026-09-30', status: '有效', changeRate: -2.3, minOrder: '1吨', remark: '适用于输配水工程钢结构、临建及通用工程材料预算参考。' },
  { id: '2', code: 'CGML-GC-CEMENT-002', name: 'P.O42.5 普通硅酸盐水泥', specification: '袋装/散装，强度等级42.5', category: '水泥', group: '工程材料', unit: '吨', referencePrice: 380, priceMin: 365, priceMax: 398, lastDealPrice: 376, averagePrice: 382, supplier: '四川峨胜水泥集团股份有限公司', supplierType: '协议供应商', priceSource: '历史成交价', region: '乐山', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-28', validUntil: '2026-08-31', status: '有效', changeRate: 1.6, minOrder: '5吨', remark: '水利土建及附属工程常用材料，价格受运输半径影响较大。' },
  { id: '3', code: 'CGML-GC-PIPE-003', name: 'HDPE 双壁波纹管', specification: 'DN400，SN8，环刚度≥8kN/㎡', category: '管材', group: '工程材料', unit: '米', referencePrice: 128, priceMin: 118, priceMax: 139, lastDealPrice: 126, averagePrice: 129, supplier: '四川川塑管业有限公司', supplierType: '入库供应商', priceSource: '市场询价', region: '德阳', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-05', validUntil: '2026-07-15', status: '即将过期', changeRate: 3.8, minOrder: '50米', remark: '雨污分流、排水管网项目常用规格，建议采购前复核运距。' },
  { id: '4', code: 'CGML-SB-PUMP-004', name: '潜水排污泵', specification: '15kW，流量100m³/h，扬程18m', category: '水泵', group: '机电设备', unit: '台', referencePrice: 8600, priceMin: 8200, priceMax: 9100, lastDealPrice: 8750, averagePrice: 8680, supplier: '格兰富水泵（上海）有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-03', validUntil: '2026-12-31', status: '有效', changeRate: -0.8, minOrder: '1台', remark: '泵站改造、排涝工程常用设备，含标准控制附件。' },
  { id: '5', code: 'CGML-GC-WATERPROOF-005', name: '橡胶止水带', specification: '350×8mm，中埋式', category: '防水材料', group: '工程材料', unit: '米', referencePrice: 35, priceMin: 31, priceMax: 39, lastDealPrice: 34, averagePrice: 35.5, supplier: '衡水恒力工程橡胶有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '泸州', taxIncluded: true, freightIncluded: false, updatedAt: '2026-04-18', validUntil: '2026-06-30', status: '即将过期', changeRate: 0.4, minOrder: '20米', remark: '水工建筑物伸缩缝、施工缝防水材料。' },
  { id: '6', code: 'CGML-XX-METER-006', name: '电磁流量计', specification: 'DN200，4-20mA + RS485，IP68', category: '仪器仪表', group: '信息化设备', unit: '台', referencePrice: 12500, priceMin: 11600, priceMax: 13800, lastDealPrice: 12900, averagePrice: 12180, supplier: '上海威尔泰工业自动化股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-07', validUntil: '2026-10-31', status: '价格波动', changeRate: 8.5, minOrder: '1台', remark: '智慧水务、计量监测项目高频采购设备，近期芯片模块价格上涨。' },
  { id: '7', code: 'CGML-GC-GEO-007', name: '短纤针刺土工布', specification: '200g/㎡，幅宽4m', category: '土工材料', group: '工程材料', unit: '㎡', referencePrice: 3.8, priceMin: 3.55, priceMax: 4.2, lastDealPrice: 3.75, averagePrice: 3.82, supplier: '山东宏祥新材料股份有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '宜宾', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-20', validUntil: '2026-09-20', status: '有效', changeRate: -1.1, minOrder: '200㎡', remark: '堤防、渠道、防渗工程常用材料。' },
  { id: '8', code: 'CGML-TY-LABOR-008', name: '安全防护用品套装', specification: '安全帽/反光背心/护目镜/手套', category: '劳保用品', group: '劳保及通用物资', unit: '套', referencePrice: 260, priceMin: 238, priceMax: 286, lastDealPrice: 252, averagePrice: 258, supplier: '霍尼韦尔安全防护设备有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-02', validUntil: '2026-12-31', status: '有效', changeRate: 0, minOrder: '10套', remark: '集团通用劳保用品，适用于施工现场人员基础配置。' },
  { id: '9', code: 'CGML-SB-GEN-009', name: '柴油发电机组', specification: '200kW，静音箱式，国三排放', category: '发电机组', group: '机电设备', unit: '台', referencePrice: 68000, priceMin: 64500, priceMax: 72500, lastDealPrice: 67200, averagePrice: 66150, supplier: '康明斯动力技术有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '绵阳', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-16', validUntil: '2026-06-20', status: '待复核', changeRate: 6.2, minOrder: '1台', remark: '应急供电设备，建议采购前组织二次询价。' },
  { id: '10', code: 'CGML-GC-VALVE-010', name: '软密封蝶阀', specification: 'DN300，PN1.0，法兰连接', category: '阀门', group: '机电设备', unit: '台', referencePrice: 2450, priceMin: 2260, priceMax: 2680, lastDealPrice: 2410, averagePrice: 2475, supplier: '天津塘沽瓦特斯阀门有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-04', validUntil: '2026-11-30', status: '有效', changeRate: -1.7, minOrder: '1台', remark: '输配水管线、泵站工程通用阀门。' },
  { id: '11', code: 'CGML-SB-ELEC-011', name: '变频控制柜', specification: '30kW，含变频器、软启及保护模块', category: '电气设备', group: '机电设备', unit: '台', referencePrice: 15800, priceMin: 14900, priceMax: 16980, lastDealPrice: 16200, averagePrice: 15660, supplier: '西门子电气传动有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-30', validUntil: '2026-10-31', status: '价格波动', changeRate: 7.1, minOrder: '1台', remark: '泵站自动化改造设备，近期电子元件价格存在波动。' },
  { id: '12', code: 'CGML-GC-CABLE-012', name: '电力电缆', specification: 'YJV 0.6/1kV 3×150+1×70', category: '电气设备', group: '机电设备', unit: '米', referencePrice: 520, priceMin: 498, priceMax: 548, lastDealPrice: 514, averagePrice: 523, supplier: '四川蜀龙电缆有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-06', validUntil: '2026-08-31', status: '有效', changeRate: 2.4, minOrder: '50米', remark: '铜价影响明显，预算编制建议预留价格浮动空间。' },
];

const DIRECTORY = [
  { group: '全部目录', children: ['全部'] },
  { group: '工程材料', children: ['钢材', '水泥', '管材', '防水材料', '土工材料'] },
  { group: '机电设备', children: ['水泵', '阀门', '电气设备', '发电机组'] },
  { group: '信息化设备', children: ['仪器仪表'] },
  { group: '劳保及通用物资', children: ['劳保用品'] },
];

const REGIONS = ['全部', '全省', '成都', '德阳', '绵阳', '乐山', '泸州', '宜宾'];
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

const formatPrice = (price: number) => `¥${price.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

export default function MallPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [region, setRegion] = useState('全部');
  const [status, setStatus] = useState<'全部' | PriceStatus>('全部');
  const [source, setSource] = useState<'全部' | PriceSource>('全部');
  const [budget, setBudget] = useState<BudgetItem[]>([]);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [detail, setDetail] = useState<CatalogItem | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { headers: { 'X-Portal': 'mall' }, credentials: 'include' })
      .then(r => { if (!r.ok) router.push('/login'); })
      .catch(() => router.push('/login'));
  }, [router]);

  const filtered = useMemo(() => CATALOG_ITEMS.filter(item => {
    const keyword = search.trim();
    const matchSearch = !keyword || [item.code, item.name, item.specification, item.category, item.supplier].some(v => v.includes(keyword));
    const matchCategory = category === '全部' || item.category === category || item.group === category;
    const matchRegion = region === '全部' || item.region === region || item.region === '全省';
    const matchStatus = status === '全部' || item.status === status;
    const matchSource = source === '全部' || item.priceSource === source;
    return matchSearch && matchCategory && matchRegion && matchStatus && matchSource;
  }), [category, region, search, source, status]);

  const stats = useMemo(() => ({
    total: CATALOG_ITEMS.length,
    suppliers: new Set(CATALOG_ITEMS.map(item => item.supplier)).size,
    updated: CATALOG_ITEMS.filter(item => item.updatedAt >= '2026-06-01').length,
    alerts: CATALOG_ITEMS.filter(item => item.status !== '有效').length,
  }), []);

  const focusItems = useMemo(() => CATALOG_ITEMS.filter(item => item.status !== '有效' || Math.abs(item.changeRate) >= 6).slice(0, 4), []);

  const addToBudget = (item: CatalogItem) => {
    setBudget(prev => {
      const idx = prev.findIndex(row => row.item.id === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { item, qty: 1 }];
    });
    toast.success(`已加入预算清单：${item.name}`);
  };

  const changeQty = (id: string, delta: number) => {
    setBudget(prev => prev.map(row => {
      if (row.item.id !== id) return row;
      const qty = row.qty + delta;
      return qty <= 0 ? null : { ...row, qty };
    }).filter(Boolean) as BudgetItem[]);
  };

  const removeBudgetItem = (id: string) => setBudget(prev => prev.filter(row => row.item.id !== id));
  const budgetTotal = budget.reduce((sum, row) => sum + row.item.referencePrice * row.qty, 0);

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-[#18243a]" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <header className="sticky top-0 z-50 border-b border-[#dce6f3] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <a href="http://localhost:3006" className="flex items-center gap-3 no-underline">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#064ea2] text-sm font-black text-white shadow-[0_8px_18px_rgba(6,78,162,.22)]">水</span>
              <span className="leading-tight">
                <strong className="block text-base font-black text-[#123a6e]">集中采购价格目录</strong>
                <small className="block text-[10px] font-semibold uppercase tracking-[.16em] text-[#8a96aa]">Sichuan Water Procurement Catalog</small>
              </span>
            </a>
            <a href="http://localhost:3006" className="hidden text-sm font-semibold text-[#5a6d8a] transition-colors hover:text-[#064ea2] md:block">返回门户首页</a>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative hidden lg:block">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索物资名称 / 规格型号 / 目录编码 / 供应商" className="h-10 w-[420px] rounded-xl border border-[#cdd9ea] bg-[#f8fbff] pl-10 pr-3 text-sm outline-none transition focus:border-[#064ea2] focus:bg-white focus:shadow-[0_0_0_3px_rgba(6,78,162,.08)]" />
              <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a96aa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <button onClick={() => setBudgetOpen(true)} className="relative h-10 rounded-xl bg-[#064ea2] px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(6,78,162,.2)] transition hover:bg-[#043d82]">预算清单{budget.length > 0 && <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e74c3c] px-1 text-xs text-white">{budget.length}</span>}</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-6 py-6">
        <section className="overflow-hidden rounded-[28px] border border-[#dbe6f3] bg-[#063f86] text-white shadow-[0_24px_70px_rgba(6,78,162,.18)]">
          <div className="relative px-8 py-8 lg:px-10">
            <div className="absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,.24),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(24,165,108,.22),transparent_34%)]" />
            <div className="relative max-w-3xl">
              <p className="mb-3 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-white/85">集团集中采购 · 价格参考 · 预算依据</p>
              <h1 className="mb-3 text-3xl font-black tracking-wide lg:text-4xl">四川水发集团集中采购价格目录平台</h1>
              <p className="max-w-2xl text-sm leading-7 text-white/75">汇集集团协议供应商、框架协议价格、历史成交均价与市场参考价，为项目预算编制、采购立项、询价比价和审计留痕提供统一价格依据。</p>
              <div className="mt-5 flex flex-wrap gap-2">{['集团协议价', '历史成交均价', '价格有效期管理', '异常波动预警'].map(label => <span key={label} className="rounded-full bg-white/12 px-3 py-1 text-xs font-semibold text-white/85">{label}</span>)}</div>
            </div>
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索物资名称 / 规格型号 / 目录编码 / 供应商" className="mb-3 h-11 w-full rounded-xl border border-[#cdd9ea] px-3 text-sm outline-none focus:border-[#064ea2] lg:hidden" />
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
            <div className="space-y-3">{DIRECTORY.map(section => <div key={section.group}><div className="mb-1 text-xs font-bold text-[#8a96aa]">{section.group}</div><div className="grid gap-1">{section.children.map(child => <button key={child} onClick={() => setCategory(child)} className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${category === child ? 'bg-[#064ea2] text-white shadow-[0_8px_18px_rgba(6,78,162,.2)]' : 'text-[#344563] hover:bg-[#f3f7fc] hover:text-[#064ea2]'}`}><span>{child}</span><span className={`text-xs ${category === child ? 'text-white/70' : 'text-[#8a96aa]'}`}>{child === '全部' ? CATALOG_ITEMS.length : CATALOG_ITEMS.filter(item => item.category === child || item.group === child).length}</span></button>)}</div></div>)}</div>
          </aside>

          <div className="min-w-0 space-y-5">
            <section className="grid gap-4 xl:grid-cols-4">{focusItems.map(item => <button key={item.id} onClick={() => setDetail(item)} className="group rounded-2xl border border-[#e1e9f4] bg-white p-4 text-left shadow-[0_10px_28px_rgba(15,35,65,.04)] transition hover:-translate-y-0.5 hover:border-[#064ea2]/30 hover:shadow-[0_18px_42px_rgba(6,78,162,.10)]"><div className="mb-3 flex items-center justify-between gap-2"><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusStyles[item.status]}`}>{item.status}</span><span className={`text-xs font-black ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#8a96aa]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</span></div><h3 className="line-clamp-1 text-sm font-black text-[#18243a] group-hover:text-[#064ea2]">{item.name}</h3><p className="mt-1 line-clamp-1 text-xs text-[#8a96aa]">{item.specification}</p><div className="mt-3 flex items-end justify-between"><div><span className="text-xl font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#8a96aa]">/{item.unit}</span></div><span className="text-xs font-semibold text-[#5a6d8a]">{item.validUntil}</span></div></button>)}</section>

            <section className="overflow-hidden rounded-2xl border border-[#e1e9f4] bg-white shadow-[0_10px_28px_rgba(15,35,65,.05)]">
              <div className="flex items-center justify-between border-b border-[#e8eef6] px-5 py-4"><div><h2 className="text-lg font-black text-[#18243a]">价格目录清单</h2><p className="mt-1 text-xs text-[#8a96aa]">参考价用于预算编制与询价比价，最终采购价格以采购文件及成交结果为准。</p></div><button onClick={() => toast.success('价格清单导出功能已预留，接入后端后生成 Excel 文件')} className="hidden rounded-xl border border-[#cdd9ea] px-4 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc] md:block">导出价格清单</button></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[1180px] border-collapse text-sm"><thead className="bg-[#f7faff] text-xs font-bold text-[#5a6d8a]"><tr><th className="px-4 py-3 text-left">目录编码 / 物资</th><th className="px-4 py-3 text-left">规格型号</th><th className="px-4 py-3 text-left">分类</th><th className="px-4 py-3 text-right">参考价</th><th className="px-4 py-3 text-left">价格区间</th><th className="px-4 py-3 text-left">供应商</th><th className="px-4 py-3 text-left">来源</th><th className="px-4 py-3 text-left">有效期</th><th className="px-4 py-3 text-left">状态</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-[#eef3f8]">{filtered.map(item => <tr key={item.id} className="transition hover:bg-[#f8fbff]"><td className="px-4 py-4"><button onClick={() => setDetail(item)} className="text-left"><div className="font-mono text-xs font-bold text-[#064ea2]">{item.code}</div><div className="mt-1 font-black text-[#18243a] hover:text-[#064ea2]">{item.name}</div></button></td><td className="max-w-[190px] px-4 py-4 text-[#344563]">{item.specification}</td><td className="px-4 py-4"><span className="rounded-full bg-[#eef3fb] px-2 py-1 text-xs font-bold text-[#064ea2]">{item.category}</span></td><td className="px-4 py-4 text-right"><span className="text-base font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#8a96aa]">/{item.unit}</span></td><td className="px-4 py-4 text-[#5a6d8a]">{formatPrice(item.priceMin)} - {formatPrice(item.priceMax)}</td><td className="max-w-[180px] px-4 py-4"><div className="truncate font-semibold text-[#18243a]">{item.supplier}</div><div className="mt-1 text-xs text-[#8a96aa]">{item.supplierType} · {item.region}</div></td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-xs font-bold ${sourceStyles[item.priceSource]}`}>{item.priceSource}</span></td><td className="px-4 py-4"><div className="font-semibold text-[#344563]">{item.validUntil}</div><div className="mt-1 text-xs text-[#8a96aa]">更新 {item.updatedAt}</div></td><td className="px-4 py-4"><span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusStyles[item.status]}`}>{item.status}</span><div className={`mt-1 text-xs font-bold ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#8a96aa]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</div></td><td className="px-4 py-4 text-right"><button onClick={() => setDetail(item)} className="mr-2 text-xs font-bold text-[#064ea2] hover:underline">详情</button><button onClick={() => addToBudget(item)} className="rounded-lg bg-[#064ea2] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#043d82]">加入预算</button></td></tr>)}</tbody></table></div>
              {filtered.length === 0 && <div className="px-6 py-16 text-center"><div className="text-5xl">📋</div><h3 className="mt-3 text-lg font-black text-[#18243a]">未找到匹配的目录条目</h3><p className="mt-1 text-sm text-[#8a96aa]">请调整关键词、分类、区域或价格状态后重试。</p></div>}
            </section>
          </div>
        </section>
      </main>

      {budgetOpen && <div className="fixed inset-0 z-[100] flex justify-end"><div className="absolute inset-0 bg-[#0f1f35]/35 backdrop-blur-sm" onClick={() => setBudgetOpen(false)} /><div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#e5ecf4] px-6 py-4"><div><h2 className="text-lg font-black text-[#18243a]">预算清单</h2><p className="mt-1 text-xs text-[#8a96aa]">用于项目预算、采购立项附件和询价前准备</p></div><button onClick={() => setBudgetOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a96aa] transition hover:bg-[#f3f7fc]">✕</button></div>{budget.length > 0 ? <><div className="flex-1 overflow-auto px-6 py-3">{budget.map(({ item, qty }) => <div key={item.id} className="border-b border-[#eef3f8] py-4"><div className="flex justify-between gap-4"><div className="min-w-0"><div className="font-mono text-xs font-bold text-[#064ea2]">{item.code}</div><div className="mt-1 truncate text-sm font-black text-[#18243a]">{item.name}</div><div className="mt-1 text-xs text-[#8a96aa]">{item.specification}</div></div><button onClick={() => removeBudgetItem(item.id)} className="text-sm text-[#c3ccd8] transition hover:text-[#e74c3c]">删除</button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-2"><button onClick={() => changeQty(item.id, -1)} className="h-7 w-7 rounded-lg bg-[#f0f3f8] font-bold text-[#5a6d8a]">−</button><span className="w-8 text-center text-sm font-black">{qty}</span><button onClick={() => changeQty(item.id, 1)} className="h-7 w-7 rounded-lg bg-[#f0f3f8] font-bold text-[#5a6d8a]">+</button><span className="text-xs text-[#8a96aa]">{item.unit}</span></div><div className="text-right"><div className="text-xs text-[#8a96aa]">参考小计</div><div className="font-black text-[#e74c3c]">{formatPrice(item.referencePrice * qty)}</div></div></div></div>)}</div><div className="border-t border-[#e5ecf4] px-6 py-4"><div className="mb-4 flex items-center justify-between"><span className="text-sm font-bold text-[#5a6d8a]">预算参考合计</span><span className="text-2xl font-black text-[#e74c3c]">{formatPrice(budgetTotal)}</span></div><div className="grid grid-cols-2 gap-3"><button onClick={() => toast.success('预算清单导出功能已预留，接入后端后生成 Excel 文件')} className="h-11 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc]">导出预算清单</button><button onClick={() => { toast.success('询价单已生成草稿，可在采购模块继续完善'); setBudgetOpen(false); }} className="h-11 rounded-xl bg-[#064ea2] text-sm font-bold text-white transition hover:bg-[#043d82]">生成询价单</button></div></div></> : <div className="flex flex-1 flex-col items-center justify-center text-center"><div className="text-5xl">📑</div><p className="mt-3 text-sm font-bold text-[#8a96aa]">预算清单为空</p><button onClick={() => setBudgetOpen(false)} className="mt-3 text-sm font-bold text-[#064ea2] hover:underline">返回目录选择物资</button></div>}</div></div>}

      {detail && <div className="fixed inset-0 z-[110] flex justify-end"><div className="absolute inset-0 bg-[#0f1f35]/35 backdrop-blur-sm" onClick={() => setDetail(null)} /><div className="relative h-full w-full max-w-2xl overflow-auto bg-white shadow-2xl"><div className="border-b border-[#e5ecf4] bg-[#f8fbff] px-6 py-5"><div className="mb-3 flex items-center justify-between"><span className="font-mono text-xs font-black text-[#064ea2]">{detail.code}</span><button onClick={() => setDetail(null)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a96aa] transition hover:bg-white">✕</button></div><h2 className="text-2xl font-black text-[#18243a]">{detail.name}</h2><p className="mt-2 text-sm text-[#5a6d8a]">{detail.specification}</p></div><div className="space-y-5 px-6 py-5"><div className="rounded-2xl border border-[#e1e9f4] p-5"><div className="mb-3 text-sm font-black text-[#18243a]">价格信息</div><div className="grid gap-4 sm:grid-cols-2"><Info label="当前参考价" value={`${formatPrice(detail.referencePrice)} / ${detail.unit}`} strong /><Info label="价格区间" value={`${formatPrice(detail.priceMin)} - ${formatPrice(detail.priceMax)}`} /><Info label="最近成交价" value={formatPrice(detail.lastDealPrice)} /><Info label="历史采购均价" value={formatPrice(detail.averagePrice)} /><Info label="价格变化" value={`${detail.changeRate > 0 ? '+' : ''}${detail.changeRate}%`} /><Info label="价格状态" value={detail.status} /></div></div><div className="rounded-2xl border border-[#e1e9f4] p-5"><div className="mb-3 text-sm font-black text-[#18243a]">供应商与适用范围</div><div className="grid gap-4 sm:grid-cols-2"><Info label="供应商" value={detail.supplier} /><Info label="供应商类型" value={detail.supplierType} /><Info label="适用区域" value={detail.region} /><Info label="最小参考采购量" value={detail.minOrder} /><Info label="含税" value={detail.taxIncluded ? '是' : '否'} /><Info label="含运费" value={detail.freightIncluded ? '是' : '否'} /></div></div><div className="rounded-2xl border border-[#e1e9f4] p-5"><div className="mb-3 text-sm font-black text-[#18243a]">价格依据</div><div className="grid gap-4 sm:grid-cols-2"><Info label="价格来源" value={detail.priceSource} /><Info label="更新时间" value={detail.updatedAt} /><Info label="有效期至" value={detail.validUntil} /><Info label="分类目录" value={`${detail.group} / ${detail.category}`} /></div><p className="mt-4 rounded-xl bg-[#f7faff] p-3 text-sm leading-6 text-[#5a6d8a]">{detail.remark}</p></div><div className="grid grid-cols-2 gap-3"><button onClick={() => { navigator.clipboard?.writeText(detail.code); toast.success('目录编码已复制'); }} className="h-11 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc]">复制目录编码</button><button onClick={() => { addToBudget(detail); setDetail(null); }} className="h-11 rounded-xl bg-[#064ea2] text-sm font-bold text-white transition hover:bg-[#043d82]">加入预算清单</button></div></div></div></div>}
    </div>
  );
}

function Info({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><div className="text-xs font-bold text-[#8a96aa]">{label}</div><div className={`mt-1 text-sm ${strong ? 'text-xl font-black text-[#e74c3c]' : 'font-semibold text-[#18243a]'}`}>{value}</div></div>;
}
