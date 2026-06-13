'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { landingURL } from '@water-erp/config';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   在线开评标系统 · 登录页 — Light Minimal · 紫色系
   支持专家登录 / 管理员登录双 Tab
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

type Tab = 'expert' | 'admin';

/** 管理员 Tab 接受的 web 端角色（与后端 portal-cookie 的 ROLE_PORTAL 对齐） */
const WEB_ROLES = ['admin', 'bid_host', 'procurement_staff'];

const TAB_CONFIG: Record<Tab, {
  title: string;
  subtitle: string;
  accountLabel: string;
  userPlaceholder: string;
  hint: string;
  button: string;
  defaults: { username: string; password: string };
}> = {
  expert: {
    title: '专家登录',
    subtitle: '进入在线开评标工作台',
    accountLabel: '专家账号',
    userPlaceholder: '请输入专家账户',
    hint: 'wangjg / wangjg@2026',
    button: '进入开评标系统',
    defaults: { username: 'wangjg', password: 'wangjg@2026' },
  },
  admin: {
    title: '管理员登录',
    subtitle: '进入管理后台',
    accountLabel: '管理员账号',
    userPlaceholder: '请输入管理员账户',
    hint: 'caigou / caigou@2026 · lizhuren / lizhuren@2026',
    button: '进入管理后台',
    defaults: { username: 'caigou', password: 'caigou@2026' },
  },
};

export default function ExpertLoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('expert');
  const [form, setForm] = useState({ ...TAB_CONFIG.expert.defaults });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('forceLogin') !== '1') return;
    fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Portal': 'expert' }, credentials: 'include' });
  }, []);

  const switchTab = (next: Tab) => {
    setTab(next);
    setForm({ ...TAB_CONFIG[next].defaults });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.password) { toast.error('请输入用户名和密码'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Portal': 'expert' },
        credentials: 'include',
        body: JSON.stringify({ username: form.username, password: form.password }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as any).error || '登录失败'); }
      // role 直接取登录响应：本页发 X-Portal:expert，/auth/me 会读 token_expert，
      // 而管理员登录拿到的是 token_web（按角色命名），读不到。登录响应本身已含 role。
      const { role } = (await res.json()) as { role: string };
      if (tab === 'expert') {
        if (role === 'bid_expert') { toast.success('登录成功'); router.push('/'); }
        else toast.error('非专家账户，请使用专家账号登录');
      } else if (WEB_ROLES.includes(role)) {
        toast.success('登录成功，正在跳转管理后台...');
        window.location.href = landingURL(role); // admin/bid_host → :3007/bid 开评标管理端；procurement_staff → :3004/dashboard 采购工作台
      } else {
        toast.error('请使用管理员账号登录');
      }
    } catch (e: any) {
      toast.error(e.message || '登录失败');
    }
    setLoading(false);
  };

  const cfg = TAB_CONFIG[tab];

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#f6f9fd] text-slate-900" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(6,78,162,0.12),transparent_30%),radial-gradient(circle_at_84%_78%,rgba(139,92,246,0.16),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white to-transparent" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:px-12">
        <section className="flex max-w-2xl flex-col justify-center py-8 lg:py-0">
          <div className="mb-16 flex items-center gap-4 lg:mb-24">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-12 w-auto rounded-2xl border border-purple-100 bg-white object-cover shadow-sm" />
            <div>
              <div className="text-lg font-black tracking-[0.16em] text-slate-950" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>四川水发集团</div>
              <div className="mt-1 text-xs font-medium tracking-[0.22em] text-slate-500">智慧水发 · 蜀水云采</div>
            </div>
          </div>
          <div>
            <div className="mb-5 inline-flex rounded-full border border-purple-300 bg-purple-50 px-4 py-1.5 text-xs font-bold tracking-[0.18em] text-[#7c3aed]">ONLINE BID OPENING & EVALUATION</div>
            <h1 className="text-[clamp(34px,5vw,64px)] font-black leading-tight tracking-tight text-slate-950" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>在线开评标系统</h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-600">独立评审 · 在线评分 · 全程留痕</p>
            <div className="mt-8 flex flex-wrap gap-3">
              {['独立评审', '智能辅助', '过程留痕'].map(item => (
                <span key={item} className="rounded-full border border-purple-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#8b5cf6]" />{item}
                </span>
              ))}
            </div>
          </div>
        </section>
        <section className="flex w-full justify-center py-8 lg:w-[460px] lg:py-0">
          <div className="w-full max-w-md rounded-[28px] border border-purple-100 bg-white/95 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur sm:p-10">
            {/* Tab 切换 */}
            <div className="mb-6 flex gap-1 rounded-2xl bg-slate-100 p-1">
              {(['expert', 'admin'] as Tab[]).map(t => (
                <button key={t} type="button" onClick={() => switchTab(t)}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${tab === t ? 'bg-white text-[#7c3aed] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {TAB_CONFIG[t].title}
                </button>
              ))}
            </div>
            <div className="mb-8">
              <div className="mb-4 h-1 w-12 rounded-full bg-[#8b5cf6]" />
              <h2 className="text-2xl font-black text-slate-950" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>{cfg.title}</h2>
              <p className="mt-2 text-sm text-slate-500">{cfg.subtitle}</p>
            </div>
            <form onSubmit={handleLogin} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">{cfg.accountLabel}</span>
                <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder={cfg.userPlaceholder} className="h-12 w-full rounded-2xl border border-[#d7e3f2] bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#8b5cf6] focus:ring-4 focus:ring-purple-100" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">密码</span>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="请输入密码" className="h-12 w-full rounded-2xl border border-[#d7e3f2] bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#8b5cf6] focus:ring-4 focus:ring-purple-100" />
              </label>
              <button type="submit" disabled={loading} className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#064ea2] to-[#8b5cf6] text-sm font-black tracking-[0.12em] text-white shadow-[0_16px_36px_rgba(139,92,246,0.25)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45">
                {loading ? '验证中...' : cfg.button}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-slate-400">测试账号：{cfg.hint}</p>
            <a href="http://localhost:3006" className="mt-7 inline-flex text-sm font-semibold text-slate-500 transition hover:text-[#8b5cf6]" style={{ textDecoration: 'none' }}>← 返回门户</a>
          </div>
        </section>
      </main>
    </div>
  );
}
