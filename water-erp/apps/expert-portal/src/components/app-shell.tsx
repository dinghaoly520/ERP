'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '../lib/types';
import { portalURL } from '@water-erp/config';
import { LayoutDashboard, ClipboardList, UserCircle, LogOut, PanelLeftClose, PanelLeft } from 'lucide-react';

const LOGIN_URL = portalURL('public', '/login');

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
    <div className="flex h-screen overflow-hidden bg-[oklch(0.982_0.003_264)]">
      {/* Sidebar — violet deep */}
      <aside className={`${collapsed ? 'w-[56px]' : 'w-56'} bg-[oklch(0.22_0.06_285)] text-white flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden`}>
        <div className="h-14 flex items-center gap-3 px-4 border-b border-white/[0.06] cursor-pointer flex-shrink-0">
          <div className="w-7 h-7 bg-[oklch(0.52_0.18_285)] flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold tracking-wider">评</span>
          </div>
          {!collapsed && <span className="text-[13px] font-bold tracking-tight whitespace-nowrap">专家评审工作站</span>}
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {navItems.map(item => (
            <button
              key={item.path}
              onClick={() => router.push(item.path)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors mb-0.5 relative ${
                isActive(item.path)
                  ? 'bg-white/[0.08] text-white font-semibold'
                  : 'text-white/45 hover:text-white/80 hover:bg-white/[0.04]'
              }`}
            >
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
        <header className="h-14 bg-white border-b border-[oklch(0.91_0.006_264)] flex items-center justify-between px-6 flex-shrink-0">
          <span className="text-[11px] text-[oklch(0.62_0.008_264)] font-mono tracking-wide">专家工作站</span>
          <div className="flex items-center gap-4">
            {user && <span className="text-[13px] font-medium text-[oklch(0.18_0.012_265)] tracking-tight">{user.displayName}</span>}
            <button onClick={logout}
              className="flex items-center gap-1.5 text-[12px] text-[oklch(0.55_0.008_264)] hover:text-[oklch(0.50_0.18_22)] transition-colors tracking-tight">
              <LogOut size={14} strokeWidth={1.5} /> 退出
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
