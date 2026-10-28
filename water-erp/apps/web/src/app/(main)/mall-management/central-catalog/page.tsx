import Link from 'next/link';
import { ShoppingCart, ExternalLink, Folder, Sparkles, FileSpreadsheet } from 'lucide-react';

const MALL_URL = process.env.NEXT_PUBLIC_MALL_URL || 'http://localhost:3003';
// SSO 入口走同源 /api 代理（next.config rewrites → API）：绝对地址在域名/IP 两种访问形态
// 下必有一头是错的（原 localhost:4001 硬拼指到访客本机）；同源相对路径全形态天然正确。
const SSO_URL = `/api/auth/sso/mall?redirect_uri=${encodeURIComponent(MALL_URL)}`;

/** 来自 :3003 首页的真实功能，不臆造 */
const CARDS = [
  {
    icon: Folder,
    title: '品类目录',
    desc: '工程材料 · 机电设备 · 信息化设备 · 劳保及通用物资 · 办公后勤 · 服务采购六大品类；按区域、状态、价格来源多维筛选。',
  },
  {
    icon: Sparkles,
    title: '智能检索',
    desc: '关键字搜索目录与供应商；使用水叮当 AI 进行语义检索与分析。',
  },
  {
    icon: FileSpreadsheet,
    title: '采购工具',
    desc: '收藏条目加入预算清单；一键导出 Excel 或分析报表。',
  },
] as const;

export default function CentralCatalogPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ShoppingCart size={17} strokeWidth={1.5} /></div>
            <div>
              <div className="page-hero__title">集中采购目录</div>
              <div className="page-hero__sub">浏览集中采购目录的品类与商品，维护操作请前往「目录管理」</div>
            </div>
          </div>
          <div className="page-hero__right" />
        </div>
      </div>

      <div className="neu-card p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-start lg:gap-10">
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {CARDS.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="kpi-card flex flex-col gap-2.5 p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-tint)]">
                      <Icon size={15} className="text-[var(--accent)]" strokeWidth={1.5} />
                    </div>
                    <span className="text-sm font-bold text-[var(--foreground)]">{title}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:hidden mt-5 pt-5" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }} />
          <div className="flex flex-col items-stretch gap-3 lg:flex-shrink-0 lg:w-48">
            <a href={SSO_URL} target="_blank" rel="noopener noreferrer" className="neu-btn-primary h-[44px] justify-center">
              <ExternalLink size={14} strokeWidth={2} />
              进入采购商城
            </a>
            <Link href="/mall-management/catalog" className="neu-btn-soft h-[44px] justify-center">
              目录管理
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
