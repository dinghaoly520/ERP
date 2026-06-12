'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { landingURL } from '@water-erp/config';

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
  const heroImages = ['bg-hydro-hero-1.png','bg-hydro-hero-2.png','bg-hydro-hero-3.png','bg-hydro-hero-4.png','bg-hydro-hero-5.png','bg-hydro-hero-6.png'];

  // Hero image rotation — preload all images for smooth crossfade
  useEffect(() => {
    heroImages.forEach(src => { const img = new Image(); img.src = `/assets/${src}`; });
    const t = setInterval(() => setHeroIdx(i => (i + 1) % heroImages.length), 5000);
    return () => clearInterval(t);
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

  const announceData = [
    { // 招标公告
      color: '#064ea2', deadlineLabel: '报名截止',
      featured: {
        tag: '招标公告', date: '2026-06-10', urgent: true,
        title: '向家坝灌区北总干渠二期工程土建施工招标公告',
        desc: '本项目为向家坝灌区北总干渠二期工程，建设内容包括明渠开挖、隧洞衬砌、渡槽架设及沿线配套建筑物，总长 42.6 公里，设计灌溉面积 48.2 万亩...',
        code: 'SWZB-2026-XJB02', deadline: '2026-07-05 17:00',
      },
      list: [
        { date: '06-08', title: '紫坪铺水库大坝安全监测系统升级改造项目招标' },
        { date: '06-03', title: '都江堰灌区数字化管理平台（二期）建设项目招标' },
        { date: '05-27', title: '引大济岷工程预应力钢筒混凝土管（PCCP）采购招标' },
        { date: '05-20', title: '亭子口灌区一期工程机电设备安装施工招标公告' },
      ],
    },
    { // 中标公示
      color: '#18a56c', deadlineLabel: '公示截止',
      featured: {
        tag: '中标公示', date: '2026-06-09', urgent: false,
        title: '武都引水二期灌区工程信息化系统集成中标公示',
        desc: '经评标委员会评审，武都引水二期灌区工程信息化系统集成项目已完成评标工作，第一中标候选人为中水北方勘测设计研究有限责任公司，投标报价 3,286.50 万元，现将评标结果予以公示...',
        code: 'SWZB-2026-WDYS01', deadline: '2026-06-16 17:00',
      },
      list: [
        { date: '06-05', title: '升钟水库灌区续建配套工程监理服务中标公示' },
        { date: '05-30', title: '鲁班水库除险加固工程钢板桩围堰施工中标公示' },
        { date: '05-22', title: '小井沟水利枢纽水轮机发电机组采购中标公示' },
        { date: '05-15', title: '岷江犍为航电枢纽库区防护工程中标公示' },
      ],
    },
    { // 政策法规
      color: '#f5a623', deadlineLabel: '生效日期',
      featured: {
        tag: '政策法规', date: '2026-05-28', urgent: false,
        title: '四川省水利厅关于进一步规范水利工程招标投标活动的通知',
        desc: '为深入贯彻落实《招标投标法》及其实施条例，进一步规范我省水利工程招标投标活动，维护招标投标市场秩序，保障工程质量和安全，根据水利部有关要求，现就有关事项通知如下...',
        code: '川水发〔2026〕18号', deadline: '2026-07-01',
      },
      list: [
        { date: '05-15', title: '水利部关于修改《水利工程建设项目招标投标管理规定》的决定' },
        { date: '04-20', title: '四川省发展和改革委员会关于开展招标投标领域优化营商环境整治工作的通知' },
        { date: '03-30', title: '国务院办公厅关于创新完善体制机制推动招标投标市场规范健康发展的意见' },
        { date: '02-18', title: '水利工程建设标准强制性条文（2026年版）发布实施' },
      ],
    },
    { // 平台通知
      color: '#5a6d8a', deadlineLabel: '生效日期',
      featured: {
        tag: '平台通知', date: '2026-06-11', urgent: false,
        title: '蜀水云采平台系统升级维护公告',
        desc: '为提升平台服务质量和系统稳定性，蜀水云采电子化招标采购平台将于 2026 年 6 月 15 日（周日）02:00-06:00 进行系统升级维护。届时平台将暂停服务，请各用户提前安排好相关工作...',
        code: 'PT-2026-06-11', deadline: '2026-06-15 06:00',
      },
      list: [
        { date: '06-01', title: '关于开通电子商城集中采购功能的通知' },
        { date: '05-20', title: '蜀水云采平台供应商操作手册（2026版）更新发布' },
        { date: '05-10', title: '关于调整专家评审费发放方式的通知' },
        { date: '04-28', title: '平台数字证书（CA）办理流程变更公告' },
      ],
    },
  ];

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
      <header className="sticky top-0 z-50 h-[88px] flex items-center bg-white border-b border-[#e5ecf4]">
        <div className="w-full px-[clamp(40px,4vw,72px)] flex items-center justify-between h-full">
          {/* Brand */}
          <a href="/" className="flex items-center gap-3 shrink-0">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-14 w-auto object-contain" />
            <div className="flex flex-col gap-0">
              <strong className="text-[#123a6e] text-3xl tracking-[0.14em] leading-tight whitespace-nowrap" style={{ fontFamily: '"SimHei","黑体",sans-serif', fontWeight: 900 }}>四川水发集团</strong>
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

      <main className="bg-white">
        {/* ═══════════════════ Hero ═══════════════════ */}
        <section className="relative min-h-[clamp(380px,36vw,580px)] overflow-hidden">
          <div className="absolute inset-0 w-full" style={{
            background: 'linear-gradient(90deg,rgba(246,250,255,.95) 0%,rgba(246,250,255,.88) 35%,rgba(246,250,255,.5) 60%,rgba(246,250,255,.15) 100%)',
          }}>
            {heroImages.map((src, i) => (
              <div key={src} className="absolute inset-0 transition-opacity duration-1000 ease-in-out" style={{ background: `url('/assets/${src}') center center/cover no-repeat`, opacity: i === heroIdx ? 1 : 0 }} />
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
            <h1 className="text-[clamp(40px,3.6vw,62px)] font-black leading-[1.15] tracking-[0.10em] mb-5 hero-title" data-text="智慧水发·蜀水云采">智慧水发·蜀水云采</h1>
            <p className="text-[clamp(16px,1.2vw,20px)] text-white/80 font-medium mb-12 max-w-xl">四川省水利发展集团统一招采门户 —— 阳光透明、合规高效的电子化招标采购平台</p>
            <div className="flex gap-4">
              <button onClick={() => setModal('login')} className="hero-btn">
                我要采购
                <span className="hero-btn-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="8" x2="13" y2="8"/><polyline points="9 4 13 8 9 12"/></svg></span>
              </button>
              <button onClick={() => router.push('/announcements')} className="hero-btn-outline">
                我要投标
                <span className="hero-btn-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="8" x2="13" y2="8"/><polyline points="9 4 13 8 9 12"/></svg></span>
              </button>
            </div>
          </div>
        </section>

        {/* ═══════════════════ 快捷入口 ═══════════════════ */}
        <section className="relative z-10 py-8">
          <div className="px-[clamp(40px,4vw,72px)]">
            <div className="grid grid-cols-5 max-md:grid-cols-3 max-sm:grid-cols-2 gap-5">
              {features.map((f) => (
                <a key={f.title} href={f.href} className="flex items-center gap-4 px-5 py-4 rounded-lg hover:bg-[#f5f8fc] transition-colors group">
                  <div className="w-11 h-11 rounded-lg bg-[#eef3fb] flex items-center justify-center text-[#064ea2] shrink-0 group-hover:bg-[#064ea2] group-hover:text-white transition-colors" dangerouslySetInnerHTML={{ __html: SVG_ICONS[f.icon] }} />
                  <div>
                    <strong className="block text-[15px] font-bold text-[#1c2941]">{f.title}</strong>
                    <span className="text-xs text-[#8a96aa]">{f.desc}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════ 公告信息（主角）═══════════════════ */}
        <section className="py-14 bg-white relative z-10">
          <div className="px-[clamp(40px,4vw,72px)]">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-5">
                <h2 className="text-2xl font-black text-[#18243a]">公告</h2>
                <div className="flex gap-2">
                  {announceData.map((tab, i) => (
                    <button key={tab.featured.tag} onClick={() => setAnnounceTab(i)}
                      className="px-4 py-2 text-[13px] font-semibold rounded-lg transition-all duration-200 cursor-pointer min-h-[36px]"
                      style={i === announceTab
                        ? { color: '#fff', backgroundColor: tab.color }
                        : { color: '#5a6d8a', backgroundColor: '#e8ecf2' }
                      }>
                      {tab.featured.tag}
                    </button>
                  ))}
                </div>
              </div>
              <a href="/announcements" className="neu-link">全部公告 →</a>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Featured card — spans 2 cols */}
              <div className="lg:col-span-2 bg-white rounded-lg border border-[#e5ecf4] p-7 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center gap-2.5 mb-4">
                  <span className="text-xs font-semibold px-2.5 py-1 rounded text-white" style={{ backgroundColor: announceData[announceTab].color }}>{announceData[announceTab].featured.tag}</span>
                  <span className="text-xs text-[#999]">{announceData[announceTab].featured.date}</span>
                  {announceData[announceTab].featured.urgent && <span className="text-xs font-semibold px-2.5 py-1 rounded bg-[#fff1f0] text-[#d43030]">重要</span>}
                </div>
                <h3 className="text-xl font-bold text-[#18243a] mb-3">{announceData[announceTab].featured.title}</h3>
                <p className="text-sm text-[#666] mb-5 leading-relaxed">{announceData[announceTab].featured.desc}</p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-6 text-xs">
                    <span className="text-[#999]">项目编号 <span className="text-[#18243a] font-semibold ml-1">{announceData[announceTab].featured.code}</span></span>
                    <span className="text-[#999]">{announceData[announceTab].deadlineLabel} <em className="not-italic text-[#d43030] font-bold ml-1">{announceData[announceTab].featured.deadline}</em></span>
                  </div>
                  <a href="/announcements" className="neu-link shrink-0">查看详情 →</a>
                </div>
              </div>

              {/* Side list — 1 col */}
              <div className="bg-white rounded-lg border border-[#e5ecf4] divide-y divide-[#eef1f6]">
                {announceData[announceTab].list.map((item) => (
                  <a key={item.date} href="/announcements" className="flex flex-col gap-1.5 px-5 py-4 hover:bg-[#f9fafb] transition-colors group">
                    <span className="text-xs text-[#aaa]">{item.date}</span>
                    <span className="text-[15px] font-medium text-[#333] group-hover:text-[#064ea2] transition-colors leading-snug">{item.title}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════ 价值观 ═══════════════════ */}
        <section className="relative bg-white py-12 overflow-hidden">
          <img src="/assets/bg-waterworks-bottom.png" alt="" className="absolute inset-0 w-full h-full object-cover object-bottom opacity-90" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 40%, rgba(255,255,255,0.5) 70%, rgba(255,255,255,1) 100%)" }} />
          <div className="relative z-10 px-[clamp(40px,4vw,72px)]">
            <h2 className="text-lg font-black text-[#1a2a42] tracking-wide mb-6">携手水发　共创阳光招采新未来</h2>
            <div className="grid grid-cols-4 max-sm:grid-cols-2 gap-6">
              {cooperation.map((item, i) => (
                <div key={i} className={`flex items-center gap-4 ${i < 3 ? 'max-sm:border-r-0 border-r border-[rgba(91,119,147,.15)] pr-6' : ''}`}>
                  <div className="w-11 h-11 rounded-lg bg-white/80 flex items-center justify-center text-[#064ea2] shrink-0" dangerouslySetInnerHTML={{ __html: SVG_ICONS[item.icon] }} />
                  <div>
                    <strong className="block text-[15px] font-bold text-[#1a2a42] mb-0.5">{item.title}</strong>
                    <span className="text-xs text-[#5a6d8a]">{item.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ═══════════════════ Side Panel ═══════════════════ */}
      <div className="fixed right-5 bottom-6 z-30 flex flex-col gap-2">
        <button onClick={() => router.push('/login')} className="w-11 h-11 rounded-full bg-white text-[#064ea2] font-bold text-xs border border-[#d0dae8] shadow-sm hover:bg-[#064ea2] hover:text-white hover:border-[#064ea2] transition-colors">采购</button>
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="w-11 h-11 rounded-full bg-white text-[#064ea2] font-bold text-xs border border-[#d0dae8] shadow-sm hover:bg-[#064ea2] hover:text-white hover:border-[#064ea2] transition-colors">↑</button>
      </div>

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
                  <p className="text-xs text-[#8a9aaa] mt-2">测试: admin/admin123 · supplier1/123456</p>
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
