'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   帮助中心 — 常见问题与使用指引
   视觉风格与首页 / procurement-portal 保持一致
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

type FAQItem = {
  id: string;
  q: string;
  a: string;
};

type FAQCategory = {
  icon: string;
  title: string;
  color: string;
  items: FAQItem[];
};

const FAQ_CATEGORIES: FAQCategory[] = [
  {
    icon: 'user',
    title: '注册与登录',
    color: '#7ec8e3',
    items: [
      { id: 'reg-1', q: '如何注册成为供应商？', a: '点击首页右上角"注册"按钮，填写企业名称、统一社会信用代码、联系人及手机号等信息并提交。审核通过后即可登录供应商门户参与投标。' },
      { id: 'reg-2', q: '忘记密码怎么办？', a: '请联系平台管理员或在登录弹窗点击"忘记密码"，按提示通过注册手机号重置密码。' },
      { id: 'reg-3', q: '一个企业可以注册多个账号吗？', a: '每个企业原则上使用一个主账号，如有多个部门需要独立操作，可联系管理员开通子账号。' },
      { id: 'reg-4', q: '登录后为什么跳转到了不同门户？', a: '系统根据用户角色自动路由：供应商→供应商门户，采购人员→采购管理工作台，专家→专家门户，确保各角色进入专属工作台。' },
    ],
  },
  {
    icon: 'bid',
    title: '投标与开标',
    color: '#a3d9a5',
    items: [
      { id: 'bid-1', q: '如何查找招标公告？', a: '在首页"公告"区域切换"招标公告"标签浏览，或点击"全部公告"进入完整列表。也可在顶栏搜索框输入项目名称或编号快速检索。' },
      { id: 'bid-2', q: '投标文件如何加密上传？', a: '供应商在投标截止时间前于供应商门户上传加密标书，开标时由主持人发起远程解密，全程音视频留痕。' },
      { id: 'bid-3', q: '开标时间到了还能提交吗？', a: '不可以。投标截止时间以系统服务器时间为准，逾期提交通道自动关闭。建议提前 30 分钟完成上传。' },
      { id: 'bid-4', q: '解密失败怎么办？', a: '若解密异常，主持人会按应急流程处理。供应商应保持网络畅通，并按监督人指引重新尝试或提交备用标书。' },
    ],
  },
  {
    icon: 'proc',
    title: '采购与商城',
    color: '#f9c7a1',
    items: [
      { id: 'proc-1', q: '采购需求如何提交？', a: '需求部门登录采购管理工作台，在"需求申报"环节在线提交品目、预算与实施时间，系统自动生成需求台账。' },
      { id: 'proc-2', q: '电子商城和集中采购有什么区别？', a: '电子商城面向已入目录的标准化商品，支持快速下单；集中采购针对大宗或定制需求，走完整招标流程。' },
      { id: 'proc-3', q: '如何查看采购进度？', a: '在采购管理工作台的"采购全流程图谱"中可实时查看从需求申报到合同归档的 9 个阶段进度。' },
    ],
  },
  {
    icon: 'exp',
    title: '专家评审',
    color: '#c4b5e3',
    items: [
      { id: 'exp-1', q: '专家如何参与评标？', a: '被抽取的专家登录专家门户后，依次完成身份核验、标书获取、辅助评标、独立打分、报告确认五个步骤。' },
      { id: 'exp-2', q: '评审期间需要注意什么？', a: '评审全程独立进行，禁止与投标人或其他专家私下交流。系统开启 AI 异常检测，实时预警围标串标与报价异常。' },
      { id: 'exp-3', q: '打分提交后还能修改吗？', a: '在评审报告最终确认前，专家可修改自己的打分。一旦提交报告即锁定，如需更正须联系监督人申请重开。' },
    ],
  },
  {
    icon: 'tech',
    title: '系统与技术',
    color: '#7dd3d6',
    items: [
      { id: 'tech-1', q: '支持哪些浏览器？', a: '推荐使用 Chrome 100+ 或 Edge 100+，暂不支持 IE。请保持浏览器更新以获得最佳体验。' },
      { id: 'tech-2', q: '上传文件大小有限制吗？', a: '单个文件上限 50MB，支持 PDF、DOC、DOCX、XLS、XLSX 等常见格式。超大文件建议拆分后上传。' },
      { id: 'tech-3', q: '遇到系统故障怎么办？', a: '请截图保存错误信息，拨打技术支持热线或发送邮件至 support@scsf.com.cn，我们将在 2 小时内响应。' },
    ],
  },
  {
    icon: 'pol',
    title: '政策与合规',
    color: '#f5a3b7',
    items: [
      { id: 'pol-1', q: '采购流程依据哪些法规？', a: '本平台严格遵循《中华人民共和国政府采购法》《招标投标法》及四川省相关实施细则，确保流程合法合规。' },
      { id: 'pol-2', q: '如何对采购结果提出异议？', a: '在定标公示期内，供应商可通过公告详情页的"提出异议"入口提交书面异议，采购人将在法定期限内书面答复。' },
    ],
  },
];

const FAQ_SVG: Record<string, string> = {
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  bid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>',
  proc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  exp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  tech: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  pol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l3 1m0 0l-3 9a5 5 0 0 0 6 0L6 7m6 0l2 1m0 0l-2 9a5 5 0 0 0 6 0l-2-10M12 7V4"/><circle cx="12" cy="3" r="0.5"/></svg>',
};

