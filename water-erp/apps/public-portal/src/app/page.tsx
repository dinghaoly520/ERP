'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Announcement } from '@/lib/types';
import {
  ChevronRight, Building2, Gavel, Shield, User, Lock, Eye, EyeOff,
  ArrowUpRight, FileText, Megaphone, Clock, Users,
} from 'lucide-react';

import { landingURL } from '@water-erp/config';

const typeDefs: Record<string, { label: string; cls: string }> = {
  BID_NOTICE:  { label: '招标公告', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  WIN_NOTICE:  { label: '中标公示', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  POLICY:      { label: '政策法规', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PLATFORM:    { label: '平台通知', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
};

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [logging, setLogging] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    api.get<{ items: Announcement[] }>('/announcements/public?pageSize=6')
      .then(res => setAnnouncements(res.items || []))
      .catch(() => {});
  }, []);

  const handleLogin = async () => {
    if (!username || !password) { toast.error('请输入用户名和密码'); return; }
    setLogging(true);
    try {
      await api.post('/auth/login', { username, password });
      const me = await api.get<{ role: string }>('/auth/me');
      const dest = landingURL(me.role);
      toast.success('登录成功，正在跳转...');
      setTimeout(() => { window.location.href = dest; }, 600);
    } catch (e: any) {
      toast.error(e.message || '登录失败，请检查用户名密码');
    }
    setLogging(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[oklch(0.982_0.003_264)]">
      {/* ── Header bar — hairline precision ── */}
      <header className="border-b border-[oklch(0.91_0.006_264)] bg-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 bg-[oklch(0.42_0.14_260)] flex items-center justify-center">
              <span className="text-white font-bold text-xs tracking-wider">水</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-bold text-[oklch(0.18_0.012_265)] text-sm tracking-tight">智慧水发</span>
              <span className="text-[oklch(0.62_0.008_264)] text-[11px] font-medium">ERP</span>
            </div>
          </a>
          <nav className="flex items-center gap-1 text-[13px] text-[oklch(0.45_0.01_264)]">
            <a href="/announcements" className="px-3 py-1.5 hover:text-[oklch(0.18_0.012_265)] transition-colors rounded-sm hover:bg-[oklch(0.97_0.008_262)]">公告</a>
            <span className="w-px h-4 bg-[oklch(0.91_0.006_264)] mx-1" />
            <a href="/login" className="px-3 py-1.5 hover:text-[oklch(0.18_0.012_265)] transition-colors rounded-sm hover:bg-[oklch(0.97_0.008_262)]">登录</a>
            <a href="/register" className="ml-2 px-4 py-1.5 bg-[oklch(0.42_0.14_260)] text-white text-[13px] font-semibold hover:bg-[oklch(0.50_0.16_258)] transition-colors tracking-tight">
              供应商注册
            </a>
          </nav>
        </div>
      </header>

      {/* ── Hero section — deep navy with precision type ── */}
      <section className="bg-[oklch(0.18_0.045_262)] text-white">
        <div className="max-w-7xl mx-auto px-6 py-20 grid grid-cols-[1fr_440px] gap-16 items-start">
          {/* Left — value proposition */}
          <div className="pt-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/[0.07] text-[11px] font-medium text-white/60 tracking-wide uppercase mb-10">
              <Building2 size={12} strokeWidth={1.5} />
              四川省水利发展集团
            </div>
            <h1 className="text-[2.75rem] font-extrabold leading-[1.08] tracking-tight mb-6" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
              智慧水发<br />
              <span className="text-white/50 font-semibold">招采ERP管理平台</span>
            </h1>
            <p className="text-[15px] text-white/50 leading-relaxed mb-12 max-w-lg">
              全流程电子化招标采购 · 专家独立评审 · AI 辅助评标
            </p>

            {/* Feature grid — technical precision */}
            <div className="grid grid-cols-4 gap-px bg-white/[0.06]">
              {[
                { icon: Gavel, label: '在线开标', sub: '加密 / 解密', stat: '5 个项目' },
                { icon: Users, label: '专家评标', sub: '独立评审', stat: '3 位在评' },
                { icon: Building2, label: '供应商库', sub: '自助服务', stat: '12 家入库' },
                { icon: Shield, label: '监督留痕', sub: '全程审计', stat: '100% 覆盖' },
              ].map((f, i) => (
                <div key={i} className="bg-white/[0.04] p-5 hover:bg-white/[0.07] transition-colors">
                  <f.icon size={18} strokeWidth={1.5} className="text-white/30 mb-3" />
                  <div className="text-[13px] font-semibold tracking-tight mb-0.5">{f.label}</div>
                  <div className="text-[11px] text-white/35 leading-relaxed">{f.sub}</div>
                  <div className="text-[11px] text-white/20 mt-3 font-mono tracking-tight">{f.stat}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — login panel */}
          <div className="bg-white text-[oklch(0.18_0.012_265)] p-8 border border-[oklch(0.91_0.006_264)]">
            <div className="mb-8">
              <h2 className="text-lg font-bold tracking-tight mb-1" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
                登录平台
              </h2>
              <p className="text-[13px] text-[oklch(0.62_0.008_264)]">使用企业账号登录</p>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.45_0.01_264)] uppercase tracking-wider mb-2">用户名</label>
                <div className="relative">
                  <User size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[oklch(0.62_0.008_264)]" />
                  <input
                    value={username} onChange={e => setUsername(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    placeholder="输入用户名"
                    className="w-full pl-9 pr-3 py-2.5 border border-[oklch(0.91_0.006_264)] text-[14px] bg-[oklch(0.992_0.001_264)] placeholder:text-[oklch(0.80_0.006_264)] focus:outline-none focus:border-[oklch(0.42_0.14_260)] hover:border-[oklch(0.62_0.01_264)] transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.45_0.01_264)] uppercase tracking-wider mb-2">密码</label>
                <div className="relative">
                  <Lock size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[oklch(0.62_0.008_264)]" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password} onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    placeholder="输入密码"
                    className="w-full pl-9 pr-10 py-2.5 border border-[oklch(0.91_0.006_264)] text-[14px] bg-[oklch(0.992_0.001_264)] placeholder:text-[oklch(0.80_0.006_264)] focus:outline-none focus:border-[oklch(0.42_0.14_260)] hover:border-[oklch(0.62_0.01_264)] transition-colors"
                  />
                  <button onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[oklch(0.55_0.008_264)] hover:text-[oklch(0.30_0.01_264)]">
                    {showPw ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
                  </button>
                </div>
              </div>

              <button
                onClick={handleLogin} disabled={logging}
                className="w-full py-2.5 bg-[oklch(0.42_0.14_260)] text-white text-[14px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                {logging ? '验证中...' : '登 录'}
                {!logging && <ChevronRight size={16} strokeWidth={2} />}
              </button>

              <div className="text-center pt-1">
                <a href="/register" className="text-[13px] text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)] font-medium tracking-tight">
                  供应商注册 →
                </a>
              </div>
            </div>

            {/* Test accounts footer */}
            <div className="mt-8 pt-6 border-t border-[oklch(0.94_0.004_264)]">
              <p className="text-[10px] text-[oklch(0.72_0.008_264)] leading-relaxed">
                <span className="font-semibold text-[oklch(0.55_0.01_264)]">测试账号</span>
                <br />admin / admin123 · supplier1 / 123456 · wangjg / 123456
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Announcements section ── */}
      <section className="max-w-7xl mx-auto px-6 py-20 w-full">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-3">
              <Megaphone size={12} strokeWidth={1.5} />
              Announcements
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
              最新公告
            </h2>
          </div>
          <button onClick={() => router.push('/announcements')}
            className="flex items-center gap-1 text-[13px] text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)] font-medium tracking-tight transition-colors">
            查看全部 <ArrowUpRight size={14} strokeWidth={1.5} />
          </button>
        </div>

        {announcements.length === 0 ? (
          <div className="border border-[oklch(0.91_0.006_264)] bg-white p-16 text-center">
            <FileText size={32} strokeWidth={1} className="text-[oklch(0.80_0.006_264)] mx-auto mb-4" />
            <p className="text-[13px] text-[oklch(0.62_0.008_264)]">暂无公告</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 border border-[oklch(0.91_0.006_264)] bg-white">
            {announcements.map((a, i) => {
              const t = typeDefs[a.type] || typeDefs.PLATFORM;
              return (
                <div
                  key={a.id}
                  onClick={() => router.push(`/announcements/${a.id}`)}
                  className={`p-5 cursor-pointer hover:bg-[oklch(0.992_0.003_264)] transition-colors group ${i % 3 !== 2 ? 'border-r border-[oklch(0.91_0.006_264)]' : ''} ${i < announcements.length - (announcements.length % 3 || 3) ? 'border-b border-[oklch(0.91_0.006_264)]' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 border tracking-wide uppercase ${t.cls}`}>
                      {t.label}
                    </span>
                    {a.isTop && (
                      <span className="text-[10px] font-bold text-[oklch(0.50_0.18_22)] bg-[oklch(0.96_0.03_22)] px-1.5 py-0.5 border border-[oklch(0.88_0.06_22)] tracking-wide">置顶</span>
                    )}
                  </div>
                  <h3 className="text-[14px] font-semibold text-[oklch(0.18_0.012_265)] mb-2 line-clamp-2 leading-snug group-hover:text-[oklch(0.42_0.14_260)] transition-colors tracking-tight">
                    {a.title}
                  </h3>
                  {a.summary && <p className="text-[12px] text-[oklch(0.62_0.008_264)] mb-3 line-clamp-1">{a.summary}</p>}
                  <div className="flex items-center gap-4 text-[11px] text-[oklch(0.72_0.008_264)]">
                    <span className="flex items-center gap-1.5">
                      <Clock size={11} strokeWidth={1.5} />
                      {a.publishDate ? new Date(a.publishDate).toLocaleDateString('zh-CN') : ''}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Eye size={11} strokeWidth={1.5} />
                      {a.viewCount}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Footer — minimal ── */}
      <footer className="border-t border-[oklch(0.91_0.006_264)] bg-white mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between text-[11px] text-[oklch(0.72_0.008_264)]">
          <span>© {new Date().getFullYear()} 四川省水利发展集团有限责任公司</span>
          <div className="flex items-center gap-4">
            <span>成都市高新区天府大道北段1700号</span>
            <span className="w-px h-3 bg-[oklch(0.91_0.006_264)]" />
            <span>028-8888-6666</span>
            <span className="w-px h-3 bg-[oklch(0.91_0.006_264)]" />
            <span>erp@scwater.com</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
