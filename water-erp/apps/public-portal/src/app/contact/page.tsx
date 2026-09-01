'use client';

import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

/* ═══════════════════════════════════════
   联系我们 — 四川省水利发展集团有限公司
   布局策略：统一顶栏 → 标题 → 三卡片横排(full-bleed) → Footer
   ═══════════════════════════════════════ */

const CONTACT_INFO = [
  {
    icon: 'pin',
    label: '公司地址',
    lines: ['成都市双流区红莲街三段383号A栋'],
  },
  {
    icon: 'fax',
    label: '联系 / 传真',
    lines: ['电话：——', '传真：028-67565500'],
  },
  {
    icon: 'service',
    label: '信访接待',
    lines: ['欢迎社会各界莅临指导'],
    action: { label: '点击查看详情', href: '/contact/visitor' },
  },
];

export default function ContactPage() {
  return (
    <div className="flow-page flex flex-col" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <FlowBackdrop />
      {/* ═══ 统一顶栏 ═══ */}
      <UnifiedHeader announcements={[]} onLoginClick={() => {}} onRegisterClick={() => {}} />

      <main className="flex-1 flex flex-col relative z-10">
        {/* ═══ Contact Cards — 三列横排 ═══ */}
        <section className="px-[clamp(28px,4vw,72px)] pt-3 pb-[clamp(36px,3.5vw,52px)] w-full flex-1 flex flex-col">
        <a href="/" className="flow-back">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          返回首页
        </a>
        {/* 标题 */}
        <div className="mb-[clamp(28px,3vw,40px)] text-center">
          <h1 className="text-[clamp(28px,3vw,40px)] font-black text-[#18243a] mb-1.5" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>联系我们</h1>
          <p className="text-sm text-[#8a96aa]">欢迎各界朋友与我们取得联系</p>
        </div>
        <div className="flex-1 flex items-center pb-[clamp(24px,2vw,36px)]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
          {CONTACT_INFO.map((item, i) => (
            <div key={i}
              className="flex flex-col neu-card p-6"
            >
              {/* Icon + Label */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-[10px] bg-[#f0f4fb] text-[#064ea2] flex items-center justify-center shrink-0"
                  dangerouslySetInnerHTML={{ __html: SVG_ICONS[item.icon] }} />
                <span className="text-[11px] font-bold tracking-[0.16em] text-[#94a3b8]">{item.label}</span>
              </div>

              {/* Content lines */}
              <div className="flex flex-col gap-1 flex-1">
                {item.lines.map((line, j) => (
                  <span key={j} className="text-[15px] font-medium text-[#1c2941] leading-relaxed">{line}</span>
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

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-[#eef1f6] bg-[#fafbfc]">
        <div className="px-[clamp(28px,4vw,72px)] py-5 flex items-center justify-between text-[12px] text-[#8a96aa] max-sm:flex-col max-sm:gap-1.5">
          <span>© 2026 四川省水利发展集团有限公司</span>
          <div className="flex items-center gap-4">
            <a href="/about" className="hover:text-[#064ea2] transition-colors">集团简介</a>
            <a href="/" className="hover:text-[#064ea2] transition-colors">返回首页</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── SVG Icons ── */
const S = 'width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const SVG_ICONS: Record<string, string> = {
  pin: `<svg viewBox="0 0 24 24" ${S}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  fax: `<svg viewBox="0 0 24 24" ${S}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h4"/><path d="M6 12h3"/><path d="M6 16h2"/><path d="M14 8h4"/><path d="M14 12h3"/><path d="M14 16h2"/></svg>`,
  service: `<svg viewBox="0 0 24 24" ${S}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
};
