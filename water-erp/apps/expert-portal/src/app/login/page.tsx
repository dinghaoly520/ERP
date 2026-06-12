'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   专家评审工作站 · 登录页 — "Review Chamber"
   横线纹理、蓝色顶栏、学术感、精致紧凑
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function ExpertLoginPage() {
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
        body: JSON.stringify({ username: form.username, password: form.password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || '登录失败');
      }
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
      if (me.role !== 'bid_expert') {
        toast.error('非专家账户，请使用专家账号登录');
        setLoading(false);
        return;
      }
      toast.success('登录成功');
      router.push('/');
    } catch (e: any) {
      toast.error(e.message || '登录失败');
    }
    setLoading(false);
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif',
        background: '#f3f4f6',
      }}
    >
      {/* ════ Top Bar ════ */}
      <header
        className="w-full flex items-center justify-between px-8 lg:px-16 shrink-0"
        style={{ background: '#064ea2', height: 64 }}
      >
        <div className="flex items-center gap-3">
          <img
            src="/assets/logo.jpg"
            alt="四川水发集团"
            className="h-9 w-auto rounded-lg object-cover"
          />
          <div className="flex flex-col gap-0">
            <span
              className="text-white text-lg font-black tracking-tight leading-tight"
              style={{ fontFamily: '"SimHei","黑体",sans-serif' }}
            >
              四川水发集团
            </span>
            <span className="text-white/35 text-[9px] tracking-wide">专家评审工作站</span>
          </div>
        </div>
        <span className="text-white/30 text-xs tracking-wide">
          智慧水发 · 蜀水云采
        </span>
      </header>

      {/* Thin gold accent line */}
      <div className="w-full h-[2px]" style={{ background: '#b08c3e' }} />

      {/* ════ Form Area with ruled-paper background ════ */}
      <div
        className="flex-1 flex items-center justify-center relative"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 31px, rgba(0,0,0,0.028) 31px, rgba(0,0,0,0.028) 32px)',
          backgroundSize: '100% 32px',
        }}
      >
        <div className="w-full max-w-sm px-6">
          {/* Portal badge */}
          <div className="mb-8">
            <span
              className="inline-block text-[10px] font-bold uppercase tracking-[0.15em] px-3 py-1 text-[#8b7340]"
              style={{
                background: 'rgba(176,140,62,0.08)',
                borderRadius: 2,
              }}
            >
              Expert Review Station
            </span>
          </div>

          <h2
            className="text-[22px] font-black text-[#18243a] mb-1 tracking-tight"
            style={{ fontFamily: '"SimHei","黑体",sans-serif' }}
          >
            专家登录
          </h2>
          <p className="text-[13px] text-[#8a96aa] mb-8">
            请使用专家评审账号登录系统
          </p>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <label className="block">
              <span className="text-[11px] font-bold text-[#5a6d8a] uppercase tracking-[0.12em] block mb-1.5">
                专家账号
              </span>
              <input
                type="text"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="请输入专家账户"
                className="w-full h-10 px-4 bg-white border border-[#d8e0eb] text-sm focus:outline-none focus:border-[#064ea2] placeholder:text-[#bbb]"
                style={{ borderRadius: 2 }}
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-bold text-[#5a6d8a] uppercase tracking-[0.12em] block mb-1.5">
                密码
              </span>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="请输入密码"
                className="w-full h-10 px-4 bg-white border border-[#d8e0eb] text-sm focus:outline-none focus:border-[#064ea2] placeholder:text-[#bbb]"
                style={{ borderRadius: 2 }}
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 text-white text-sm font-bold transition-colors mt-3 disabled:opacity-40"
              style={{ background: '#064ea2', borderRadius: 2 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#043d82')}
              onMouseLeave={e => (e.currentTarget.style.background = '#064ea2')}
            >
              {loading ? '验证中...' : '进入工作站'}
            </button>
          </form>

          <div
            className="mt-7 pt-4 flex items-center justify-between text-xs"
            style={{ borderTop: '1px solid #e0e5ed' }}
          >
            <span className="text-[#8a96aa]">测试: admin / admin123</span>
            <a
              href="http://localhost:3006"
              className="text-[#064ea2] font-semibold"
              style={{ textDecoration: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
            >
              ← 返回门户
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
