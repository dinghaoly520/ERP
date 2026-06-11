'use client';

import { useState } from 'react';

interface Product {
  id: string;
  name: string;
  category: string;
  price: string;
  unit: string;
  supplier: string;
  stock: string;
  tag?: string;
}

const demoProducts: Product[] = [
  { id: '1', name: 'Q235B热轧带钢', category: '钢材', price: '4,280', unit: '元/吨', supplier: '攀钢集团', stock: '充足', tag: '热销' },
  { id: '2', name: 'P.O42.5普通硅酸盐水泥', category: '水泥', price: '380', unit: '元/吨', supplier: '峨胜水泥', stock: '充足' },
  { id: '3', name: 'HDPE双壁波纹管 DN400', category: '管材', price: '128', unit: '元/米', supplier: '四川川塑', stock: '充足' },
  { id: '4', name: '潜水排污泵 15kW', category: '机电设备', price: '8,600', unit: '元/台', supplier: '格兰富泵业', stock: '现货', tag: '推荐' },
  { id: '5', name: '橡胶止水带 350×8', category: '防水材料', price: '35', unit: '元/米', supplier: '衡水恒力', stock: '充足' },
  { id: '6', name: '自动化流量计 DN200', category: '仪器仪表', price: '12,500', unit: '元/台', supplier: '威尔泰仪表', stock: '预定', tag: '新品' },
  { id: '7', name: '土工布 200g/m²', category: '土工材料', price: '3.8', unit: '元/㎡', supplier: '山东宏祥', stock: '充足' },
  { id: '8', name: '安全防护用品套装', category: '劳保用品', price: '260', unit: '元/套', supplier: '霍尼韦尔', stock: '充足' },
  { id: '9', name: '柴油发电机组 200kW', category: '机电设备', price: '68,000', unit: '元/台', supplier: '康明斯动力', stock: '预定' },
  { id: '10', name: '钢丝绳 6×19 φ16', category: '钢材', price: '12.5', unit: '元/米', supplier: '贵州钢绳', stock: '充足' },
  { id: '11', name: '变频控制柜 30kW', category: '电气设备', price: '15,800', unit: '元/台', supplier: '西门子电气', stock: '现货', tag: '推荐' },
  { id: '12', name: '无缝钢管 φ219×6', category: '钢材', price: '5,120', unit: '元/吨', supplier: '攀钢集团', stock: '充足' },
];

const categories = ['全部', '钢材', '水泥', '管材', '机电设备', '防水材料', '仪器仪表', '土工材料', '劳保用品', '电气设备'];

export default function MallPage() {
  const [activeCategory, setActiveCategory] = useState('全部');
  const [search, setSearch] = useState('');

  const filtered = demoProducts.filter(p => {
    const matchCat = activeCategory === '全部' || p.category === activeCategory;
    const matchSearch = !search || p.name.includes(search) || p.category.includes(search) || p.supplier.includes(search);
    return matchCat && matchSearch;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">电子商城</h1>
          <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">集中采购、员工内购、商家入驻与管理</p>
        </div>
      </div>

      {/* 搜索 + 分类 */}
      <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-4 mb-4 flex gap-3 items-center flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索商品名称、分类、供应商" className="flex-1 min-w-[200px] px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
        <div className="flex gap-2 flex-wrap">
          {categories.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${activeCategory === cat ? 'bg-[#064ea2] text-white' : 'bg-[oklch(0.992_0.003_264)] text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.97_0.008_262)]'}`}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 商品网格 */}
      <div className="grid grid-cols-4 gap-4">
        {filtered.map(product => (
          <div key={product.id}
            className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5 hover:shadow-md hover:border-[oklch(0.80_0.04_258)] transition-all cursor-pointer group">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs px-2 py-0.5 rounded-full bg-[oklch(0.992_0.003_264)] text-[oklch(0.55_0.01_264)] border border-[oklch(0.91_0.006_264)]">{product.category}</span>
              {product.tag && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${product.tag === '热销' ? 'bg-red-50 text-red-600' : product.tag === '新品' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                  {product.tag}
                </span>
              )}
            </div>
            <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-2 group-hover:text-[#064ea2] transition">{product.name}</h3>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="text-2xl font-bold text-[#e74c3c]">¥{product.price}</span>
              <span className="text-xs text-[oklch(0.55_0.01_264)]">/{product.unit}</span>
            </div>
            <div className="space-y-1.5 text-xs text-[oklch(0.55_0.01_264)]">
              <div className="flex justify-between">
                <span>供应商</span>
                <span className="font-semibold text-[oklch(0.18_0.012_265)]">{product.supplier}</span>
              </div>
              <div className="flex justify-between">
                <span>库存</span>
                <span className={`font-semibold ${product.stock === '充足' ? 'text-[#11a874]' : product.stock === '现货' ? 'text-[#064ea2]' : 'text-[#f5a623]'}`}>{product.stock}</span>
              </div>
            </div>
            <button className="w-full mt-4 py-2 bg-[oklch(0.992_0.003_264)] text-[#064ea2] rounded-lg text-sm font-semibold border border-[oklch(0.91_0.006_264)] hover:bg-[#064ea2] hover:text-white hover:border-[#064ea2] transition">
              加入采购单
            </button>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center">
          <div className="text-5xl mb-4">🛒</div>
          <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-2">未找到商品</h3>
          <p className="text-sm text-[oklch(0.55_0.01_264)]">请尝试其他搜索条件或分类</p>
        </div>
      )}
    </div>
  );
}
