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
    <div className="min-h-screen flex" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      {/* ════ Left: Brand Panel (hidden on mobile) ════ */}
      <div
        className="hidden lg:block lg:w-[54%] relative overflow-hidden"
        style={{ background: '#064ea2' }}
      >
        {/* Angular clip mask */}
        <div
          className="absolute inset-0"
          style={{
            clipPath: 'polygon(0 0, 100% 0, 84% 100%, 0 100%)',
            background: '#064ea2',
          }}
        />

        {/* Dot grid texture */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-16 xl:px-24 max-w-lg h-full">
          <img
            src="/assets/logo.jpg"
            alt="四川水发集团"
            className="h-12 w-auto mb-12"
            style={{ filter: 'brightness(0) invert(1)' }}
          />
          <h1
            className="text-white text-[clamp(36px,3vw,48px)] font-black leading-[1.1] tracking-tight mb-3"
            style={{ fontFamily: '"SimHei","黑体",sans-serif' }}
          >
            蜀水云采
            <br />
            电子商城
          </h1>
          <div
            className="w-10 h-[3px] mb-6"
            style={{ background: '#e8842c' }}
          />
          <p className="text-white/40 text-sm leading-relaxed mb-12">
            集中采购目录 · 一站式水利工程物资采购平台
          </p>

          <div className="flex flex-col gap-5">
            {[
              { label: '目录齐全', desc: '钢材、管材、机电设备全覆盖' },
              { label: '价格透明', desc: '阳光采购，实时价格可查' },
              { label: '品质保障', desc: '认证供应商，正品溯源' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <span
                  className="w-1.5 h-1.5 mt-[7px] shrink-0"
                  style={{ background: '#e8842c', borderRadius: 0, transform: 'rotate(45deg)' }}
                />
                <div>
                  <span className="text-white/90 text-sm font-bold">{item.label}</span>
                  <span className="text-white/35 text-xs ml-3">{item.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ════ Right: Form Area ════ */}
      <div
        className="flex-1 flex items-center justify-center px-8 py-12"
        style={{ background: '#fafbfc' }}
      >
        <div className="w-full max-w-sm">
          {/* Mobile logo (only shows on small screens) */}
          <img
            src="/assets/logo.jpg"
            alt="四川水发集团"
            className="h-10 w-auto mb-10 lg:hidden"
          />

          <h2
            className="text-[26px] font-black text-[#18243a] mb-1.5 tracking-tight"
            style={{ fontFamily: '"SimHei","黑体",sans-serif' }}
          >
            登录商城
          </h2>
          <p className="text-[13px] text-[#8a96aa] mb-9">
            请输入您的账号信息进入商城
          </p>

          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <label className="block">
              <span className="text-[11px] font-bold text-[#5a6d8a] uppercase tracking-[0.12em]">
                用户名
              </span>
              <input
                type="text"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="请输入用户名"
                className="mt-1.5 w-full h-11 px-4 bg-white border border-[#d8e0eb] text-sm focus:outline-none focus:border-[#064ea2] placeholder:text-[#bbb]"
                style={{ borderRadius: 2 }}
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-bold text-[#5a6d8a] uppercase tracking-[0.12em]">
                密码
              </span>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="请输入密码"
                className="mt-1.5 w-full h-11 px-4 bg-white border border-[#d8e0eb] text-sm focus:outline-none focus:border-[#064ea2] placeholder:text-[#bbb]"
                style={{ borderRadius: 2 }}
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 text-white text-sm font-bold transition-colors mt-2 disabled:opacity-40"
              style={{ background: '#064ea2', borderRadius: 2 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#043d82')}
              onMouseLeave={e => (e.currentTarget.style.background = '#064ea2')}
            >
              {loading ? '登录中...' : '登录商城'}
            </button>
          </form>

          <div
            className="mt-8 pt-5 flex items-center justify-between text-xs"
            style={{ borderTop: '1px solid #e5ecf4' }}
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
