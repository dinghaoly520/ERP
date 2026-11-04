'use client';

import { MapPin, PhoneCall, MessageSquare } from 'lucide-react';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

/* ═══════════════════════════════════════
   联系我们 — 四川省水利发展集团有限公司采购办
   布局策略：统一顶栏 → 标题 → 三卡片横排(full-bleed) → Footer
   卡片结构（2026-11-04 cgzxui 优化）：图标井 + 标签 → hairline →
   内容行（主信息 15px 墨色 / 次信息 13px 灰阶，k/v 型带弱化前缀）→ 主操作
   ═══════════════════════════════════════ */

type ContactRow = { label?: string; value: string; strong?: boolean };

const CONTACT_CARDS: { icon: typeof MapPin; label: string; rows: ContactRow[]; action?: { label: string; href: string } }[] = [
  {
    icon: MapPin,
    label: '采购办地址',
    rows: [
      { value: '四川省成都市双流区正兴街道红莲街三段383号', strong: true },
      { value: '四川省水利发展集团有限公司B座3楼' },
    ],
  },
  {
    icon: PhoneCall,
    label: '联系方式',
    rows: [
      { label: '电话', value: '028-8888-0609', strong: true },
      { label: '传真', value: '028-67565500' },
    ],
  },
  {
    icon: MessageSquare,
    label: '供应商来访接待',
    rows: [
      { value: '供应商现场来访请提前登记预约', strong: true },
      { value: '我们将安排专人接待' },
    ],
    action: { label: '来访登记', href: '/contact/visitor' },
  },
];

export default function ContactPage() {
  return (
    <div className="flow-page flex flex-col">
      <FlowBackdrop />
      {/* ═══ 统一顶栏 ═══ */}
      <UnifiedHeader />

      <main className="relative z-10 flex flex-1 flex-col">
        {/* ═══ Contact Cards — 三列横排 ═══ */}
        <section className="flex-1 w-full flex flex-col px-[clamp(28px,4vw,72px)] pt-3 pb-[clamp(36px,3.5vw,52px)]">
          <a href="/" className="flow-back">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            返回首页
          </a>
          {/* 标题 — 与集团简介页同语汇 */}
          <div className="mb-[clamp(28px,3vw,40px)] text-center">
            <h1 className="mb-3 text-[clamp(28px,3vw,40px)] font-black tracking-[0.02em] text-[var(--ink)]">联系我们</h1>
            <span className="mx-auto mb-2.5 block h-[3px] w-10 rounded-full bg-[linear-gradient(90deg,var(--brand),var(--water))]" />
            <p className="text-sm text-[var(--fg-3)]">四川省水利发展集团有限公司采购办 · 欢迎供应商与我们取得联系</p>
          </div>
          <div className="flex-1 flex items-center pb-[clamp(24px,2vw,36px)]">
            <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
              {CONTACT_CARDS.map((item, i) => (
                <div key={i} className="neu-card flex flex-col p-6">
                  {/* 头部：图标井 + 标签 */}
                  <div className="flex items-center gap-3">
                    <div className="page-hero__icon">
                      <item.icon size={18} strokeWidth={1.9} />
                    </div>
                    <span className="text-[13px] font-bold tracking-[0.08em] text-[var(--ink)]">{item.label}</span>
                  </div>

                  {/* hairline 分割 — cgzxui 统一参数 */}
                  <div className="my-4" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)' }} />

                  {/* 内容行 */}
                  <div className="flex flex-1 flex-col gap-2.5">
                    {item.rows.map((row, j) => (
                      <div key={j} className="flex items-baseline gap-2.5">
                        {row.label && (
                          <span className="shrink-0 text-[11px] font-semibold tracking-[0.1em] text-[var(--fg-3)]">{row.label}</span>
                        )}
                        <span className={row.strong
                          ? 'text-[15px] font-semibold leading-relaxed tracking-[0.01em] text-[var(--ink)] tabular-nums'
                          : 'text-[13px] leading-relaxed text-[var(--fg-2)]'}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* 主操作 — 箭头走 cgzxui 规范（.flow-cta-arrow：chevron 置圆形容器，hover 右滑） */}
                  {item.action && (
                    <a href={item.action.href}
                      className="neu-btn-primary mt-5 self-start">
                      {item.action.label}
                      <svg className="flow-cta-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ═══ Footer — 玻璃雾化，与首页同语汇 ═══ */}
      <footer className="footer-glass">
        <div className="flex items-center justify-between gap-3 px-[clamp(28px,4vw,72px)] py-4 max-sm:flex-col max-sm:gap-3">
          <span className="text-[11px] text-[#8a96aa] flex items-center gap-2 flex-wrap justify-center">
            Copyright ® 2026 四川省水利发展集团有限公司 版权所有
            <span className="footer-legal-divider" aria-hidden="true" />
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="footer-legal-icp">蜀ICP备2020033056号-1</a>
          </span>
          <div className="flex items-center gap-2">
            <a href="/about" className="footer-link">集团简介</a>
            <a href="/" className="footer-link">返回首页</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
