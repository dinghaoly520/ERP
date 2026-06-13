'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   电子商城 · 登录页 — Light Minimal
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function MallLoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: 'mall', password: 'mall@2026' });
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.password) { toast.error('请输入用户名和密码'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Portal': 'mall' },
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
    <div
      className="relative min-h-screen overflow-x-hidden bg-[#f6f9fd] text-slate-900"
      style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(6,78,162,0.12),transparent_30%),radial-gradient(circle_at_84%_78%,rgba(232,132,44,0.13),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white to-transparent" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:px-12">
        <section className="flex max-w-2xl flex-col justify-center py-8 lg:py-0">
          <div className="mb-16 flex items-center gap-4 lg:mb-24">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-12 w-auto rounded-2xl border border-blue-100 bg-white object-cover shadow-sm" />
            <div>
              <div className="text-lg font-black tracking-[0.16em] text-slate-950" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>四川水发集团</div>
              <div className="mt-1 text-xs font-medium tracking-[0.22em] text-slate-500">智慧水发 · 蜀水云采</div>
            </div>
          </div>

          <div>
            <div className="mb-5 inline-flex rounded-full border border-orange-200 bg-orange-50 px-4 py-1.5 text-xs font-bold tracking-[0.18em] text-[#c96c1c]">B2B PROCUREMENT MALL</div>
            <h1 className="text-[clamp(34px,5vw,64px)] font-black leading-tight tracking-tight text-slate-950" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>
              蜀水云采电子商城
            </h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-600">集中采购目录 · 一站式水利工程物资采购平台</p>
            <div className="mt-8 flex flex-wrap gap-3">
              {['集中目录', '透明价格', '品质溯源'].map(item => (
                <span key={item} className="rounded-full border border-blue-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#e8842c]" />{item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="flex w-full justify-center py-8 lg:w-[460px] lg:py-0">
          <div className="w-full max-w-md rounded-[28px] border border-blue-100 bg-white/95 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur sm:p-10">
            <div className="mb-8">
              <div className="mb-4 h-1 w-12 rounded-full bg-[#e8842c]" />
              <h2 className="text-2xl font-black text-slate-950" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>登录电子商城</h2>
              <p className="mt-2 text-sm text-slate-500">进入水利工程物资采购平台</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">用户名</span>
                <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="请输入用户名" className="h-12 w-full rounded-2xl border border-[#d7e3f2] bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#e8842c] focus:ring-4 focus:ring-orange-100" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">密码</span>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="请输入密码" className="h-12 w-full rounded-2xl border border-[#d7e3f2] bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#e8842c] focus:ring-4 focus:ring-orange-100" />
              </label>
              <button type="submit" disabled={loading} className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#064ea2] to-[#e8842c] text-sm font-black tracking-[0.12em] text-white shadow-[0_16px_36px_rgba(232,132,44,0.20)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45">
                {loading ? '登录中...' : '进入商城'}
              </button>
            </form>

            <a href="http://localhost:3006" className="mt-7 inline-flex text-sm font-semibold text-slate-500 transition hover:text-[#064ea2]" style={{ textDecoration: 'none' }}>← 返回门户</a>
          </div>
        </section>
      </main>
    </div>
  );
}
