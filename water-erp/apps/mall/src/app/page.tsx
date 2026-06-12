'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   电子商城 — 集中采购 · 商家入驻
   port 3002
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
  supplier: string;
  stock: string;
  tag?: string;
  image: string;
  minOrder: string;
}

const PRODUCTS: Product[] = [
  { id: '1',  name: 'Q235B 热轧带钢',       category: '钢材',   price: 4280,  unit: '吨', supplier: '攀钢集团',     stock: '充足', tag: '热销', image: '🛢️', minOrder: '1吨' },
  { id: '2',  name: 'P.O42.5 硅酸盐水泥',    category: '水泥',   price: 380,   unit: '吨', supplier: '峨胜水泥',     stock: '充足', image: '🧱', minOrder: '5吨' },
  { id: '3',  name: 'HDPE 双壁波纹管 DN400',  category: '管材',   price: 128,   unit: '米', supplier: '四川川塑',     stock: '充足', image: '🔧', minOrder: '50米' },
  { id: '4',  name: '潜水排污泵 15kW',        category: '机电设备', price: 8600,  unit: '台', supplier: '格兰富泵业',   stock: '现货', tag: '推荐', image: '⚙️', minOrder: '1台' },
  { id: '5',  name: '橡胶止水带 350×8',       category: '防水材料', price: 35,    unit: '米', supplier: '衡水恒力',     stock: '充足', image: '💧', minOrder: '20米' },
  { id: '6',  name: '自动化流量计 DN200',      category: '仪器仪表', price: 12500, unit: '台', supplier: '威尔泰仪表',   stock: '预定', tag: '新品', image: '📡', minOrder: '1台' },
  { id: '7',  name: '土工布 200g/m²',         category: '土工材料', price: 3.8,   unit: '㎡', supplier: '山东宏祥',     stock: '充足', image: '🧵', minOrder: '200㎡' },
  { id: '8',  name: '安全防护用品套装',         category: '劳保用品', price: 260,   unit: '套', supplier: '霍尼韦尔',     stock: '充足', image: '🦺', minOrder: '10套' },
  { id: '9',  name: '柴油发电机组 200kW',      category: '机电设备', price: 68000, unit: '台', supplier: '康明斯动力',   stock: '预定', image: '🔌', minOrder: '1台' },
  { id: '10', name: '钢丝绳 6×19 φ16',        category: '钢材',   price: 12.5,  unit: '米', supplier: '贵州钢绳',     stock: '充足', image: '🪢', minOrder: '100米' },
  { id: '11', name: '变频控制柜 30kW',         category: '电气设备', price: 15800, unit: '台', supplier: '西门子电气',   stock: '现货', tag: '推荐', image: '🔋', minOrder: '1台' },
  { id: '12', name: '无缝钢管 φ219×6',       category: '钢材',   price: 5120,  unit: '吨', supplier: '攀钢集团',     stock: '充足', image: '🔩', minOrder: '1吨' },
  { id: '13', name: '蝶阀 DN300',             category: '管材',   price: 2450,  unit: '台', supplier: '天津阀门',     stock: '现货', image: '🚿', minOrder: '1台' },
  { id: '14', name: '止回阀 DN150',           category: '管材',   price: 890,   unit: '台', supplier: '天津阀门',     stock: '充足', image: '🔄', minOrder: '1台' },
  { id: '15', name: '电力电缆 YJV 3×150+70',  category: '电气设备', price: 520,  unit: '米', supplier: '四川蜀龙',     stock: '充足', image: '⚡', minOrder: '50米' },
  { id: '16', name: '水泵智能控制柜',          category: '电气设备', price: 13800, unit: '套', supplier: '格兰富泵业',   stock: '预定', tag: '新品', image: '🎛️', minOrder: '1套' },
];

const CATEGORIES = ['全部', '钢材', '水泥', '管材', '机电设备', '防水材料', '仪器仪表', '土工材料', '劳保用品', '电气设备'];

const STOCK_COLORS: Record<string, string> = { '充足': 'text-green-600', '现货': 'text-blue-600', '预定': 'text-amber-500' };

