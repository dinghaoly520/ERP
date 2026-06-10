'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ username: '', password: '', displayName: '' });
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`/api/auth/${isLogin ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(isLogin ? { username: form.username, password: form.password } : form),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      router.push('/dashboard');
    } catch { setError('请求失败'); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#042a58] via-[#064ea2] to-[#073a78]">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#18243a]">智慧水发·招采ERP系统</h1>
          <p className="text-sm text-[#5a6d8a] mt-2">{isLogin ? '登录您的账户' : '注册新账户'}</p>
        </div>
        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="用户名" required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            className="w-full px-4 py-3 border border-[#e8f0fa] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064ea2]" />
          {!isLogin && (
            <input type="text" placeholder="显示名称" required value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              className="w-full px-4 py-3 border border-[#e8f0fa] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064ea2]" />
          )}
          <input type="password" placeholder="密码" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            className="w-full px-4 py-3 border border-[#e8f0fa] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064ea2]" />
          <button type="submit" className="w-full py-3 bg-[#064ea2] text-white font-bold rounded-lg hover:bg-[#0e62d0] transition">
            {isLogin ? '登 录' : '注 册'}
          </button>
        </form>
        <p className="text-center text-sm text-[#5a6d8a] mt-6">
          {isLogin ? '没有账户？' : '已有账户？'}
          <button onClick={() => setIsLogin(!isLogin)} className="text-[#064ea2] font-semibold ml-1">{isLogin ? '注册' : '登录'}</button>
        </p>
      </div>
    </div>
  );
}
