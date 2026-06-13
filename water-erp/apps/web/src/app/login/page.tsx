'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   采购管理端 · 登录页 — "Operations Center"
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function ProcurementLoginPage() {
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
      router.push('/dashboard');
    } catch {
      toast.error('请求失败，请重试');
    }
    setLoading(false);
  };

  return (
    <main
      className="min-h-screen relative overflow-hidden text-white"
      style={{
        background:
          'radial-gradient(circle at 18% 18%, rgba(222, 174, 84, 0.20), transparent 28%), radial-gradient(circle at 82% 12%, rgba(28, 93, 157, 0.26), transparent 30%), linear-gradient(135deg, #020b19 0%, #042a58 48%, #07111f 100%)',
        fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif',
      }}
    >
      <div className="absolute inset-0 opacity-55">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgba(231, 184, 91, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(231, 184, 91, 0.08) 1px, transparent 1px)',
            backgroundSize: '72px 72px',
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 78%, transparent 100%)',
          }}
        />
        <div className="absolute -left-32 top-1/4 h-80 w-80 rounded-full border border-[#d8aa57]/20" />
        <div className="absolute right-[-12rem] bottom-[-8rem] h-[34rem] w-[34rem] rounded-full border border-[#d8aa57]/20" />
      </div>

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.14fr_0.86fr]">
        <section className="flex flex-col justify-between px-7 py-8 sm:px-12 lg:px-20 lg:py-12">
          <div className="flex items-center gap-4">
            <img
              src="/assets/logo.jpg"
              alt="四川水发集团"
              className="h-14 w-auto rounded-2xl border border-[#d8aa57]/30 object-cover shadow-[0_16px_50px_rgba(0,0,0,0.35)]"
            />
            <div>
              <p className="text-xl font-black tracking-[0.16em] text-white" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>
                四川水发集团
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.42em] text-[#d8aa57]/70">
                Sichuan Water Development
              </p>
            </div>
          </div>

          <div className="my-16 max-w-4xl lg:my-0">
            <div className="mb-7 inline-flex items-center gap-3 rounded-full border border-[#d8aa57]/30 bg-[#d8aa57]/10 px-4 py-2 text-xs font-semibold tracking-[0.28em] text-[#f4d08b] shadow-[0_0_40px_rgba(216,170,87,0.12)]">
              <span className="h-2 w-2 rounded-full bg-[#f4d08b] shadow-[0_0_18px_rgba(244,208,139,0.95)]" />
              智慧水发 · 蜀水云采
            </div>
            <h1
              className="max-w-3xl text-[clamp(46px,7vw,96px)] font-black leading-[0.95] tracking-[-0.06em]"
              style={{ fontFamily: '"SimHei","黑体",sans-serif' }}
            >
              采购管理
              <span className="mt-3 block bg-gradient-to-r from-[#f8dfa7] via-[#d8aa57] to-[#fff6d7] bg-clip-text text-transparent">
                运营中枢
              </span>
            </h1>
            <p className="mt-8 max-w-2xl text-base leading-8 tracking-[0.16em] text-slate-200/78">
              信息发布 · 供应商管理 · 专家管理
            </p>
            <div className="mt-10 grid max-w-2xl grid-cols-3 gap-3 text-xs text-slate-300/70">
              {['招采态势', '风控协同', '履约追踪'].map(item => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 backdrop-blur-md">
                  <div className="mb-3 h-px w-10 bg-gradient-to-r from-[#d8aa57] to-transparent" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs tracking-[0.22em] text-white/38">
            <span className="h-px w-16 bg-[#d8aa57]/45" />
            <span>PROCUREMENT OPERATIONS COCKPIT</span>
          </div>
        </section>

        <section className="flex items-center justify-center px-7 pb-10 sm:px-12 lg:px-16 lg:py-12">
          <div className="relative w-full max-w-md">
            <div className="absolute -inset-6 rounded-[2.5rem] bg-[#d8aa57]/10 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/12 bg-[#06182f]/75 p-7 shadow-[0_30px_90px_rgba(0,0,0,0.46)] backdrop-blur-2xl sm:p-9">
              <div className="absolute right-0 top-0 h-28 w-28 rounded-bl-full bg-gradient-to-bl from-[#d8aa57]/28 to-transparent" />
              <div className="relative">
                <p className="mb-3 text-xs font-semibold tracking-[0.34em] text-[#d8aa57]">MANAGEMENT ACCESS</p>
                <h2 className="text-3xl font-black tracking-[-0.04em] text-white" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>
                  管理端登录
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-300/70">进入招采运营管理中枢</p>
              </div>

              <form onSubmit={handleLogin} className="relative mt-9 flex flex-col gap-5">
                <label className="block">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300/58">用户名</span>
                  <input
                    type="text"
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    placeholder="请输入用户名"
                    className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.055] px-4 text-sm text-white/90 outline-none transition placeholder:text-white/25 focus:border-[#d8aa57]/70 focus:bg-white/[0.075] focus:ring-4 focus:ring-[#d8aa57]/10"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300/58">密码</span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="请输入密码"
                    className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.055] px-4 text-sm text-white/90 outline-none transition placeholder:text-white/25 focus:border-[#d8aa57]/70 focus:bg-white/[0.075] focus:ring-4 focus:ring-[#d8aa57]/10"
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading}
                  className="group mt-3 h-12 w-full rounded-xl bg-gradient-to-r from-[#bf8730] via-[#d8aa57] to-[#f5d895] text-sm font-black tracking-[0.18em] text-[#06182f] shadow-[0_18px_44px_rgba(216,170,87,0.24)] transition hover:translate-y-[-1px] hover:shadow-[0_22px_56px_rgba(216,170,87,0.32)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {loading ? '验证中...' : '进入管理平台'}
                </button>
              </form>

              <div className="relative mt-8 flex items-center justify-between border-t border-white/10 pt-6">
                <a
                  href="http://localhost:3005"
                  className="text-xs font-semibold tracking-[0.16em] text-slate-300/55 transition hover:text-[#f4d08b]"
                  style={{ textDecoration: 'none' }}
                >
                  ← 返回门户
                </a>
                <span className="text-[10px] uppercase tracking-[0.28em] text-white/24">Secure Console</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