export default function HelpPage() {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(`${FAQ_CATEGORIES[0].id}-${FAQ_CATEGORIES[0].items[0].id}`);
  const [activeCategory, setActiveCategory] = useState(0);

  const toggle = (key: string) => setExpanded(prev => (prev === key ? null : key));
  const currentCategory = FAQ_CATEGORIES[activeCategory];

  return (
    <div className="flow-page text-[#18243a]" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <FlowBackdrop />
      <UnifiedHeader announcements={[]} onLoginClick={() => router.push('/')} onRegisterClick={() => router.push('/')} />

      {/* ═══════════════════ 返回首页 ═══════════════════ */}
      <div className="relative z-10 px-[clamp(28px,4vw,72px)] pt-3">
        <a href="/" className="flow-back">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          返回首页
        </a>
      </div>

      {/* ═══════════════════ 页面标题 ═══════════════════ */}
      <section className="relative z-10 px-[clamp(28px,4vw,72px)] pt-6 pb-2 flow-rise-1">
        <div className="announce-title-group">
          <div className="announce-title-accent" />
          <h1 className="text-[clamp(28px,2.5vw,40px)] font-black text-[#18243a] m-0">帮助中心</h1>
        </div>
        <p className="text-[15px] text-[#5a6d8a] mt-3 leading-relaxed">
          查阅常见问题与操作指引。如未找到答案，请通过下方联系方式与我们沟通。
        </p>
      </section>

      {/* ═══════════════════ 分类标签 + FAQ 卡片区 ═══════════════════ */}
      <section className="relative z-10 px-[clamp(28px,4vw,72px)] py-8">
        {/* 分类 Tabs — 复用 announce-tabs 视觉语言 */}
        <div className="announce-tabs mb-8 flow-rise-2">
          {FAQ_CATEGORIES.map((cat, i) => (
            <button
              key={cat.title}
              onClick={() => { setActiveCategory(i); setExpanded(`${cat.id}-${cat.items[0].id}`); }}
              className={`announce-tab ${i === activeCategory ? 'is-active' : ''}`}
              style={i === activeCategory
                ? { '--tab-color': cat.color, color: '#fff', backgroundColor: cat.color } as React.CSSProperties
                : undefined}
            >
              <span className="announce-tab-dot" style={i === activeCategory ? { backgroundColor: '#fff' } : { backgroundColor: cat.color }} />
              {cat.title}
            </button>
          ))}
        </div>

        {/* FAQ 卡片列表 — 使用 neu-card 凸起卡片 */}
        <div className="flex flex-col gap-4 max-w-3xl flow-rise-3">
          {currentCategory.items.map((item, idx) => {
            const key = `${currentCategory.id}-${item.id}`;
            const isOpen = expanded === key;
            return (
              <div key={item.id} className="neu-card p-0 overflow-hidden">
                <button
                  onClick={() => toggle(key)}
                  className="w-full flex items-center gap-4 px-6 py-5 text-left border-0 bg-transparent cursor-pointer"
                  style={{ fontFamily: 'inherit' }}
                >
                  {/* 图标圆框 */}
                  <span
                    className="shrink-0 w-10 h-10 rounded-[10px] flex items-center justify-center transition-colors duration-300"
                    style={{
                      backgroundColor: isOpen ? currentCategory.color : '#eef3fb',
                      color: isOpen ? '#fff' : currentCategory.color,
                    }}
                  >
                    <span className="block w-5 h-5" dangerouslySetInnerHTML={{ __html: FAQ_SVG[currentCategory.icon] }} />
                  </span>
                  {/* 问题文本 */}
                  <span className="flex-1 text-[15px] font-bold text-[#1c2941] leading-snug">{item.q}</span>
                  {/* 展开指示箭头 */}
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className="shrink-0 text-[#8a96aa] transition-transform duration-300"
                    style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {/* 答案区 — 展开时显示 */}
                <div
                  className="overflow-hidden transition-all duration-300 ease-out"
                  style={{ maxHeight: isOpen ? '300px' : '0px', opacity: isOpen ? 1 : 0 }}
                >
                  <div className="px-6 pb-5 pl-20">
                    <p className="text-[14px] text-[#526075] leading-[1.8] m-0">{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ═══════════════════ 底部联系 CTA ═══════════════════ */}
      <section className="relative z-10 px-[clamp(28px,4vw,72px)] pb-16">
        <div className="flow-cta flow-rise-4">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <h3 className="text-[22px] font-black text-[#18243a] m-0 mb-1">仍有疑问？</h3>
              <p className="text-[14px] text-[#526075] m-0">技术支持团队随时为您提供帮助</p>
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <span className="text-[14px] text-[#526075]">
                <strong className="text-[#064ea2] font-bold">技术热线</strong>　400-XXX-XXXX
              </span>
              <span className="text-[14px] text-[#526075]">
                <strong className="text-[#064ea2] font-bold">邮箱</strong>　support@scsf.com.cn
              </span>
              <a href="/" className="flow-cta-btn">
                返回首页
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="8" x2="13" y2="8" />
                  <polyline points="9 4 13 8 9 12" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