export default function MallPage() {
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<{ product: Product; qty: number }[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [detail, setDetail] = useState<Product | null>(null);

  const filtered = useMemo(() => PRODUCTS.filter(p => {
    const cat = category === '全部' || p.category === category;
    const s = !search || p.name.includes(search) || p.category.includes(search) || p.supplier.includes(search);
    return cat && s;
  }), [category, search]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const idx = prev.findIndex(c => c.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { product, qty: 1 }];
    });
    toast.success(`已添加：${product.name}`);
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.product.id !== id));

  const changeQty = (id: string, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.product.id !== id) return c;
      const q = c.qty + delta;
      return q <= 0 ? null : { ...c, qty: q };
    }).filter(Boolean) as typeof prev);
  };

  const cartTotal = cart.reduce((sum, c) => sum + c.product.price * c.qty, 0);

  return (
    <div className="min-h-screen bg-[#f5f7fa]" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      {/* ═══════════ Header ═══════════ */}
      <header className="sticky top-0 z-50 bg-white border-b border-[#e5ecf4]">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <a href="http://localhost:3006" className="text-lg font-black text-[#123a6e] tracking-tight">
              <span className="text-[#064ea2]">蜀水</span>云采商城
            </a>
            <a href="http://localhost:3006" className="text-sm text-[#5a6d8a] hover:text-[#064ea2] transition-colors" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>
              ← 返回门户首页
            </a>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative hidden sm:block">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索商品..."
                className="w-56 h-9 pl-9 pr-3 border border-[#d0dae8] rounded-lg text-sm focus:outline-none focus:border-[#064ea2] placeholder:text-[#bbb]"
              />
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#bbb]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <button
              onClick={() => setCartOpen(true)}
              className="relative h-9 px-4 rounded-lg border border-[#d0dae8] text-sm font-semibold text-[#064ea2] hover:bg-[#f5f8fc] transition-colors"
            >
              🛒 采购单
              {cart.length > 0 && (
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#e74c3c] text-white text-xs flex items-center justify-center font-bold">{cart.length}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ═══════════ Hero Banner ═══════════ */}
      <section className="bg-gradient-to-r from-[#064ea2] via-[#0e62d0] to-[#1a80e8] text-white">
        <div className="max-w-[1600px] mx-auto px-6 py-10">
          <h1 className="text-2xl font-black mb-2 tracking-wide">集中采购电子商城</h1>
          <p className="text-sm text-white/70 max-w-lg">汇集优质供应商，一站式采购水利工程物资。热轧钢材、水泥管材、机电设备 — 阳光透明，高效便捷。</p>
        </div>
      </section>

      {/* ═══════════ Category Chips ═══════════ */}
      <section className="bg-white border-b border-[#e5ecf4]">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${category === cat ? 'bg-[#064ea2] text-white' : 'bg-[#f0f3f8] text-[#5a6d8a] hover:bg-[#e2e8f2]'}`}
            >{cat}</button>
          ))}
        </div>
      </section>

      {/* ═══════════ Product Grid ═══════════ */}
      <main className="max-w-[1600px] mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-[#8a96aa]">
            共 <strong className="text-[#18243a]">{filtered.length}</strong> 件商品
            {search && <span> — 搜索 "{search}"</span>}
          </p>
        </div>

        {filtered.length > 0 ? (
          <div className="grid grid-cols-4 max-lg:grid-cols-3 max-md:grid-cols-2 max-sm:grid-cols-1 gap-4">
            {filtered.map(p => (
              <div
                key={p.id}
                className="bg-white rounded-xl border border-[#e5ecf4] p-5 hover:shadow-lg hover:border-[#064ea2]/20 transition-all cursor-pointer group"
                onClick={() => setDetail(p)}
              >
                {/* Image */}
                <div className="w-full h-32 bg-gradient-to-br from-[#f0f4fa] to-[#e2eaf5] rounded-lg mb-4 flex items-center justify-center text-5xl group-hover:scale-105 transition-transform">
                  {p.image}
                </div>
                {/* Tags */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#eef3fb] text-[#064ea2] font-semibold">{p.category}</span>
                  {p.tag && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${p.tag === '热销' ? 'bg-red-50 text-red-500' : p.tag === '新品' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                      {p.tag}
                    </span>
                  )}
                </div>
                {/* Name */}
                <h3 className="font-bold text-[#18243a] mb-2 group-hover:text-[#064ea2] transition-colors text-sm leading-snug">{p.name}</h3>
                {/* Price */}
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-2xl font-bold text-[#e74c3c]">¥{p.price.toLocaleString()}</span>
                  <span className="text-xs text-[#999]">/{p.unit}</span>
                </div>
                {/* Meta */}
                <div className="space-y-1.5 text-xs text-[#8a96aa] mb-4">
                  <div className="flex justify-between"><span>供应商</span><span className="font-semibold text-[#18243a]">{p.supplier}</span></div>
                  <div className="flex justify-between"><span>起订量</span><span className="text-[#555]">{p.minOrder}</span></div>
                  <div className="flex justify-between"><span>库存</span><span className={`font-semibold ${STOCK_COLORS[p.stock]}`}>{p.stock}</span></div>
                </div>
                {/* Add to cart */}
                <button
                  onClick={e => { e.stopPropagation(); addToCart(p); }}
                  className="w-full py-2 rounded-lg text-sm font-semibold border border-[#064ea2] text-[#064ea2] bg-white hover:bg-[#064ea2] hover:text-white transition-colors"
                >加入采购单</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#e5ecf4] p-16 text-center">
            <div className="text-6xl mb-4">🛒</div>
            <h3 className="text-lg font-bold text-[#18243a] mb-2">未找到匹配商品</h3>
            <p className="text-sm text-[#8a96aa]">试试调整搜索关键词或切换分类</p>
          </div>
        )}
      </main>

      {/* ═══════════ Cart Drawer ═══════════ */}
      {cartOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-slide-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5ecf4]">
              <h2 className="text-lg font-black text-[#18243a]">采购单</h2>
              <button onClick={() => setCartOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f5f8fc] text-[#999] transition-colors">✕</button>
            </div>

            {cart.length > 0 ? (
              <>
                <div className="flex-1 overflow-auto px-6 py-3 space-y-3">
                  {cart.map(({ product, qty }) => (
                    <div key={product.id} className="flex gap-3 py-3 border-b border-[#f0f2f6]">
                      <div className="w-14 h-14 rounded-lg bg-[#f0f4fa] flex items-center justify-center text-2xl shrink-0">{product.image}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#18243a] truncate">{product.name}</p>
                        <p className="text-xs text-[#8a96aa]">{product.supplier}</p>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-2">
                            <button onClick={() => changeQty(product.id, -1)} className="w-6 h-6 rounded bg-[#f0f3f8] text-[#555] text-xs hover:bg-[#e2e8f2]">−</button>
                            <span className="text-sm font-bold w-6 text-center">{qty}</span>
                            <button onClick={() => changeQty(product.id, 1)} className="w-6 h-6 rounded bg-[#f0f3f8] text-[#555] text-xs hover:bg-[#e2e8f2]">+</button>
                          </div>
                          <span className="text-sm font-bold text-[#e74c3c]">¥{(product.price * qty).toLocaleString()}</span>
                        </div>
                      </div>
                      <button onClick={() => removeFromCart(product.id)} className="text-[#ccc] hover:text-red-400 text-sm shrink-0">🗑</button>
                    </div>
                  ))}
                </div>
                <div className="px-6 py-4 border-t border-[#e5ecf4]">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm text-[#8a96aa]">合计</span>
                    <span className="text-xl font-black text-[#e74c3c]">¥{cartTotal.toLocaleString()}</span>
                  </div>
                  <button
                    onClick={() => { toast.success('采购单已提交，供应商将尽快联系您'); setCart([]); setCartOpen(false); }}
                    className="w-full py-3 bg-[#064ea2] text-white rounded-lg text-sm font-bold hover:bg-[#043d82] transition-colors"
                  >提交采购单</button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-[#ccc]">
                <div className="text-5xl mb-3">🛒</div>
                <p className="text-sm">采购单是空的</p>
                <button onClick={() => setCartOpen(false)} className="mt-3 text-sm text-[#064ea2] font-semibold hover:underline">去逛逛</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ Product Detail Modal ═══════════ */}
      {detail && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDetail(null)} />
          <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto">
            <div className="h-40 bg-gradient-to-br from-[#f0f4fa] to-[#e2eaf5] flex items-center justify-center text-7xl">{detail.image}</div>
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs px-2.5 py-1 rounded bg-[#eef3fb] text-[#064ea2] font-semibold">{detail.category}</span>
                <button onClick={() => setDetail(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f5f8fc] text-[#999]">✕</button>
              </div>
              <h2 className="text-xl font-black text-[#18243a] mb-4">{detail.name}</h2>
              <div className="flex items-baseline gap-1 mb-5">
                <span className="text-3xl font-bold text-[#e74c3c]">¥{detail.price.toLocaleString()}</span>
                <span className="text-sm text-[#999]">/{detail.unit}</span>
              </div>
              <div className="bg-[#f5f7fa] rounded-xl p-4 space-y-2 text-sm mb-5">
                <div className="flex justify-between"><span className="text-[#8a96aa]">供应商</span><span className="font-semibold text-[#18243a]">{detail.supplier}</span></div>
                <div className="flex justify-between"><span className="text-[#8a96aa]">起订量</span><span className="text-[#555]">{detail.minOrder}</span></div>
                <div className="flex justify-between"><span className="text-[#8a96aa]">库存状态</span><span className={`font-semibold ${STOCK_COLORS[detail.stock]}`}>{detail.stock}</span></div>
                <div className="flex justify-between"><span className="text-[#8a96aa]">发货地</span><span className="text-[#555]">四川成都</span></div>
              </div>
              <button
                onClick={() => { addToCart(detail); setDetail(null); }}
                className="w-full py-3 bg-[#064ea2] text-white rounded-lg text-sm font-bold hover:bg-[#043d82] transition-colors"
              >加入采购单</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
