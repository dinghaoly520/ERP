'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   电子商城 · 登录页 — "Showroom"
   明亮、商业感、对角线分割
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function MallLoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.password) { toast.error('请输入用户名和密码'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.error) { toast.error(data.error); setLoading(false); return; }
      toast.success('登录成功');
      router.push('/');
    } catch {
      toast.error('请求失败，请重试');
    }
    setLoading(false);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#061427] text-white" style={{ fontFamily: '\"Microsoft YaHei\",\"PingFang SC\",Arial,sans-serif' }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(34,211,238,0.22),transparent_30%),radial-gradient(circle_at_78%_72%,rgba(232,132,44,0.24),transparent_26%),linear-gradient(135deg,#061427_0%,#08244a_52%,#050b18_100%)]" />
      <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(125,211,252,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,0.12)_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className="absolute left-[8%] top-[18%] hidden h-64 w-64 rounded-full border border-cyan-300/20 lg:block" />
      <div className="absolute bottom-16 left-[10%] hidden w-[460px] grid-cols-2 gap-3 opacity-80 lg:grid">
        {['管材目录', '钢材采购', '机电设备', '工程服务'].map((item, index) => (
          <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl backdrop-blur-md" style={{ transform: `translateY(${index % 2 ? 18 : 0}px)` }}>
            <div className="mb-3 h-1.5 w-12 rounded-full bg-[#e8842c] shadow-[0_0_20px_rgba(232,132,44,0.55)]" />
            <div className="text-sm font-bold text-white/90">{item}</div>
            <div className="mt-1 text-xs text-white/42">集中目录 · 透明采购</div>
          </div>
        ))}
      </div>

      <main className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <section className="flex flex-1 flex-col justify-between px-7 py-8 sm:px-10 lg:px-16 xl:px-24">
          <div className="flex items-center gap-4">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-12 w-auto rounded-xl border border-white/12 object-cover shadow-[0_0_32px_rgba(34,211,238,0.16)]" />
            <div>
              <div className="text-lg font-black tracking-[0.16em]">四川水发集团</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.28em] text-cyan-100/45">Sichuan Water Development Group</div>
            </div>
          </div>

          <div className="my-16 max-w-2xl lg:my-0">
            <div className="mb-5 inline-flex rounded-full border border-[#e8842c]/30 bg-[#e8842c]/10 px-4 py-1.5 text-xs font-bold tracking-[0.22em] text-orange-200">B2B PROCUREMENT MALL</div>
            <h1 className="text-[clamp(40px,5vw,72px)] font-black leading-[1.02] tracking-tight" style={{ fontFamily: '\"SimHei\",\"黑体\",sans-serif' }}>
              蜀水云采<br />电子商城
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-300/78">集中采购目录 · 一站式水利工程物资采购平台</p>
            <div className="mt-9 grid max-w-xl gap-3 sm:grid-cols-3">
              {['集中目录', '透明价格', '品质溯源'].map(item => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm font-semibold text-white/86 backdrop-blur-md">
                  <span className="mr-2 inline-block h-2 w-2 rotate-45 bg-[#e8842c] shadow-[0_0_14px_rgba(232,132,44,0.8)]" />{item}
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-white/35">智慧水发 · 蜀水云采 · 安全可信的企业采购入口</div>
        </section>

        <section className="flex w-full items-center justify-center px-6 pb-10 lg:w-[480px] lg:px-12 lg:py-0">
          <div className="w-full max-w-sm rounded-[28px] border border-cyan-100/16 bg-[#081428]/72 p-7 shadow-[0_30px_100px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-9">
            <div className="mb-8">
              <div className="mb-3 h-1 w-14 rounded-full bg-gradient-to-r from-[#e8842c] to-[#22d3ee]" />
              <h2 className="text-2xl font-black" style={{ fontFamily: '\"SimHei\",\"黑体\",sans-serif' }}>登录电子商城</h2>
              <p className="mt-2 text-sm text-slate-300/65">进入水利工程物资采购平台</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/55">用户名</span>
                <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="请输入用户名" className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.07] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-cyan-300/70 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)]" />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/55">密码</span>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="请输入密码" className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.07] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-cyan-300/70 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)]" />
              </label>
              <button type="submit" disabled={loading} className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#064ea2] via-[#0ea5e9] to-[#22d3ee] text-sm font-black tracking-[0.18em] text-white shadow-[0_18px_45px_rgba(14,165,233,0.28)] transition hover:brightness-110 disabled:opacity-45">
                {loading ? '登录中...' : '进入商城'}
              </button>
            </form>

            <a href="http://localhost:3006" className="mt-7 inline-flex text-xs font-semibold text-cyan-100/55 transition hover:text-cyan-100" style={{ textDecoration: 'none' }}>← 返回门户</a>
          </div>
        </section>
      </main>
    </div>
  );
}
