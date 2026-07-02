'use client';

import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

/* ═══════════════════════════════════════
   集团简介 — 四川水发集团
   布局策略：统一顶栏 → 标题 → 数据条(full-bleed) → 正文双栏(reading col + project sidebar)
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
    <div className="flow-page" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <FlowBackdrop />
      {/* ═══ 统一顶栏 ═══ */}
      <UnifiedHeader announcements={[]} onLoginClick={() => {}} onRegisterClick={() => {}} />

      <main className="relative z-10">
        {/* ═══ Stats Bar — 全宽 ═══ */}
      <section className="px-[clamp(28px,4vw,72px)] pt-3">
        <a href="/" className="flow-back inline-flex items-center gap-1.5 mb-[clamp(24px,2.5vw,36px)]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          返回首页
        </a>
        {/* 标题 */}
        <div className="mb-[clamp(28px,3vw,40px)] text-center">
          <h1 className="text-[clamp(28px,3vw,40px)] font-black text-[#18243a] mb-1.5" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>集团简介</h1>
          <p className="text-sm text-[#8a96aa]">四川省属重点国有企业，水利事业高质量发展的重要力量</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 border-b border-[#eef1f6]">
          {STATS.map((s, i) => (
            <div key={s.label} className={`flex flex-col items-center py-5 px-2 ${i < STATS.length - 1 ? 'sm:border-r border-[#eef1f6]' : ''}`}>
              <div className="flex items-baseline gap-0.5 mb-1">
                <span className="text-[clamp(22px,2vw,30px)] font-black text-[#064ea2] tracking-tight"
                  style={{ fontFamily: "'SF Mono','Menlo',ui-monospace,monospace" }}>
                  {s.value}
                </span>
                <span className="text-[12px] font-bold text-[#8a96aa]">{s.unit}</span>
              </div>
              <span className="text-[11px] font-semibold text-[#94a3b8] tracking-wider">{s.label}</span>
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
                <span className="block w-[3px] h-[18px] bg-[#064ea2]" />
                <h2 className="text-[16px] font-bold text-[#0f1e36] tracking-wide">集团概况</h2>
              </div>
              <p className="text-[15px] leading-[1.9] text-[#3d5068]">
                四川水发集团是四川省人民政府授权水利厅代履行出资人职责的省属重点国有企业，于
                <strong className="text-[#0f1e36] font-semibold">2020年7月29日</strong>
                挂牌成立，注册资本
                <strong className="text-[#0f1e36] font-semibold">60亿元</strong>
                ，
                <strong className="text-[#0f1e36] font-semibold">AAA级</strong>
                信用评级。截至2025年底，资产总额逾
                <strong className="text-[#0f1e36] font-semibold">300亿元</strong>
                ，实际管理控股及参股下属企业共计
                <strong className="text-[#0f1e36] font-semibold">61户</strong>
                ，在职职工
                <strong className="text-[#0f1e36] font-semibold">5,200余人</strong>
                。
              </p>
            </article>

            {/* 战略使命 */}
            <article className="mb-10">
              <div className="flex items-center gap-2.5 mb-4">
                <span className="block w-[3px] h-[18px] bg-[#064ea2]" />
                <h2 className="text-[16px] font-bold text-[#0f1e36] tracking-wide">战略使命</h2>
              </div>
              <p className="text-[15px] leading-[1.9] text-[#3d5068]">
                四川水发集团着力围绕成渝地区双城经济圈建设和&ldquo;四化同步、城乡融合、五区共兴&rdquo;发展战略，加快推进新时期四川水利高质量发展落地落实，牵头实施跨市（州）重大水利工程，是四川省跨市（州）重大水利工程项目的规划、设计、投资、建设、运维、管理以及发展水利特色产业的平台和重要抓手。
              </p>
            </article>

            {/* 企业文化 */}
            <article>
              <div className="flex items-center gap-2.5 mb-4">
                <span className="block w-[3px] h-[18px] bg-[#064ea2]" />
                <h2 className="text-[16px] font-bold text-[#0f1e36] tracking-wide">企业文化与发展思路</h2>
              </div>
              <p className="text-[15px] leading-[1.9] text-[#3d5068] mb-5">
                四川水发集团以&ldquo;夯实一个平台、做好两大任务、承担三项使命、突出四个聚焦、实现五大目标&rdquo;为总体发展工作思路，着力为全省经济社会发展大局、全省水利事业高质量发展、市县发展做好服务。
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="glass rounded-xl p-5">
                  <div className="text-[10px] font-bold tracking-[0.2em] text-[#94a3b8] mb-2">总体思路</div>
                  <p className="text-[13px] leading-[1.7] text-[#3d5068]">
                    夯实一个平台 · 做好两大任务 · 承担三项使命 · 突出四个聚焦 · 实现五大目标
                  </p>
                </div>
                <div className="glass rounded-xl p-5">
                  <div className="text-[10px] font-bold tracking-[0.2em] text-[#94a3b8] mb-2">企业精神</div>
                  <p className="text-[13px] leading-[1.7] text-[#3d5068]">
                    爱岗敬业 · 低调做人 · 潜心做事 · 争创一流
                  </p>
                </div>
              </div>
            </article>
          </div>

          {/* ── 右栏：关键工程侧边栏 — 窄列，利用原本的空白区域 ── */}
          <aside className="w-[280px] shrink-0 max-lg:w-full">
            <div className="sticky top-[76px]">
              <div className="mb-4">
                <span className="text-[10px] font-bold tracking-[0.2em] text-[#94a3b8]">重点工程</span>
              </div>
              <div className="grid gap-2">
                {PROJECTS.map(name => (
                  <div key={name}
                    className="flex items-center gap-2.5 px-4 py-2.5 glass rounded-lg hover:border-[#c4d6ee] transition-colors duration-200">
                    <span className="block w-1.5 h-1.5 rounded-sm bg-[#c4d6ee] shrink-0" />
                    <span className="text-[14px] font-medium text-[#1c314d]">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>

      </main>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-[#eef1f6] bg-[#fafbfc]">
        <div className="px-[clamp(28px,4vw,72px)] py-5 flex items-center justify-between text-[12px] text-[#8a96aa] max-sm:flex-col max-sm:gap-1.5">
          <span>© 2026 四川水发集团</span>
          <div className="flex items-center gap-4">
            <a href="/" className="hover:text-[#064ea2] transition-colors">返回首页</a>
            <a href="/contact" className="hover:text-[#064ea2] transition-colors">联系我们</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
