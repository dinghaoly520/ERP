'use client';

import { useRouter } from 'next/navigation';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   帮助中心 — /help
   复用首页的 UnifiedHeader + FlowBackdrop 视觉骨架
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const FAQS = [
  {
    icon: 'register',
    category: '账户与注册',
    title: '如何注册成为平台供应商？',
    desc: '点击首页右上角「注册」按钮，填写企业名称、统一社会信用代码、联系人及手机号等信息，提交后等待审核通过即可正式入驻。',
  },
  {
    icon: 'login',
    category: '登录与账户',
    title: '忘记登录密码怎么办？',
    desc: '请在登录弹窗中联系平台管理员重置密码，或通过注册手机号验证身份后自助找回。初始密码为「用户名@2026」格式。',
  },
  {
    icon: 'bid',
    category: '投标流程',
    title: '如何参与项目投标？',
    desc: '登录供应商门户后，在「投标机会」中浏览公告，下载招标文件，按规定时间前提交加密投标文件即可参与投标。',
  },
  {
    icon: 'document',
    category: '采购文件',
    title: '招标文件在哪里下载？',
    desc: '在公告详情页或供应商门户的项目列表中，点击对应项目即可下载招标文件。部分文件可能需要登录后才可访问。',
  },
  {
    icon: 'score',
    category: '评标与结果',
    title: '如何查看评标结果？',
    desc: '评标结束后，中标结果将在首页「公告」栏的「中标公告」中公示。供应商也可登录后在投标记录中查看项目进度。',
  },
  {
    icon: 'contact',
    category: '联系方式',
    title: '遇到问题如何联系客服？',
    desc: '您可通过「水叮当智能助手」（:3008）获取 7×24 小时在线 AI 咨询，或在工作日拨打平台服务热线联系采购管理部门。',
  },
];

const SVG_ICONS: Record<string, string> = {
  register: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
  login: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
  bid: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  document: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>`,
  score: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  contact: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
};

export default function HelpPage() {
  const router = useRouter();

  return (
    <div
      className="flow-page text-[#18243a] overflow-x-hidden"
      style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}
    >
      <FlowBackdrop />

      {/* ═══════════════════ Header · 统一顶栏 ═══════════════════ */}
      <UnifiedHeader announcements={[]} onLoginClick={() => {}} onRegisterClick={() => {}} />

      {/* ═══════════════════ 返回首页按钮 ═══════════════════ */}
      <div className="relative z-10 px-[clamp(28px,4vw,72px)] pt-3">
        <button
          onClick={() => router.push('/')}
          className="flow-back inline-flex items-center gap-1.5"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flow-back-arrow"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          返回首页
        </button>
      </div>

      {/* ═══════════════════ 页面标题区 ═══════════════════ */}
      <section className="relative z-10 px-[clamp(40px,4vw,72px)] pt-10 pb-8">
        <div className="announce-title-group mb-3">
          <div className="announce-title-accent" />
          <h2 className="text-[26px] font-black text-[#18243a]">帮助中心</h2>
        </div>
        <p className="text-[15px] text-[#526075] leading-relaxed max-w-2xl">
          在这里您可以找到关于平台注册、登录、投标、采购等常见问题的解答。如未能解决您的问题，请联系在线客服或拨打服务热线。
        </p>
      </section>

      {/* ═══════════════════ FAQ 卡片网格 ═══════════════════ */}
      <section className="relative z-10 px-[clamp(40px,4vw,72px)] pb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FAQS.map((faq) => (
            <div
              key={faq.title}
              className="help-faq-card group relative rounded-2xl bg-white border border-[#e3eaf3] p-6 overflow-hidden transition-all duration-300 hover:border-[#064ea2]/40 hover:shadow-[0_12px_40px_rgba(6,78,162,0.10)]"
            >
              {/* 顶部图标 + 分类标签 */}
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-[#eef3fb] text-[#064ea2] flex items-center justify-center transition-all duration-300 group-hover:bg-[#064ea2] group-hover:text-white">
                  <div
                    className="w-6 h-6"
                    dangerouslySetInnerHTML={{ __html: SVG_ICONS[faq.icon] }}
                  />
                </div>
                <span className="text-[12px] font-bold text-[#064ea2] bg-[#eef3fb] px-3 py-1 rounded-full">
                  {faq.category}
                </span>
              </div>

              {/* 问题标题 */}
              <h3 className="text-[17px] font-bold text-[#1c2941] mb-2 leading-snug group-hover:text-[#064ea2] transition-colors">
                {faq.title}
              </h3>

              {/* 答案描述 */}
              <p className="text-[14px] text-[#8a96aa] leading-relaxed">
                {faq.desc}
              </p>

              {/* 底部渐变装饰线 */}
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#0b59ad] to-[#18a56c] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
          ))}
        </div>

        {/* ═══════════════════ 底部 CTA ═══════════════════ */}
        <div className="flow-cta flow-rise-4 mt-10">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <div>
              <h3 className="text-[20px] font-bold text-[#1c2941]">没有找到答案？</h3>
              <p className="text-[14px] text-[#526075] mt-1">
                水叮当智能助手 7×24 小时在线为您解答，或返回首页探索更多功能。
              </p>
            </div>
            <div className="flex gap-3">
              <a
                href="http://localhost:3008"
                target="_blank"
                rel="noopener noreferrer"
                className="h-[42px] px-6 bg-[#064ea2] text-white rounded font-bold text-sm hover:bg-[#043f88] transition-colors inline-flex items-center"
              >
                咨询智能助手
              </a>
              <button
                onClick={() => router.push('/')}
                className="h-[42px] px-6 border border-[#d2deed] text-[#526075] rounded font-bold text-sm hover:bg-[#f8fbff] transition-colors"
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
