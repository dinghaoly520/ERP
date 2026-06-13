'use client';

import React from 'react';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { landingURL } from '@water-erp/config';
import { ANNOUNCEMENTS, fetchPublicAnnouncements, type AnnouncementItem } from '@/lib/announcements';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   智慧水发·蜀水云采 — Landing Page
   复刻自 water_erp_web/index.html 设计稿
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [logging, setLogging] = useState(false);
  const [modal, setModal] = useState<'login' | 'register' | null>(null);
  const [regForm, setRegForm] = useState({ name: '', creditCode: '', phone: '', pwd: '', contact: '' });
  const [regLoading, setRegLoading] = useState(false);
  const [heroIdx, setHeroIdx] = useState(0);
  const [announceTab, setAnnounceTab] = useState(0);
  const heroImages = ['bg-hydro-hero-1.png','bg-hydro-hero-2.png','bg-hydro-hero-3.png','bg-hydro-hero-4.png','bg-hydro-hero-5.png'];

  // Hero rotation — only render current + previous for smooth crossfade
  const [heroPrev, setHeroPrev] = useState(0);
  const [heroReady, setHeroReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let loaded = 0;
    const done = () => { if (!cancelled && !heroReady) setHeroReady(true); };
    // Preload all images; count both success and failure
    heroImages.forEach((src) => {
      const img = new Image();
      img.onload = () => { loaded++; if (loaded === heroImages.length) done(); };
      img.onerror = () => { loaded++; if (loaded === heroImages.length) done(); };
      img.src = `/assets/${src}`;
    });
    // Fallback: force ready after 3s even if preload hangs
    const fallback = setTimeout(done, 3000);
    const t = setInterval(() => {
      setHeroPrev(i => i); // keep previous
      setHeroIdx(i => { setHeroPrev(i); return (i + 1) % heroImages.length; });
    }, 6000);
    return () => { cancelled = true; clearTimeout(fallback); clearInterval(t); };
  }, []);

  const handleLogin = async () => {
    if (!username || !password) { toast.error('请输入用户名和密码'); return; }
    setLogging(true);
    try {
      await api.post('/auth/login', { username, password });
      const me = await api.get<{ role: string }>('/auth/me');
      toast.success('登录成功，正在跳转...');
      setTimeout(() => { window.location.href = landingURL(me.role); }, 600);
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

  // 从后端 API 获取公告数据，失败时使用本地兜底
  const [fetchedAnnouncements, setFetchedAnnouncements] = useState<AnnouncementItem[]>(ANNOUNCEMENTS);
  useEffect(() => {
    fetchPublicAnnouncements({ pageSize: 20 })
      .then(data => { if (data.items.length > 0) setFetchedAnnouncements(data.items); })
      .catch(() => { /* keep fallback */ });
  }, []);

  // 从数据按类型分组
  const typeGroups = ['BID_NOTICE', 'WIN_NOTICE', 'POLICY', 'PLATFORM'];
  const announceData = typeGroups.map(type => {
    const items = fetchedAnnouncements.filter(a => a.type === type);
    const first = items[0] || ANNOUNCEMENTS.find(a => a.type === type);
    if (!first) return null;
    return {
      color: first.color,
      deadlineLabel: first.deadlineLabel,
      featured: { tag: first.tag, date: first.date, urgent: first.urgent, title: first.title, desc: first.desc, code: first.code, deadline: first.deadline, id: first.id },
      list: items.slice(1).map(a => ({ date: a.date.slice(5), title: a.title, id: a.id })),
    };
  }).filter(Boolean) as { color: string; deadlineLabel: string; featured: { tag: string; date: string; urgent: boolean; title: string; desc: string; code: string; deadline: string; id: string }; list: { date: string; title: string; id: string }[] }[];

  const features = [
    { icon: 'file', title: '智慧水发·采购中心', desc: '采购文件编制、项目管理、AI协同', href: 'http://192.168.1.111:3001' },
    { icon: 'cart', title: '电子商城', desc: '集中采购目录', href: 'http://localhost:3002' },
    { icon: 'share', title: '供应商端', desc: '供应商注册、投标、反馈', href: 'http://localhost:3003' },
    { icon: 'users', title: '采购管理端', desc: '信息发布、供应商管理、专家管理', href: 'http://localhost:3004' },
    { icon: 'safe', title: '在线开评标系统', desc: '在线开标、专家评审、监督归档', href: 'http://localhost:3005' },
  ];


  const cooperation = [
    { icon: 'sun',     title: '阳光透明', desc: '公开公平公正，流程全程可追溯' },
    { icon: 'shield',  title: '合规高效', desc: '规范业务流程，提升采购效率' },
    { icon: 'heart',   title: '互信共赢', desc: '阳光透明合作，互信互利共赢' },
    { icon: 'star',    title: '价值创造', desc: '优化资源配置，创造更大价值' },
  ];

  return (
    <div className="min-h-screen text-[#18243a] bg-white overflow-x-hidden" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      {/* ═══════════════════ Header ═══════════════════ */}
      <header className="sticky top-0 z-50 h-[88px] flex items-center bg-white border-b border-[#e5ecf4]" style={{ willChange: 'transform' }}>
        <div className="w-full px-[clamp(40px,4vw,72px)] flex items-center justify-between h-full">
          {/* Brand */}
          <a href="/" className="flex items-center gap-3 shrink-0">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-14 w-auto object-contain" />
            <div className="flex flex-col gap-0">
              <strong className="text-[#123a6e] text-3xl tracking-[0.14em] leading-tight whitespace-nowrap" style={{ fontFamily: '"SimHei","黑体","Heiti SC","STHeiti",sans-serif', fontWeight: 900, textShadow: '0 0 1px #123a6e, 0 0 1px #123a6e' }}>四川水发集团</strong>
              <small className="text-[7px] text-[#8a96aa] font-medium text-center whitespace-nowrap tracking-wide">SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.</small>
            </div>
          </a>

          {/* Actions */}
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={() => setModal('login')}
              className="h-11 px-6 border border-[#c5d3e8] text-[#064ea2] bg-white rounded-full text-sm font-semibold hover:bg-[#064ea2] hover:text-white hover:border-[#064ea2] hover:shadow-[0_2px_8px_rgba(6,78,162,.25)] active:scale-95 transition-all duration-200">
              登录
            </button>
            <button onClick={() => setModal('register')}
              className="h-11 px-6 bg-[#064ea2] text-white rounded-full text-sm font-semibold hover:bg-[#084fb0] hover:shadow-[0_2px_12px_rgba(6,78,162,.35)] active:scale-95 transition-all duration-200">
              注册
            </button>
          </div>
        </div>
      </header>

      <main className="bg-[#f5f7fa]">
        {/* ═══════════════════ Hero ═══════════════════ */}
        <section className="relative min-h-[clamp(380px,36vw,580px)] overflow-hidden bg-[#0b3d7a]">
          {/* Gradient base — sits BEHIND images, only visible during transitions */}
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(90deg,rgba(246,250,255,.95) 0%,rgba(246,250,255,.88) 35%,rgba(246,250,255,.5) 60%,rgba(246,250,255,.15) 100%)',
          }}>
            {/* Only render current + previous image for smooth crossfade */}
            {[heroPrev, heroIdx].map((idx, layer) => (
              <img
                key={`${idx}-${layer}`}
                src={`/assets/${heroImages[idx]}`}
                alt=""
                loading={idx === 0 ? 'eager' : 'lazy'}
                fetchPriority={idx === heroIdx ? 'high' : 'low'}
                decoding={idx === 0 ? 'sync' : 'async'}
                className={`absolute inset-0 w-full h-full object-cover hero-img ${idx === heroIdx && heroReady ? 'hero-img-active' : 'hero-img-hidden'}`}
              />
            ))}
          </div>

          {/* Dot switchers */}
          <div className="absolute right-6 bottom-16 z-10 flex gap-1.5">
            {heroImages.map((_, i) => (
              <button key={i} onClick={() => setHeroIdx(i)}
                className={`h-1 rounded-full transition-all duration-300 ${i === heroIdx ? 'w-8 bg-[#064ea2]' : 'w-4 bg-white/50 hover:bg-white/80'}`} />
            ))}
          </div>

          {/* Bottom curve */}
          <div className="absolute left-[-8%] right-[-8%] bottom-[clamp(-50px,-3.5vw,-24px)] h-[clamp(70px,6vw,120px)] bg-white rounded-[50%_50%_0_0/76%_76%_0_0] z-10" />
          <div className="absolute left-[-8%] right-[-8%] bottom-[clamp(-50px,-3.5vw,-24px)] h-[clamp(70px,6vw,120px)] bg-transparent border-t-[clamp(3px,.4vw,6px)] border-r-[clamp(3px,.5vw,8px)] border-t-[#0b59ad] border-r-[#18a56c] rounded-[50%_50%_0_0/76%_76%_0_0] z-20 pointer-events-none" />

          <div className="relative z-20 px-[clamp(40px,4vw,72px)] py-[clamp(56px,5vw,96px)]">
            <h1 className="text-[clamp(40px,3.6vw,62px)] font-black leading-[1.15] tracking-[0.10em] mb-5 hero-title">智慧水发·蜀水云采</h1>
            <p className="text-[clamp(16px,1.2vw,20px)] text-white/80 font-medium mb-12 max-w-xl">四川省水利发展集团统一招采门户 —— 阳光透明、合规高效的电子化招标采购平台</p>
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
        <section className="relative z-10 py-8 bg-white">
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
                      <strong className="text-[15px] font-bold text-[#1c2941] group-hover:text-[#064ea2] transition-colors whitespace-nowrap">{f.title}</strong>
                      <span className="text-xs text-[#8a96aa] group-hover:text-[#5a7da8] transition-colors">{f.desc}</span>
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
        <section className="announce-section relative z-10 overflow-hidden">
          {/* 装饰背景 */}
          <div className="announce-deco-grid" />
          <div className="announce-deco-glow" />

          <div className="relative z-10 px-[clamp(40px,4vw,72px)]">
            {/* ── 标题栏 ── */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-5">
                <div className="announce-title-group">
                  <div className="announce-title-accent" />
                  <h2 className="text-2xl font-black text-[#18243a]">公告</h2>
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              {/* Featured card — spans 2 cols */}
              <a href={`/announcements/${announceData[announceTab].featured.id}`}
                className="announce-featured lg:col-span-2 group"
                style={{ '--card-color': announceData[announceTab].color } as React.CSSProperties}>
                <div className="announce-featured-border" />
                <div className="announce-featured-inner">
                  {/* 标签行 */}
                  <div className="flex items-center gap-2.5 mb-4">
                    <span className="announce-tag" style={{ backgroundColor: announceData[announceTab].color }}>{announceData[announceTab].featured.tag}</span>
                    <span className="text-xs text-[#999]">{announceData[announceTab].featured.date}</span>
                    {announceData[announceTab].featured.urgent && (
                      <span className="announce-tag-urgent">
                        <span className="announce-tag-urgent-dot" />
                        重要
                      </span>
                    )}
                  </div>
                  {/* 标题 */}
                  <h3 className="announce-featured-title">{announceData[announceTab].featured.title}</h3>
                  {/* 描述 */}
                  <p className="announce-featured-desc">{announceData[announceTab].featured.desc}</p>
                  {/* 底部元信息 */}
                  <div className="flex items-center justify-between mt-auto">
                    <div className="flex gap-6 text-xs">
                      <span className="announce-meta">项目编号 <span className="announce-meta-val">{announceData[announceTab].featured.code}</span></span>
                      <span className="announce-meta">{announceData[announceTab].deadlineLabel} <em className="announce-deadline">{announceData[announceTab].featured.deadline}</em></span>
                    </div>
                    <span className="announce-detail-btn">查看详情</span>
                  </div>
                </div>
              </a>

              {/* Side list — 1 col */}
              <div className="announce-side">
                <div className="announce-side-header">
                  <span className="announce-side-title">最新公告</span>
                  <span className="announce-side-count">{announceData[announceTab].list.length} 条</span>
                </div>
                <div className="announce-side-list">
                  {announceData[announceTab].list.map((item, idx) => (
                    <a key={item.date} href={`/announcements/${item.id}`}
                      className="announce-side-item group"
                      style={{ '--item-delay': `${idx * 60}ms` } as React.CSSProperties}>
                      <div className="announce-side-item-rank">{String(idx + 1).padStart(2, '0')}</div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                        <span className="text-xs text-[#aaa]">{item.date}</span>
                        <span className="announce-side-item-title">{item.title}</span>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════ 价值观 ═══════════════════ */}
        <section className="relative bg-white py-12 overflow-hidden">
          <img src="/assets/bg-waterworks-bottom.png" alt="" className="absolute inset-0 w-full h-full object-cover object-bottom opacity-90" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 40%, rgba(255,255,255,0.5) 70%, rgba(255,255,255,1) 100%)" }} />
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
      </main>

      {/* ═══════════════════ 置顶按钮 ═══════════════════ */}
      <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="back-to-top">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
      </button>

      {/* ═══════════════════ Modal ═══════════════════ */}
      {modal && (
        <div className="fixed inset-0 z-[100] flex" onClick={() => setModal(null)}>
          <div className="absolute inset-0 bg-[rgba(3,17,38,.46)] backdrop-blur-sm" />
          <div className="relative m-auto w-[min(620px,calc(100vw-36px))] max-h-[86vh] overflow-auto bg-white rounded-[10px] shadow-[0_30px_90px_rgba(0,0,0,.26)] p-[34px]" onClick={e => e.stopPropagation()}>
            <button onClick={() => setModal(null)} className="absolute right-4 top-2.5 w-9 h-9 text-[26px] text-[#7d8798] hover:text-[#064ea2]">×</button>

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
