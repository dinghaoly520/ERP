'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '../lib/types';
import { LayoutDashboard, ClipboardList, UserCircle, LogOut, PanelLeftClose, PanelLeft } from 'lucide-react';

const LOGIN_URL = '/login';

const navItems = [
  { label: '工作台', path: '/', icon: LayoutDashboard },
  { label: '评审项目', path: '/projects', icon: ClipboardList },
  { label: '个人信息', path: '/profile', icon: UserCircle },
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
    <div className="flex h-screen overflow-hidden bg-[#f7f9fc]">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-[56px]' : 'w-56'} bg-[#0d2a4a] text-white flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden`}>
        {/* Logo + Brand */}
        <div className="h-[72px] flex items-center gap-3 px-4 border-b border-white/[0.08] cursor-pointer flex-shrink-0" onClick={() => router.push('/')}>
          <img src="/assets/logo.jpg" alt="四川水发集团" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
          {!collapsed && (
            <div className="flex flex-col gap-0 overflow-hidden">
              <span className="text-[13px] font-bold tracking-tight text-white leading-tight whitespace-nowrap">四川水发集团</span>
              <span className="text-[9px] text-white/35 font-medium whitespace-nowrap">专家评审工作站</span>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {navItems.map(item => (
            <button
              key={item.path}
              onClick={() => router.push(item.path)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors mb-0.5 relative rounded-lg ${
                isActive(item.path)
                  ? 'bg-[#7c3aed] text-white font-semibold'
                  : 'text-white/45 hover:text-white/80 hover:bg-white/[0.04]'
              }`}
            >
              {isActive(item.path) && (
                <div className="w-[3px] h-4 bg-[#a78bfa] rounded-r absolute left-0" />
              )}
              <div className="flex-shrink-0"><item.icon size={collapsed ? 18 : 16} strokeWidth={1.5} /></div>
              {!collapsed && <span className="tracking-tight">{item.label}</span>}
            </button>
          ))}
        </nav>

        <button onClick={() => setCollapsed(!collapsed)}
          className="h-10 flex items-center justify-center border-t border-white/[0.06] text-white/30 hover:text-white/60 transition-colors">
          {collapsed ? <PanelLeft size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-[56px] bg-white border-b border-[#e5ecf4] flex items-center justify-between px-6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <img src="/assets/logo.jpg" alt="" className="w-6 h-6 rounded object-cover" />
            <span className="text-[11px] text-[#8a96aa] font-mono tracking-wide">专家工作站 · {pathname}</span>
          </div>
          <div className="flex items-center gap-4">
            {user && <span className="text-[13px] font-medium text-[#18243a] tracking-tight">{user.displayName}</span>}
            <button onClick={logout}
              className="flex items-center gap-1.5 text-[12px] text-[#5a6d8a] hover:text-[#e74c3c] transition-colors tracking-tight">
              <LogOut size={14} strokeWidth={1.5} /> 退出
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
