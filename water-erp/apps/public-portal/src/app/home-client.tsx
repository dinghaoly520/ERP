'use client';

import React from 'react';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { landingURL, portalURL } from '@water-erp/config';
import { fetchPublicAnnouncements, type AnnouncementItem } from '@/lib/announcements';
import GradientText from '@/components/GradientText';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   智慧水发·蜀水云采 — Landing Page
   复刻自 water_erp_web/index.html 设计稿
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function HomeClient({ initialAnnouncements }: { initialAnnouncements: AnnouncementItem[] }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [logging, setLogging] = useState(false);
  const [modal, setModal] = useState<'login' | 'register' | null>(null);
  const [regForm, setRegForm] = useState({ name: '', creditCode: '', phone: '', pwd: '', contact: '' });
  const [regLoading, setRegLoading] = useState(false);
  const [announceTab, setAnnounceTab] = useState(0);
  // BG 图库（16张），按12小时窗口内随机轮播5张，全天自动刷新
  const heroImages = useMemo(() => {
    const BG_POOL = [
      'swdg-mascot-bg-03-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-04-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-05-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-06-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-07-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-08-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-10-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-11-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-13-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-14-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-15-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-16-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-17-1920x580-real.png',
      'swdg-mascot-bg-18-helmet-tip-v3-1920x580-real.png',
      'swdg-mascot-bg-19-helmet-tip-v3-1920x580-real.png',
    ];
    const HOURS = 12;
    const period = Math.floor(Date.now() / (HOURS * 60 * 60 * 1000));
    let seed = period;
    const next = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pool = [...BG_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 5).map(f => `BG/${f}`);
  }, []);

  const handleLogin = async () => {
    if (!username || !password) { toast.error('请输入用户名和密码'); return; }
    setLogging(true);
    try {
      // 登录响应已含 role；公共门户带 X-Portal: public，/auth/me 会找 token_public（不存在）→ 401，
      // 故直接用登录返回的 role 跳转，不再单独请求 /auth/me。
      const { role } = await api.post<{ role: string }>('/auth/login', { username, password });
      setTimeout(() => { window.location.href = landingURL(role); }, 600);
    } catch (e: any) { toast.error(e.message || '登录失败'); }
    setLogging(false);
  };

  const handleRegister = async () => {
    const f = regForm;
    if (!f.name || !f.creditCode || !f.phone || !f.pwd) { toast.error('请填写完整信息'); return; }
    if (f.pwd.length < 6) { toast.error('密码不少于6位'); return; }
    setRegLoading(true);
    try {
      await api.post('/supplier/register', {
        name: f.name, creditCode: f.creditCode, enterpriseType: '有限责任公司',
        legalPerson: f.contact || f.name, registeredAddress: '', businessScope: '',
        username: f.phone, displayName: f.contact || f.name, password: f.pwd,
        contacts: [{ name: f.contact || f.name, phone: f.phone, isPrimary: true }],
        qualifications: [],
      });
      toast.success('注册成功！请登录'); setModal(null);
    } catch (e: any) { toast.error(e.message || '注册失败'); }
    setRegLoading(false);
  };

  // 从后端 API 按公告类型分别获取，避免全局分页导致各类型数量不均
  const typeGroups = useMemo(() => ['BID_NOTICE', 'WIN_NOTICE', 'POLICY', 'PLATFORM'], []);
  const [fetchedAnnouncements, setFetchedAnnouncements] = useState<AnnouncementItem[]>(initialAnnouncements);
  const hasInitialData = useRef(initialAnnouncements.length > 0);
  const [announcementsLoading, setAnnouncementsLoading] = useState(initialAnnouncements.length === 0);
  const [announcementsError, setAnnouncementsError] = useState(false);
  const loadAnnouncements = useCallback(() => {
    setAnnouncementsLoading(true);
    // allSettled：单个类型失败不影响其它类型；刷新为空时保留已有(服务端)数据，不清空
    Promise.allSettled(typeGroups.map(type => fetchPublicAnnouncements({ type, pageSize: 5 })))
      .then(results => {
        const items = results.map(r => (r.status === 'fulfilled' ? r.value.items : [])).flat();
        if (items.length > 0) { setFetchedAnnouncements(items); setAnnouncementsError(false); }
        else setAnnouncementsError(true);
      })
      .catch(() => setAnnouncementsError(true))
      .finally(() => setAnnouncementsLoading(false));
  }, []);

  useEffect(() => {
    // 已有服务端预取数据时：force-dynamic 已通过 RSC 提供最新数据，
    // 不立即静默刷新——否则客户端导航(router.push)到首页时，二轮 fetch 会与
    // React reconciliation / 事件绑定产生竞态，导致公告区 tab 点击失效。
    // 仅在页面重新可见（切回标签页 / bfcache 恢复）时刷新，保证数据不过时。
    if (hasInitialData.current) {
      const refresh = () => {
        if (document.visibilityState !== 'visible') return;
        Promise.allSettled(typeGroups.map(type => fetchPublicAnnouncements({ type, pageSize: 5 })))
          .then(results => {
            const items = results.map(r => (r.status === 'fulfilled' ? r.value.items : [])).flat();
            if (items.length > 0) setFetchedAnnouncements(items);
          })
          .catch(() => { /* 静默失败，保留已有数据 */ });
      };
      document.addEventListener('visibilitychange', refresh);
      window.addEventListener('pageshow', refresh);
      return () => {
        document.removeEventListener('visibilitychange', refresh);
        window.removeEventListener('pageshow', refresh);
      };
    }
    // 无服务端预取数据时：立即加载 + 注册可见性监听
    loadAnnouncements();
    // 浏览器后退(bfcache 恢复)与切回标签页时都重新拉取
    const onShow = () => loadAnnouncements();
    const onVisibility = () => { if (document.visibilityState === 'visible') loadAnnouncements(); };
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadAnnouncements, typeGroups]);

  // 从数据按类型分组（仅展示数据库中的真实数据，不使用本地兜底）
  const announceData = typeGroups.map(type => {
    const items = fetchedAnnouncements.filter(a => a.type === type);
    const first = items[0];
    if (!first) return null;
    return {
      color: first.color,
      deadlineLabel: first.deadlineLabel,
      featured: { tag: first.tag, date: first.date, urgent: first.urgent, title: first.title, desc: first.desc, content: first.content, aiSummary: first.aiSummary, code: first.code, deadline: first.deadline, id: first.id },
      list: items.slice(1, 5).map(a => ({ date: a.date.slice(5), title: a.title, id: a.id })),
    };
  }).filter(Boolean) as { color: string; deadlineLabel: string; featured: { tag: string; date: string; urgent: boolean; title: string; desc: string; content: string; aiSummary?: string; code: string; deadline: string; id: string }; list: { date: string; title: string; id: string }[] }[];

  // 当前选中类型（安全访问：加载中或数据为空时为 undefined）
  const currentAnnounce = announceData.length > 0
    ? announceData[Math.min(announceTab, announceData.length - 1)]
    : undefined;

  // 数据变化后校正越界的 tab 索引
  useEffect(() => {
    if (announceData.length > 0 && announceTab >= announceData.length) setAnnounceTab(0);
  }, [announceData.length, announceTab]);

  const features = [
    { icon: 'file', title: '智慧水发·采购中心', desc: '采购文件编制、项目管理、AI协同', href: portalURL('web') },
    { icon: 'cart', title: '电子商城', desc: '集中采购目录', href: portalURL('mall', '/login?forceLogin=1') },
    { icon: 'share', title: '供应商端', desc: '供应商注册、投标、反馈', href: portalURL('supplier', '/login?forceLogin=1') },
    { icon: 'users', title: '采购管理端', desc: '信息发布、供应商管理、专家管理', href: portalURL('web', '/login?forceLogin=1') },
    { icon: 'safe', title: '在线开评标系统', desc: '在线开标、专家评审、监督归档', href: portalURL('expert', '/login?forceLogin=1') },
  ];


  const cooperation = [
    { icon: 'sun',     title: '阳光透明', desc: '公开公平公正，流程全程可追溯' },
    { icon: 'shield',  title: '合规高效', desc: '规范业务流程，提升采购效率' },
    { icon: 'heart',   title: '互信共赢', desc: '阳光透明合作，互信互利共赢' },
    { icon: 'star',    title: '价值创造', desc: '优化资源配置，创造更大价值' },
  ];

  return (
    <div className="flow-page text-[#18243a] overflow-x-hidden" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <FlowBackdrop />
      {/* ═══════════════════ Header · 统一顶栏 ═══════════════════ */}
      <UnifiedHeader
        announcements={fetchedAnnouncements}
        onLoginClick={() => setModal('login')}
        onRegisterClick={() => setModal('register')}
      />

      <main>
        {/* ═══════════════════ Hero ═══════════════════ */}
        <section className="relative min-h-[clamp(380px,36vw,580px)] overflow-hidden bg-[#0b3d7a]">
          {/* Gradient base — sits BEHIND images, only visible during transitions */}
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(90deg,rgba(246,250,255,.95) 0%,rgba(246,250,255,.88) 35%,rgba(246,250,255,.5) 60%,rgba(246,250,255,.15) 100%)',
          }}>
            {heroImages.map((src, i) => (
              <img
                key={src}
                src={`/assets/${src}`}
                alt=""
                fetchPriority={i === 0 ? 'high' : 'low'}
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover hero-slide"
              />
            ))}
          </div>

          {/* Dot switchers */}
          <div className="absolute right-6 bottom-16 z-10 flex gap-1.5">
            {heroImages.map((_, i) => (
              <span key={i} className="hero-dot" />
            ))}
          </div>

          {/* Bottom curve */}
          <div className="absolute left-[-8%] right-[-8%] bottom-[clamp(-50px,-3.5vw,-24px)] h-[clamp(70px,6vw,120px)] rounded-[50%_50%_0_0/76%_76%_0_0] z-10" style={{ background: 'oklch(0.975 0.012 258)' }} />
          <div className="absolute left-[-8%] right-[-8%] bottom-[clamp(-50px,-3.5vw,-24px)] h-[clamp(70px,6vw,120px)] bg-transparent border-t-[clamp(3px,.4vw,6px)] border-r-[clamp(3px,.5vw,8px)] border-t-[#0b59ad] border-r-[#18a56c] rounded-[50%_50%_0_0/76%_76%_0_0] z-20 pointer-events-none" />

          <div className="relative z-20 px-[clamp(40px,4vw,72px)] py-[clamp(56px,5vw,96px)]">
            <GradientText
              colors={['#ffffff', '#d0e4ff', '#c0f0e4', '#e0d8ff', '#ffffff']}
              animationSpeed={8}
              direction="horizontal"
              yoyo={true}
              className="mb-5"
            >
              <h1 className="text-[clamp(40px,3.6vw,62px)] font-black leading-[1.15] tracking-[0.10em] m-0">智慧水发·蜀水云采</h1>
            </GradientText>
            <p className="text-[clamp(16px,1.2vw,20px)] text-white/80 font-medium mb-12 max-w-xl">四川省水利发展集团有限公司统一招采门户 —— 阳光透明、合规高效的电子化招标采购平台</p>
            <div className="flex gap-4">
              <button onClick={() => router.push('/procurement-portal')} className="hero-btn">
                我要采购
              </button>
              <button onClick={() => router.push('/bidding-hall')} className="hero-btn-outline">
                我要投标
              </button>
            </div>
          </div>
        </section>

        {/* ═══════════════════ 快捷入口 ═══════════════════ */}
        <section className="relative z-10 py-8">
          <div className="px-[clamp(40px,4vw,72px)]">
            <div className="flex items-stretch">
              {features.map((f, idx) => (
                <React.Fragment key={f.title}>
                  <a href={f.href} target="_blank" rel="noopener noreferrer"
                    className="flex-1 relative flex items-center gap-3.5 px-4 py-3.5 rounded-xl no-underline text-inherit overflow-hidden group"
                    style={{ transition: 'transform 0.4s cubic-bezier(0.16,1,0.3,1), box-shadow 0.4s ease, background 0.3s ease' }}
                    onMouseMove={e => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      e.currentTarget.style.setProperty('--glow-x', `${e.clientX - rect.left}px`);
                      e.currentTarget.style.setProperty('--glow-y', `${e.clientY - rect.top}px`);
                      e.currentTarget.style.transform = 'translateY(-3px)';
                      e.currentTarget.style.background = 'linear-gradient(135deg,#f5f8fc,#eef3fb)';
                      e.currentTarget.style.boxShadow = '0 8px 28px rgba(6,78,162,0.08),0 2px 8px rgba(6,78,162,0.04)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = '';
                      e.currentTarget.style.background = '';
                      e.currentTarget.style.boxShadow = '';
                    }}>
                    {/* 悬停光晕 */}
                    <div className="feature-card-glow" />
                    {/* 图标 */}
                    <div className="relative w-11 h-11 shrink-0">
                      <div className="feature-icon-ring" />
                      <div className="w-full h-full rounded-[10px] bg-[#eef3fb] text-[#064ea2] flex items-center justify-center group-hover:bg-[#064ea2] group-hover:text-white transition-all duration-300" dangerouslySetInnerHTML={{ __html: SVG_ICONS[f.icon] }} />
                    </div>
                    {/* 文字 */}
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <strong className="text-[17px] font-bold text-[#1c2941] group-hover:text-[#064ea2] transition-colors whitespace-nowrap">{f.title}</strong>
                      <span className="text-[13px] text-[#8a96aa] group-hover:text-[#5a7da8] transition-colors">{f.desc}</span>
                    </div>
                    {/* 右侧箭头指示 */}
                    <span className="feature-card-arrow">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </span>
                  </a>
                  {idx < features.length - 1 && <div className="feature-divider" />}
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════ 公告信息（主角）═══════════════════ */}
        <section className="relative z-10 py-14 overflow-hidden">
          <div className="relative z-10 px-[clamp(40px,4vw,72px)]">
            {/* ── 标题栏 ── */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-5">
                <div className="announce-title-group">
                  <div className="announce-title-accent" />
                  <h2 className="text-[26px] font-black text-[#18243a]">公告</h2>
                </div>
                <div className="announce-tabs">
                  {announceData.map((tab, i) => (
                    <button key={tab.featured.tag} onClick={() => setAnnounceTab(i)}
                      className={`announce-tab ${i === announceTab ? 'is-active' : ''}`}
                      style={i === announceTab ? { '--tab-color': tab.color, color: '#fff', backgroundColor: tab.color } as React.CSSProperties : undefined}>
                      <span className="announce-tab-dot" style={i === announceTab ? { backgroundColor: '#fff' } : { backgroundColor: tab.color }} />
                      {tab.featured.tag}
                    </button>
                  ))}
                </div>
              </div>
              <a href="/announcements" className="announce-view-all">
                全部公告
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="announce-view-all-arrow"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </a>
            </div>

            {/* ── 内容网格 ── */}
            {currentAnnounce ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              {/* Featured card — spans 2 cols */}
              <a href={`/announcements/${currentAnnounce.featured.id}`}
                className="announce-featured lg:col-span-2 group"
                style={{ '--card-color': currentAnnounce.color } as React.CSSProperties}>
                <div className="announce-featured-border" />
                <div className="announce-featured-inner">
                  {/* 标签行 */}
                  <div className="flex items-center gap-2.5 mb-4">
                    <span className="announce-tag" style={{ backgroundColor: currentAnnounce.color }}>{currentAnnounce.featured.tag}</span>
                    <span className="text-xs text-[#999]">{currentAnnounce.featured.date}</span>
                    {currentAnnounce.featured.urgent && (
                      <span className="announce-tag-urgent">
                        <span className="announce-tag-urgent-dot" />
                        重要
                      </span>
                    )}
                  </div>
                  {/* 标题 */}
                  <h3 className="announce-featured-title">{currentAnnounce.featured.title}</h3>
                  {/* 正文预览 */}
                  <p className="announce-featured-content-preview">
                    {currentAnnounce.featured.aiSummary || currentAnnounce.featured.desc || currentAnnounce.featured.content.replace(/<h2>.*?<\/h2>/g, '').replace(/<[^>]+>/g, '').trim().slice(0, 320)}
                  </p>
                  {/* 底部元信息 */}
                  <div className="flex items-center justify-between mt-auto">
                    <div className="flex gap-6 text-xs">
                      <span className="announce-meta">项目编号 <span className="announce-meta-val">{currentAnnounce.featured.code}</span></span>
                      {currentAnnounce.featured.deadline && (
                        <span className="announce-meta">{currentAnnounce.deadlineLabel} <em className="announce-deadline">{currentAnnounce.featured.deadline}</em></span>
                      )}
                    </div>
                    <span className="announce-detail-btn">查看详情</span>
                  </div>
                </div>
              </a>

              {/* Side list — 1 col */}
              <div className="announce-side">
                <div className="announce-side-header">
                  <span className="announce-side-title">最新公告</span>
                  <span className="announce-side-count">共 {currentAnnounce.list.length + 1} 项</span>
                </div>
                <div className="announce-side-list">
                  {currentAnnounce.list.map((item, idx) => (
                    <a key={item.id} href={`/announcements/${item.id}`}
                      className="announce-side-item group"
                      style={{ '--item-delay': `${idx * 60}ms`, '--rank-color': currentAnnounce.color } as React.CSSProperties}>
                      <div className="announce-side-item-rank">{String(idx + 1).padStart(2, '0')}</div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                        <span className="text-[13px] text-[#aaa]">{item.date}</span>
                        <span className="announce-side-item-title">{item.title}</span>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
            ) : announcementsLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                <div className="lg:col-span-2 h-[300px] rounded-xl bg-[#eef3fb] animate-pulse" />
                <div className="h-[300px] rounded-xl bg-[#eef3fb] animate-pulse" />
              </div>
            ) : announcementsError ? (
              <div className="h-[200px] flex flex-col items-center justify-center gap-3 text-[#9aa6b8] text-sm">
                <span>公告加载失败</span>
                <button onClick={loadAnnouncements} className="h-9 px-5 bg-[#064ea2] text-white rounded-full text-xs font-semibold hover:bg-[#084fb0] transition-colors">重新加载</button>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-[#9aa6b8] text-sm">暂无公告</div>
            )}
          </div>
        </section>

        {/* ═══════════════════ 价值观 ═══════════════════ */}
        <section className="relative py-12 overflow-hidden">
          <img src="/assets/bg-waterworks-bottom.png" alt="" className="absolute inset-0 w-full h-full object-cover object-bottom opacity-50" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, transparent 0%, oklch(0.975,0.012,258/0.6) 60%, oklch(0.975,0.012,258/0.95) 100%)" }} />
          <div className="relative z-10 px-[clamp(40px,4vw,72px)]">
            <h2 className="value-title">携手水发　共创阳光招采新未来</h2>
            <div className="flex items-stretch max-sm:grid max-sm:grid-cols-2 max-sm:gap-4">
              {cooperation.map((item, i) => (
                <React.Fragment key={i}>
                  <div className="flex-1 flex items-center gap-4">
                    <div className="value-icon" dangerouslySetInnerHTML={{ __html: SVG_ICONS[item.icon] }} />
                    <div>
                      <strong className="value-item-title">{item.title}</strong>
                      <span className="value-item-desc">{item.desc}</span>
                    </div>
                  </div>
                  {i < cooperation.length - 1 && <div className="value-divider" />}
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════ 友情链接 · Footer ═══════════════════ */}
        <footer className="bg-[#0b3d7a]">
          {/* 顶部分割线 — 1px hairline，与 Hero 同色系闭合 */}
          <div className="h-px bg-[#064ea2]" />

          <div className="px-[clamp(40px,4vw,72px)]">
            {/* ── 友情链接 ── */}
            <div className="flex items-center justify-center max-sm:flex-col max-sm:py-5 max-sm:gap-3">
              <div className="flex items-center gap-2.5 select-none pr-8 max-sm:pr-0">
                <span className="block w-1 h-1 bg-white/60" />
                <span className="text-[11px] font-bold tracking-[0.25em] text-white/60">友情链接</span>
              </div>
              <a href="https://slt.sc.gov.cn/" target="_blank" rel="noopener noreferrer"
                className="px-6 py-5 text-[14px] text-white hover:text-white transition-colors duration-200">
                四川省水利厅
              </a>
              <span className="w-px h-4 bg-white/[0.10] max-sm:hidden" />
              <a href="https://www.scsfjt.com/" target="_blank" rel="noopener noreferrer"
                className="px-6 py-5 text-[14px] text-white hover:text-white transition-colors duration-200">
                四川省水利发展集团有限公司
              </a>
              <span className="w-px h-4 bg-white/[0.10] max-sm:hidden" />
              <a href="https://www.scswhi.com.cn/" target="_blank" rel="noopener noreferrer"
                className="px-6 py-5 text-[14px] text-white hover:text-white transition-colors duration-200">
                四川水发勘测设计研究有限公司
              </a>
            </div>

            {/* ── 底部信息带 ── */}
            <div className="border-t border-white/[0.07] py-3 flex items-center justify-between text-[11px] text-white max-sm:flex-col max-sm:gap-1">
              <span>© 2026 智慧水发·蜀水云采</span>
              <span>蜀ICP备XXXXXXXX号</span>
            </div>
          </div>
        </footer>
      </main>

      {/* ═══════════════════ 置顶按钮 ═══════════════════ */}
      <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="back-to-top">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
      </button>

      {/* ═══════════════════ Modal ═══════════════════ */}
      {modal && (
        <div className="fixed inset-0 z-[100] flex" onClick={() => setModal(null)}>
          <div className="absolute inset-0 bg-[rgba(3,17,38,.46)] backdrop-blur-sm" />
          <div className="relative m-auto w-[min(620px,calc(100vw-36px))] max-h-[86vh] overflow-auto glass rounded-[10px] shadow-[0_30px_90px_rgba(0,0,0,.26)] p-[34px]" onClick={e => e.stopPropagation()}>
            <button onClick={() => setModal(null)} className="absolute right-4 top-2.5 w-9 h-9 text-[26px] text-[#7d8798] hover:text-[#0891a0]">×</button>

            {modal === 'login' ? (
              <>
                <h3 className="text-2xl font-bold text-[#063f82] mb-2.5">登录平台</h3>
                <p className="text-[#526075] leading-relaxed mb-4">智慧水发·蜀水云采</p>
                <div className="grid gap-3.5">
                  <label className="grid gap-[7px] text-[13px] font-extrabold text-[#26364e]">
                    用户名
                    <input value={username} onChange={e => setUsername(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleLogin()}
                      className="h-[42px] border border-[#d2deed] rounded px-3 outline-none focus:border-[#0d65c8] focus:shadow-[0_0_0_3px_rgba(13,101,200,.11)]" placeholder="请输入用户名" />
                  </label>
                  <label className="grid gap-[7px] text-[13px] font-extrabold text-[#26364e]">
                    密码
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleLogin()}
                      className="h-[42px] border border-[#d2deed] rounded px-3 outline-none focus:border-[#0d65c8] focus:shadow-[0_0_0_3px_rgba(13,101,200,.11)]" placeholder="请输入密码" />
                  </label>
                  <div className="flex gap-3 mt-5">
                    <button onClick={handleLogin} disabled={logging}
                      className="h-[42px] px-6 bg-[#064ea2] text-white rounded font-bold text-sm hover:bg-[#043f88] transition-colors">
                      {logging ? '登录中...' : '登 录'}
                    </button>
                    <button onClick={() => setModal(null)} className="h-[42px] px-6 border border-[#d2deed] text-[#526075] rounded font-bold text-sm hover:bg-[#f8fbff]">取消</button>
                  </div>
                  <p className="text-xs text-[#8a9aaa] mt-2">测试: caigou/caigou@2026 · supplier1/supplier1@2026 · wangjg/wangjg@2026</p>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-2xl font-bold text-[#063f82] mb-2.5">供应商注册</h3>
                <div className="steps mb-5">{['填写信息','提交审核','审核通过','正式入驻'].map(s => <span key={s}>{s}</span>)}</div>
                <div className="grid gap-3.5">
                  <label className="grid gap-[7px] text-[13px] font-extrabold text-[#26364e]">
                    企业名称 *
                    <input value={regForm.name} onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))}
                      className="h-[42px] border border-[#d2deed] rounded px-3 outline-none focus:border-[#0d65c8] focus:shadow-[0_0_0_3px_rgba(13,101,200,.11)]" placeholder="营业执照上的企业全称" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-[7px] text-[13px] font-extrabold text-[#26364e]">
                      统一社会信用代码 *
                      <input value={regForm.creditCode} onChange={e => setRegForm(f => ({ ...f, creditCode: e.target.value }))}
                        className="h-[42px] border border-[#d2deed] rounded px-3 outline-none focus:border-[#0d65c8] focus:shadow-[0_0_0_3px_rgba(13,101,200,.11)]" placeholder="18位信用代码" />
                    </label>
                    <label className="grid gap-[7px] text-[13px] font-extrabold text-[#26364e]">
                      手机号 *
                      <input value={regForm.phone} onChange={e => setRegForm(f => ({ ...f, phone: e.target.value }))}
                        className="h-[42px] border border-[#d2deed] rounded px-3 outline-none focus:border-[#0d65c8] focus:shadow-[0_0_0_3px_rgba(13,101,200,.11)]" placeholder="联系电话" />
                    </label>
                  </div>
                  <label className="grid gap-[7px] text-[13px] font-extrabold text-[#26364e]">
                    联系人
                    <input value={regForm.contact} onChange={e => setRegForm(f => ({ ...f, contact: e.target.value }))}
                      className="h-[42px] border border-[#d2deed] rounded px-3 outline-none focus:border-[#0d65c8] focus:shadow-[0_0_0_3px_rgba(13,101,200,.11)]" placeholder="企业联系人姓名" />
                  </label>
                  <label className="grid gap-[7px] text-[13px] font-extrabold text-[#26364e]">
                    密码 *
                    <input type="password" value={regForm.pwd} onChange={e => setRegForm(f => ({ ...f, pwd: e.target.value }))}
                      className="h-[42px] border border-[#d2deed] rounded px-3 outline-none focus:border-[#0d65c8] focus:shadow-[0_0_0_3px_rgba(13,101,200,.11)]" placeholder="不少于6位" />
                  </label>
                  <div className="flex gap-3 mt-5">
                    <button onClick={handleRegister} disabled={regLoading}
                      className="h-[42px] px-6 bg-[#064ea2] text-white rounded font-bold text-sm hover:bg-[#043f88] transition-colors">
                      {regLoading ? '提交中...' : '提交注册'}
                    </button>
                    <button onClick={() => setModal(null)} className="h-[42px] px-6 border border-[#d2deed] text-[#526075] rounded font-bold text-sm hover:bg-[#f8fbff]">取消</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ━━━━ SVG Icons ━━━━ */
const S = 'width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const SVG_ICONS: Record<string, string> = {
  file: `<svg viewBox="0 0 24 24" ${S}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" ${S}><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
  share: `<svg viewBox="0 0 24 24" ${S}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
  users: `<svg viewBox="0 0 24 24" ${S}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  safe: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" ${S}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" ${S}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  star: `<svg viewBox="0 0 24 24" ${S}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
};
