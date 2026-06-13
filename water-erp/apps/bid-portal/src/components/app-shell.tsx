'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';
import NotificationBell from './notification-bell';
import {
  LayoutDashboard, Unlock, Shield, ClipboardCheck, Archive, Upload,
  LogOut, PanelLeftClose, PanelLeft,
} from 'lucide-react';

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

const navItems: NavItem[] = [
  { label: '开评标总览', path: '/bid', icon: LayoutDashboard },
  { label: '开标大厅', path: '/bid/open', icon: Unlock },
  { label: '监督端', path: '/bid/supervise', icon: Shield },
  { label: '评标端', path: '/bid/evaluate', icon: ClipboardCheck },
  { label: '归档端', path: '/bid/archive', icon: Archive },
  { label: '投标提交', path: '/bid/submit', icon: Upload },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(u => { if (!u) window.location.href = 'http://localhost:3005/login?forceLogin=1'; else setUser(u); })
      .catch(() => { window.location.href = 'http://localhost:3005/login?forceLogin=1'; });
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = 'http://localhost:3005/login?forceLogin=1';
  };

  // /bid 是总览首页，需精确匹配；其余按前缀匹配
  const isActive = (path: string) =>
    path === '/bid' ? pathname === '/bid' : pathname === path || pathname.startsWith(path + '/');

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f9fc]">
      {/* ── Sidebar — deep violet, "在线开评标系统" 品牌色 ── */}
      <aside className={`${collapsed ? 'w-[56px]' : 'w-56'} bg-[#1e1b4b] text-white flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden`}>
        {/* Logo + Brand */}
        <div className="h-[72px] flex items-center gap-3 px-4 border-b border-white/[0.08] cursor-pointer flex-shrink-0" onClick={() => router.push('/bid')}>
          <img src="/assets/logo.jpg" alt="四川水发集团" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
          {!collapsed && (
            <div className="flex flex-col gap-0 overflow-hidden">
              <span className="text-[13px] font-bold tracking-tight text-white leading-tight whitespace-nowrap">四川水发集团</span>
              <span className="text-[9px] text-violet-300/60 font-medium whitespace-nowrap">智慧水发 · 开评标管理端</span>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {navItems.map(item => (
            <button
              key={item.path}
              onClick={() => router.push(item.path)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 mb-1 text-[13px] transition-colors relative rounded-lg ${
                isActive(item.path)
                  ? 'bg-[#7c3aed] text-white font-semibold shadow-[0_8px_20px_rgba(124,58,237,0.30)]'
                  : 'text-white/55 hover:text-white/90 hover:bg-white/[0.05]'
              }`}
            >
              {isActive(item.path) && (
                <div className="w-[3px] h-4 bg-[#c4b5fd] rounded-r absolute left-0" />
              )}
              <div className="flex-shrink-0"><item.icon size={collapsed ? 18 : 16} strokeWidth={1.5} /></div>
              {!collapsed && <span className="tracking-tight">{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="h-10 flex items-center justify-center border-t border-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
        >
          {collapsed ? <PanelLeft size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
        </button>
      </aside>

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header bar with brand */}
        <header className="h-[56px] bg-white border-b border-[#e5ecf4] flex items-center justify-between px-6 flex-shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-[#8a96aa] font-mono tracking-wide">{pathname}</span>
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell />
            {user && (
              <span className="text-[13px] font-medium text-[#18243a] tracking-tight">
                {user.displayName}
              </span>
            )}
            <button onClick={logout}
              className="flex items-center gap-1.5 text-[12px] text-[#5a6d8a] hover:text-[#e74c3c] transition-colors tracking-tight">
              <LogOut size={14} strokeWidth={1.5} /> 退出
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
