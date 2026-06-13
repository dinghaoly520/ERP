'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';
import NotificationBell from './notification-bell';
import {
  LayoutDashboard, ClipboardList, Gavel, Building2,
  ShoppingCart, Megaphone, Star, Info, UsersRound,
  LogOut, PanelLeftClose, PanelLeft,
} from 'lucide-react';

interface NavItem {
  label: string;
  path?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  children?: { label: string; path: string }[];
}

const navItems: NavItem[] = [
  { label: '首页', path: '/dashboard', icon: LayoutDashboard },
  { label: '采购管理', path: '/procurement', icon: ClipboardList },
  {
    label: '开评标管理', icon: Gavel, children: [
      { label: '总览驾驶舱', path: '/bid' },
      { label: '开标主持端', path: '/bid/open' },
      { label: '监督端', path: '/bid/supervise' },
      { label: '归档端', path: '/bid/archive' },
    ],
  },
  { label: '供应商管理', icon: Building2, children: [
      { label: '供应商列表', path: '/supplier' },
    ],
  },
  { label: '专家管理', path: '/expert', icon: UsersRound },
  { label: '电子商城', path: '/mall', icon: ShoppingCart },
  { label: '信息公告', path: '/notice', icon: Megaphone },
  { label: '评价管理', path: '/evaluation', icon: Star },
  { label: '关于我们', path: '/about', icon: Info },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(u => { if (!u) window.location.href = '/login'; else setUser(u); })
      .catch(() => { window.location.href = '/login'; });
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/login');
  };

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f9fc]">
      {/* ── Sidebar — deep navy with brand identity ── */}
      <aside className={`${collapsed ? 'w-[56px]' : 'w-56'} bg-[#0d2a4a] text-white flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden`}>
        {/* Logo + Brand */}
        <div className="h-[72px] flex items-center gap-3 px-4 border-b border-white/[0.08] cursor-pointer flex-shrink-0" onClick={() => router.push('/dashboard')}>
          <img src="/assets/logo.jpg" alt="四川水发集团" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
          {!collapsed && (
            <div className="flex flex-col gap-0 overflow-hidden">
              <span className="text-[13px] font-bold tracking-tight text-white leading-tight whitespace-nowrap">四川水发集团</span>
              <span className="text-[9px] text-white/35 font-medium whitespace-nowrap">智慧水发 · 管理端</span>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {navItems.map(item => (
            <div key={item.label} className="mb-0.5">
              {item.children ? (
                <>
                  {!collapsed && (
                    <div className="px-3 py-2 text-[10px] font-semibold text-white/25 uppercase tracking-widest">
                      {item.label}
                    </div>
                  )}
                  {item.children.map(child => (
                    <button
                      key={child.path}
                      onClick={() => router.push(child.path)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors text-left relative ${
                        isActive(child.path)
                          ? 'bg-[#064ea2] text-white font-semibold rounded-lg'
                          : 'text-white/45 hover:text-white/80 hover:bg-white/[0.04] rounded-lg'
                      }`}
                    >
                      {isActive(child.path) && (
                        <div className="w-[3px] h-4 bg-[#0891b2] rounded-r absolute left-0" />
                      )}
                      <span className={`${collapsed ? 'mx-auto' : ''} tracking-tight`}>
                        {collapsed ? child.label.slice(0, 2) : child.label}
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <button
                  onClick={() => router.push(item.path!)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors relative rounded-lg ${
                    isActive(item.path!)
                      ? 'bg-[#064ea2] text-white font-semibold'
                      : 'text-white/45 hover:text-white/80 hover:bg-white/[0.04]'
                  }`}
                >
                  {isActive(item.path!) && (
                    <div className="w-[3px] h-4 bg-[#0891b2] rounded-r absolute left-0" />
                  )}
                  <div className="flex-shrink-0"><item.icon size={collapsed ? 18 : 16} strokeWidth={1.5} /></div>
                  {!collapsed && <span className="tracking-tight">{item.label}</span>}
                </button>
              )}
            </div>
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
