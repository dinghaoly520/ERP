'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '../lib/types';
import {
  LayoutDashboard, ClipboardList, UserCircle, LogOut,
  PanelLeftClose, PanelLeft,
} from 'lucide-react';

const LOGIN_URL = '/login';

const navItems = [
  { label: '工作台', caption: '评审总览', path: '/', icon: LayoutDashboard },
  { label: '评审项目', caption: '项目列表', path: '/projects', icon: ClipboardList },
  { label: '个人信息', caption: '资料管理', path: '/profile', icon: UserCircle },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(u => { if (!u) window.location.href = LOGIN_URL; else setUser(u); })
      .catch(() => { window.location.href = LOGIN_URL; });
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = LOGIN_URL;
  };

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden text-[#18243a]" style={{ background: 'radial-gradient(circle at 8% 0%, rgba(14, 98, 208, 0.14), transparent 30%), radial-gradient(circle at 88% 8%, rgba(124, 58, 237, 0.12), transparent 26%), linear-gradient(180deg, #f7fbff 0%, #f8fafc 100%)' }}>
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-[#dbe6f3] bg-white/86 backdrop-blur-xl">
        <div className="flex h-[68px] items-center justify-between px-6">
          <button onClick={() => router.push('/')} className="flex items-center gap-3 text-left">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-10 w-auto object-contain" />
            <strong className="block text-lg font-black tracking-[0.10em] text-[#123a6e]" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>
              四川水发集团
            </strong>
          </button>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-[#e5ecf4] bg-white px-3 py-2 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#a78bfa] text-xs font-black text-white">
                {user?.displayName?.trim()?.slice(0, 1) || user?.username?.slice(0, 1) || 'E'}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-black text-[#18243a]">{user?.displayName?.trim() || user?.username || '专家'}</div>
              </div>
            </div>
            <button
              onClick={logout}
              className="rounded-xl border border-[#d5e0ef] bg-white px-3 py-2 text-sm font-semibold text-[#5a6d8a] transition hover:border-[#e74c3c] hover:text-[#e74c3c]"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className={`${collapsed ? 'w-[68px]' : 'w-[256px]'} m-3 mr-0 flex flex-shrink-0 flex-col overflow-hidden rounded-[24px] border border-[#ddd6fe] bg-white/88 shadow-[0_18px_60px_rgba(15,47,87,0.10)] backdrop-blur transition-all duration-200`}>
          <nav className="flex-1 overflow-y-auto px-2 py-3">
            {navItems.map(item => (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className={`relative flex w-full items-center gap-3 rounded-2xl px-3 py-3 mb-1.5 text-left transition-all ${
                  isActive(item.path)
                    ? 'bg-gradient-to-r from-[#7c3aed] to-[#a78bfa] text-white shadow-[0_12px_28px_rgba(124,58,237,0.24)]'
                    : 'text-[#5a6d8a] hover:bg-[#f5f3ff] hover:text-[#7c3aed]'
                }`}
              >
                {isActive(item.path) && <div className="absolute left-0 h-6 w-[3px] rounded-r bg-[#c4b5fd]" />}
                <div className="flex-shrink-0"><item.icon size={collapsed ? 20 : 18} strokeWidth={1.7} /></div>
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black tracking-tight">{item.label}</span>
                    {item.caption && <span className="mt-0.5 block truncate text-[11px] opacity-70">{item.caption}</span>}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="m-2 flex h-11 items-center justify-center rounded-2xl border border-[#e5ecf4] bg-[#f8fbff] text-[#5a6d8a] transition-colors hover:border-[#c4b5fd] hover:text-[#7c3aed]"
          >
            {collapsed ? <PanelLeft size={16} strokeWidth={1.7} /> : <PanelLeftClose size={16} strokeWidth={1.7} />}
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6" style={{
            backgroundImage: 'linear-gradient(rgba(124,58,237,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.03) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
