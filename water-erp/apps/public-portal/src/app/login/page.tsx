'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { landingURL } from '@water-erp/config';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [logging, setLogging] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) { toast.error('请输入用户名和密码'); return; }
    setLogging(true);
    try {
      await api.post('/auth/login', { username, password });
      const me = await api.get<{ role: string }>('/auth/me');
      const dest = landingURL(me.role);
      toast.success('登录成功，正在跳转...');
      setTimeout(() => { window.location.href = dest; }, 800);
    } catch (e: any) {
      toast.error(e.message || '登录失败');
    }
    setLogging(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#042a58] via-[#064ea2] to-[#0891b2]">
      <div className="bg-white rounded-2xl p-10 w-full max-w-md shadow-2xl">
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-2 text-2xl font-extrabold text-[#064ea2] hover:text-[#0e62d0]">← </a>
          <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)] mb-1 mt-4">登录平台</h1>
          <p className="text-sm text-[oklch(0.55_0.01_264)]">智慧水发招采ERP系统</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1.5">用户名</label>
            <input value={username} onChange={e => setUsername(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
              placeholder="请输入用户名" className="w-full px-4 py-3 border border-[oklch(0.91_0.006_264)] rounded-xl text-sm focus:border-[#064ea2] focus:ring-2 focus:ring-[#064ea2]/10 outline-none transition" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1.5">密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
              placeholder="请输入密码" className="w-full px-4 py-3 border border-[oklch(0.91_0.006_264)] rounded-xl text-sm focus:border-[#064ea2] focus:ring-2 focus:ring-[#064ea2]/10 outline-none transition" />
          </div>
          <button onClick={handleLogin} disabled={logging}
            className="w-full py-3 bg-gradient-to-r from-[#064ea2] to-[#39a8ff] text-white rounded-xl font-bold text-sm hover:shadow-lg transition disabled:opacity-50">
            {logging ? '登录中...' : '登 录'}
          </button>
          <div className="text-center text-xs text-[oklch(0.55_0.01_264)]">
            没有账号？<a href="/register" className="text-[#064ea2] hover:underline font-semibold">供应商注册</a>
          </div>
          <div className="mt-4 p-3 bg-[oklch(0.992_0.003_264)] rounded-lg border border-[oklch(0.91_0.006_264)] text-[10px] text-[oklch(0.55_0.01_264)]">
            <strong className="text-[oklch(0.18_0.012_265)]">测试账号：</strong>
            admin/admin123 · supplier1/123456 · wangjg/123456
          </div>
        </div>
      </div>
    </div>
  );
}
