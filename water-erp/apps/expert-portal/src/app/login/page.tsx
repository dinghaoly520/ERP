'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { portalURL } from '@water-erp/config';
import { LogIn, ArrowLeft } from 'lucide-react';

export default function ExpertLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) { toast.error('请输入用户名和密码'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include',
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as any).error || '登录失败'); }
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
      if (me.role !== 'bid_expert') { toast.error('非专家账户，请使用专家账号登录'); return; }
      toast.success('登录成功');
      router.push('/');
    } catch (e: any) { toast.error(e.message || '登录失败'); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#f5f7fa] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-[#064ea2] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#064ea2]/25">
            <span className="text-white font-black text-lg">评</span>
          </div>
          <h1 className="text-xl font-black text-[#18243a]">专家评审工作站</h1>
          <p className="text-sm text-[#8a96aa] mt-1">智慧水发·蜀水云采</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-xl border border-[#e5ecf4] p-6 shadow-sm">
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-[#18243a]">用户名</span>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="请输入专家账户"
                className="mt-1 w-full h-11 px-3 border border-[#d0dae8] rounded-lg text-sm focus:outline-none focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2]/20 placeholder:text-[#bbb]"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#18243a]">密码</span>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="请输入密码"
                className="mt-1 w-full h-11 px-3 border border-[#d0dae8] rounded-lg text-sm focus:outline-none focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2]/20 placeholder:text-[#bbb]"
              />
            </label>
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full h-11 bg-[#064ea2] text-white rounded-lg text-sm font-bold hover:bg-[#043d82] transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <LogIn size={16} strokeWidth={2} /> {loading ? '登录中...' : '登录专家工作站'}
            </button>
          </div>
        </div>

        <a href={portalURL('public', '/login')} className="flex items-center justify-center gap-1 mt-4 text-sm text-[#8a96aa] hover:text-[#064ea2] transition-colors">
          <ArrowLeft size={14} /> 返回门户登录
        </a>
      </div>
    </div>
  );
}
