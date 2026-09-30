'use client';

import { MapPin, PhoneCall, MessageSquare } from 'lucide-react';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

/* ═══════════════════════════════════════
   联系我们 — 四川省水利发展集团有限公司采购中心
   布局策略：统一顶栏 → 标题 → 三卡片横排(full-bleed) → Footer
   ═══════════════════════════════════════ */

const CONTACT_INFO = [
  {
    icon: MapPin,
    label: '采购中心地址',
    lines: ['四川省成都市双流区正兴街道红莲街三段383号', '四川省水利发展集团有限公司B座3楼'],
  },
  {
    icon: PhoneCall,
    label: '联系方式',
    lines: ['电话：028-8888-0609', '传真：028-67565500'],
  },
  {
    icon: MessageSquare,
    label: '供应商来访接待',
    lines: ['供应商现场来访请提前登记预约', '我们将安排专人接待'],
    action: { label: '来访登记', href: '/contact/visitor' },
  },
];

export default function ContactPage() {
  return (
    <div className="flow-page flex flex-col">
      <FlowBackdrop />
      {/* ═══ 统一顶栏 ═══ */}
      <UnifiedHeader announcements={[]} onLoginClick={() => {}} onRegisterClick={() => {}} />

      <main className="relative z-10 flex flex-1 flex-col">
        {/* ═══ Contact Cards — 三列横排 ═══ */}
        <section className="flex-1 w-full flex flex-col px-[clamp(28px,4vw,72px)] pt-3 pb-[clamp(36px,3.5vw,52px)]">
          <a href="/" className="flow-back">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            返回首页
          </a>
          {/* 标题 */}
          <div className="mb-[clamp(28px,3vw,40px)] text-center">
            <h1 className="mb-3 text-[clamp(28px,3vw,40px)] font-black tracking-[0.02em] text-[var(--ink)]">联系我们</h1>
            <span className="mx-auto mb-2.5 block h-[3px] w-10 rounded-full bg-[linear-gradient(90deg,var(--brand),var(--water))]" />
            <p className="text-sm text-[var(--fg-3)]">四川省水利发展集团有限公司采购中心 · 欢迎供应商与我们取得联系</p>
          </div>
          <div className="flex-1 flex items-center pb-[clamp(24px,2vw,36px)]">
            <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
              {CONTACT_INFO.map((item, i) => (
                <div key={i} className="neu-card flex flex-col p-6">
                  {/* Icon well + Label */}
                  <div className="mb-4 flex items-center gap-3">
                    <div className="page-hero__icon">
                      <item.icon size={18} strokeWidth={1.9} />
                    </div>
                    <span className="text-[11px] font-bold tracking-[0.16em] text-[var(--fg-3)]">{item.label}</span>
                  </div>

                  {/* Content lines */}
                  <div className="flex flex-1 flex-col gap-1">
                    {item.lines.map((line, j) => (
                      <span key={j} className="text-[15px] font-medium leading-relaxed text-[var(--fg)]">{line}</span>
                    ))}
                  </div>

                  {/* Action button */}
                  {item.action && (
                    <a href={item.action.href}
                      className="neu-btn-primary mt-5 self-start">
                      {item.action.label}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
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
          <span className="text-[11px] text-[#8a96aa]">© 2026 四川省水利发展集团有限公司</span>
          <div className="flex items-center gap-2">
            <a href="/about" className="footer-link">集团简介</a>
            <a href="/" className="footer-link">返回首页</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
