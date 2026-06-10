'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';

const navItems = [
  { label: '首页', path: '/dashboard', icon: '🏠' },
  { label: '采购管理', path: '/procurement', icon: '📋' },
  {
    label: '开评标管理', icon: '⚖️', children: [
      { label: '总览驾驶舱', path: '/bid' },
      { label: '供应商端', path: '/bid/submit' },
      { label: '开标主持端', path: '/bid/open' },
      { label: '专家评标端', path: '/bid/evaluate' },
      { label: '监督端', path: '/bid/supervise' },
      { label: '归档端', path: '/bid/archive' },
    ],
  },
  { label: '专家管理', path: '/expert', icon: '👨‍💼' },
  {
    label: '供应商管理', icon: '🏢', children: [
      { label: '供应商列表', path: '/supplier' },
    ],
  },
  { label: '电子商城', path: '/mall', icon: '🛒' },
  { label: '信息公告', path: '/notice', icon: '📢' },
  { label: '评价管理', path: '/evaluation', icon: '⭐' },
  { label: '关于我们', path: '/about', icon: 'ℹ️' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setUser);
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/login');
  };

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={`${collapsed ? 'w-16' : 'w-56'} bg-gradient-to-b from-[#042a58] to-[#064ea2] text-white flex-shrink-0 transition-all duration-300 flex flex-col`}>
        <div className="h-14 flex items-center px-4 border-b border-white/10">
          {!collapsed && <span className="font-bold text-sm">智慧水发 · ERP</span>}
          <button onClick={() => setCollapsed(!collapsed)} className="ml-auto text-white/60 hover:text-white">{collapsed ? '→' : '←'}</button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map(item => (
            <div key={item.label}>
              {item.children ? (
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 text-white/70 text-sm font-semibold px-2 py-1"><span>{item.icon}</span>{!collapsed && <span>{item.label}</span>}</div>
                  {!collapsed && item.children.map(child => (
                    <button key={child.path} onClick={() => router.push(child.path)}
                      className={`block w-full text-left px-8 py-2 text-sm rounded transition ${isActive(child.path) ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white hover:bg-white/8'}`}>
                      {child.label}
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => router.push(item.path!)}
                  className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition ${isActive(item.path!) ? 'bg-white/15 text-white font-semibold border-l-3 border-[#39a8ff]' : 'text-white/60 hover:text-white hover:bg-white/8'}`}>
                  <span>{item.icon}</span>{!collapsed && <span>{item.label}</span>}
                </button>
              )}
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white shadow-sm flex items-center justify-between px-6 flex-shrink-0">
          <span className="text-sm text-[#5a6d8a]">{pathname}</span>
          <div className="flex items-center gap-4">
            {user && <span className="text-sm font-semibold text-[#18243a]">{user.displayName}</span>}
            <button onClick={logout} className="text-sm text-[#5a6d8a] hover:text-[#064ea2]">退出</button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-[#f6f9fd] p-6">{children}</main>
      </div>
    </div>
  );
}
