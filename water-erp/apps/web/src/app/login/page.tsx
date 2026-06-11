'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { User, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
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
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.18_0.045_262)]">
      <div className="w-full max-w-md bg-white p-10">
        <div className="mb-10">
          <div className="w-8 h-8 bg-[oklch(0.42_0.14_260)] flex items-center justify-center mb-6">
            <span className="text-white font-bold text-xs tracking-wider">水</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            智慧水发 · 招采ERP
          </h1>
          <p className="text-[13px] text-[oklch(0.55_0.01_264)] mt-1">管理后台登录</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.45_0.01_264)] uppercase tracking-widest mb-2">用户名</label>
            <div className="relative">
              <User size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[oklch(0.62_0.008_264)]" />
              <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="输入用户名"
                className="w-full pl-9 pr-3 py-2.5 border border-[oklch(0.91_0.006_264)] text-[14px] bg-[oklch(0.992_0.001_264)] placeholder:text-[oklch(0.80_0.006_264)] focus:outline-none focus:border-[oklch(0.42_0.14_260)] hover:border-[oklch(0.62_0.01_264)] transition-colors" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.45_0.01_264)] uppercase tracking-widest mb-2">密码</label>
            <div className="relative">
              <Lock size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[oklch(0.62_0.008_264)]" />
              <input type={showPw ? 'text' : 'password'} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="输入密码"
                className="w-full pl-9 pr-10 py-2.5 border border-[oklch(0.91_0.006_264)] text-[14px] bg-[oklch(0.992_0.001_264)] placeholder:text-[oklch(0.80_0.006_264)] focus:outline-none focus:border-[oklch(0.42_0.14_260)] hover:border-[oklch(0.62_0.01_264)] transition-colors" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[oklch(0.55_0.008_264)] hover:text-[oklch(0.30_0.01_264)]">
                {showPw ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-[oklch(0.42_0.14_260)] text-white text-[14px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] disabled:opacity-40 transition-colors flex items-center justify-center gap-2 mt-8">
            {loading ? '验证中...' : '登 录'} <ArrowRight size={16} strokeWidth={2} />
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-[oklch(0.94_0.004_264)]">
          <p className="text-[10px] text-[oklch(0.72_0.008_264)] leading-relaxed">
            <span className="font-semibold text-[oklch(0.55_0.01_264)]">测试账号</span><br/>
            admin / admin123 · lizhuren / 123456
          </p>
        </div>
      </div>
    </div>
  );
}
