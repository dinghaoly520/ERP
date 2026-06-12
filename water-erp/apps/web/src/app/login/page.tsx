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
    <div
      className="min-h-screen flex relative overflow-hidden"
      style={{
        background: '#0d2a4a',
        fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif',
      }}
    >
      {/* Topographic contour background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            repeating-radial-gradient(circle at 25% 65%, transparent 0, transparent 80px, rgba(255,255,255,0.015) 80px, rgba(255,255,255,0.015) 81px),
            repeating-radial-gradient(circle at 50% 35%, transparent 0, transparent 120px, rgba(255,255,255,0.012) 120px, rgba(255,255,255,0.012) 121px),
            repeating-radial-gradient(circle at 75% 80%, transparent 0, transparent 100px, rgba(255,255,255,0.010) 100px, rgba(255,255,255,0.010) 101px)
          `,
        }}
      />

      {/* Left: Brand content */}
      <div className="flex-1 flex flex-col justify-between relative z-10 px-12 lg:px-20 py-10">
        {/* Top: Logo + brand name */}
        <div className="flex items-center gap-4">
          <img src="/assets/logo.jpg" alt="四川水发集团" className="h-14 w-auto rounded-xl object-cover border border-white/10" />
          <div className="flex flex-col gap-0">
            <strong className="text-white text-xl tracking-[0.12em] leading-tight whitespace-nowrap" style={{ fontFamily: '"SimHei","黑体",sans-serif', fontWeight: 900 }}>四川水发集团</strong>
            <small className="text-[7px] text-white/30 font-medium tracking-wide">SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.</small>
          </div>
        </div>

        {/* Center: Title block */}
        <div className="max-w-md">
          <h1
            className="text-white text-[clamp(32px,3vw,46px)] font-black leading-[1.1] tracking-tight mb-4"
            style={{ fontFamily: '"SimHei","黑体",sans-serif' }}
          >
            采购管理平台
          </h1>
          <div className="w-12 h-[2px] bg-[#064ea2] mb-5" />
          <p className="text-white/30 text-sm leading-relaxed">
            信息发布 · 供应商管理 · 专家管理
          </p>
          <p className="text-white/20 text-xs mt-3">
            智慧水发·蜀水云采 — 电子化招标采购管理系统
          </p>
        </div>

        {/* Bottom: Test info */}
        <div className="text-white/20 text-[11px]">
          测试账号: admin / admin123 · lizhuren / 123456
        </div>
      </div>

      {/* Right: Form */}
      <div className="w-full max-w-sm flex items-center px-8 lg:px-12 relative z-10">
        <div className="w-full">
          {/* Form header */}
          <div className="mb-8">
            <h2 className="text-white text-xl font-bold tracking-tight mb-1" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>
              系统登录
            </h2>
            <p className="text-white/30 text-xs">请输入管理员凭证</p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <label className="block">
              <span className="text-[11px] font-semibold text-white/40 uppercase tracking-[0.12em] block mb-1.5">用户名</span>
              <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="输入用户名"
                className="w-full h-11 px-4 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-[#064ea2] transition-colors"
                style={{ background: '#1a2f4a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }} />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-white/40 uppercase tracking-[0.12em] block mb-1.5">密码</span>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="输入密码"
                className="w-full h-11 px-4 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-[#064ea2] transition-colors"
                style={{ background: '#1a2f4a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }} />
            </label>
            <button type="submit" disabled={loading}
              className="w-full h-11 text-white text-sm font-bold transition-colors mt-4 disabled:opacity-40 rounded-lg"
              style={{ background: '#064ea2' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0e62d0')}
              onMouseLeave={e => (e.currentTarget.style.background = '#064ea2')}>
              {loading ? '验证中...' : '登 录'}
            </button>
          </form>

          <div className="mt-6">
            <a href="http://localhost:3006" className="text-white/25 text-xs hover:text-white/50 transition-colors" style={{ textDecoration: 'none' }}>
              ← 返回门户首页
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
