'use client';

import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

/* ═══════════════════════════════════════
   集团简介 — 四川省水利发展集团有限公司
   布局策略：统一顶栏 → 标题 → KPI 瓷片行 → 正文双栏(reading col + project sidebar)
   ═══════════════════════════════════════ */

const STATS = [
  { value: '60', unit: '亿元', label: '注册资本' },
  { value: 'AAA', unit: '', label: '信用评级' },
  { value: '300+', unit: '亿元', label: '资产总额' },
  { value: '61', unit: '户', label: '控股及参股企业' },
  { value: '5,200+', unit: '人', label: '在职职工' },
  { value: '2020', unit: '', label: '成立年份' },
];

const PROJECTS = ['引大济岷','长征渠','亭子口灌区','向家坝灌区','罐子坝水库','毗河二期','引雅济安'];

export default function AboutPage() {
  return (
    <div className="flow-page">
      <FlowBackdrop />
      {/* ═══ 统一顶栏 ═══ */}
      <UnifiedHeader announcements={[]} onLoginClick={() => {}} onRegisterClick={() => {}} />

      <main className="relative z-10">
        {/* ═══ Stats Bar — 全宽 ═══ */}
        <section className="px-[clamp(28px,4vw,72px)] pt-3">
          <a href="/" className="flow-back mb-[clamp(24px,2.5vw,36px)]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            返回首页
          </a>
          {/* 标题 */}
          <div className="mb-[clamp(28px,3vw,40px)] text-center">
            <h1 className="mb-3 text-[clamp(28px,3vw,40px)] font-black tracking-[0.02em] text-[var(--ink)]">集团简介</h1>
            <span className="mx-auto mb-2.5 block h-[3px] w-10 rounded-full bg-[linear-gradient(90deg,var(--brand),var(--water))]" />
            <p className="text-sm text-[var(--fg-3)]">四川省属重点国有企业，水利事业高质量发展的重要力量</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
            {STATS.map((s) => (
              <div key={s.label} className="kpi-card flex flex-col items-center gap-1 px-2 py-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-[1.55rem] font-black leading-none tracking-[-0.02em] tabular-nums text-[var(--brand)]">
                    {s.value}
                  </span>
                  {s.unit && <span className="text-[11px] font-bold text-[var(--fg-3)]">{s.unit}</span>}
                </div>
                <span className="text-[10px] font-semibold tracking-[0.08em] text-[var(--fg-3)]">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ Content — 双栏布局 ═══ */}
        <section className="px-[clamp(28px,4vw,72px)] py-[clamp(36px,3.5vw,52px)]">
          <div className="flex gap-x-12 lg:gap-x-16 max-lg:flex-col max-lg:gap-y-10">

            {/* ── 左栏：正文阅读区 ── */}
            <div className="flex-1 min-w-0">

              {/* 集团概况 */}
              <article className="mb-10">
                <div className="flex items-center gap-2.5 mb-4">
                  <span className="block w-[3px] h-[18px] rounded-full bg-[var(--brand)]" />
                  <h2 className="text-[16px] font-bold tracking-wide text-[var(--ink)]">集团概况</h2>
                </div>
                <p className="text-[15px] leading-[1.9] text-[var(--fg-2)]">
                  四川省水利发展集团有限公司是四川省人民政府授权水利厅代履行出资人职责的省属重点国有企业，于
                  <strong className="font-semibold text-[var(--ink)]">2020年7月29日</strong>
                  挂牌成立，注册资本
                  <strong className="font-semibold text-[var(--ink)]">60亿元</strong>
                  ，
                  <strong className="font-semibold text-[var(--ink)]">AAA级</strong>
                  信用评级。截至2025年底，资产总额逾
                  <strong className="font-semibold text-[var(--ink)]">300亿元</strong>
                  ，实际管理控股及参股下属企业共计
                  <strong className="font-semibold text-[var(--ink)]">61户</strong>
                  ，在职职工
                  <strong className="font-semibold text-[var(--ink)]">5,200余人</strong>
                  。
                </p>
              </article>

              {/* 战略使命 */}
              <article className="mb-10">
                <div className="flex items-center gap-2.5 mb-4">
                  <span className="block w-[3px] h-[18px] rounded-full bg-[var(--brand)]" />
                  <h2 className="text-[16px] font-bold tracking-wide text-[var(--ink)]">战略使命</h2>
                </div>
                <p className="text-[15px] leading-[1.9] text-[var(--fg-2)]">
                  四川省水利发展集团有限公司着力围绕成渝地区双城经济圈建设和&ldquo;四化同步、城乡融合、五区共兴&rdquo;发展战略，加快推进新时期四川水利高质量发展落地落实，牵头实施跨市（州）重大水利工程，是四川省跨市（州）重大水利工程项目的规划、设计、投资、建设、运维、管理以及发展水利特色产业的平台和重要抓手。
                </p>
              </article>

              {/* 企业文化 */}
              <article>
                <div className="flex items-center gap-2.5 mb-4">
                  <span className="block w-[3px] h-[18px] rounded-full bg-[var(--brand)]" />
                  <h2 className="text-[16px] font-bold tracking-wide text-[var(--ink)]">企业文化与发展思路</h2>
                </div>
                <p className="text-[15px] leading-[1.9] text-[var(--fg-2)] mb-5">
                  四川省水利发展集团有限公司以&ldquo;夯实一个平台、做好两大任务、承担三项使命、突出四个聚焦、实现五大目标&rdquo;为总体发展工作思路，着力为全省经济社会发展大局、全省水利事业高质量发展、市县发展做好服务。
                </p>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="neu-card p-5">
                    <div className="mb-2 text-[10px] font-bold tracking-[0.2em] text-[var(--fg-3)]">总体思路</div>
                    <p className="text-[13px] leading-[1.7] text-[var(--fg-2)]">
                      夯实一个平台 · 做好两大任务 · 承担三项使命 · 突出四个聚焦 · 实现五大目标
                    </p>
                  </div>
                  <div className="neu-card p-5">
                    <div className="mb-2 text-[10px] font-bold tracking-[0.2em] text-[var(--fg-3)]">企业精神</div>
                    <p className="text-[13px] leading-[1.7] text-[var(--fg-2)]">
                      爱岗敬业 · 低调做人 · 潜心做事 · 争创一流
                    </p>
                  </div>
                </div>
              </article>
            </div>

            {/* ── 右栏：关键工程名录 — 容器归质感，子项平面列表 ── */}
            <aside className="w-[280px] shrink-0 max-lg:w-full">
              <div className="sticky top-[76px] neu-card p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="block h-1.5 w-1.5 rounded-full bg-[var(--water)]" />
                  <span className="text-[12px] font-bold tracking-[0.15em] text-[var(--ink)]">重点工程</span>
                </div>
                <div className="mb-2 h-px bg-[color-mix(in_oklch,var(--fg-2)_16%,transparent)]" />
                <div className="grid">
                  {PROJECTS.map((name, i) => (
                    <div key={name}
                      className="group -mx-2 flex items-center gap-3 rounded-[10px] px-2 py-[9px] transition-colors hover:bg-[color-mix(in_oklch,var(--brand)_6%,transparent)]">
                      <span className="text-[11px] font-semibold tabular-nums text-[var(--fg-3)] transition-colors group-hover:text-[var(--brand)]">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[13.5px] font-medium text-[var(--fg)]">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </section>
      </main>

      {/* ═══ Footer — 玻璃雾化，与首页同语汇 ═══ */}
      <footer className="footer-glass">
        <div className="flex items-center justify-between gap-3 px-[clamp(28px,4vw,72px)] py-4 max-sm:flex-col max-sm:gap-3">
          <span className="text-[11px] text-[#8a96aa]">© 2026 四川省水利发展集团有限公司</span>
          <div className="flex items-center gap-2">
            <a href="/" className="footer-link">返回首页</a>
            <a href="/contact" className="footer-link">联系我们</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
