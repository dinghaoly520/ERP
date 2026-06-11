'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';
import NotificationBell from './notification-bell';
import {
  LayoutDashboard, ClipboardList, Gavel, Building2,
  ShoppingCart, Megaphone, Star, Info, ChevronLeft,
  ChevronRight, LogOut, PanelLeftClose, PanelLeft,
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
      .then(setUser);
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/login');
  };

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  return (
    <div className="flex h-screen overflow-hidden bg-[oklch(0.982_0.003_264)]">
      {/* ── Sidebar — deep navy, flat, precise ── */}
      <aside className={`${collapsed ? 'w-[56px]' : 'w-56'} bg-[oklch(0.18_0.045_262)] text-white flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden`}>
        {/* Logo */}
        <div className="h-14 flex items-center gap-3 px-4 border-b border-white/[0.06] cursor-pointer flex-shrink-0" onClick={() => router.push('/dashboard')}>
          <div className="w-7 h-7 bg-[oklch(0.42_0.14_260)] flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold tracking-wider">水</span>
          </div>
          {!collapsed && (
            <div className="flex items-baseline gap-1 overflow-hidden whitespace-nowrap">
              <span className="text-[13px] font-bold tracking-tight">智慧水发</span>
              <span className="text-[10px] text-white/30 font-medium">ERP</span>
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
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors text-left ${
                        isActive(child.path)
                          ? 'bg-white/[0.08] text-white font-semibold'
                          : 'text-white/45 hover:text-white/80 hover:bg-white/[0.04]'
                      }`}
                    >
                      {isActive(child.path) && (
                        <div className="w-0.5 h-4 bg-[oklch(0.58_0.17_255)] absolute left-0" />
                      )}
                      <span className={`${collapsed ? 'mx-auto' : ''} tracking-tight relative`}>
                        {collapsed ? child.label.slice(0, 2) : child.label}
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <button
                  onClick={() => router.push(item.path!)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors relative ${
                    isActive(item.path!)
                      ? 'bg-white/[0.08] text-white font-semibold'
                      : 'text-white/45 hover:text-white/80 hover:bg-white/[0.04]'
                  }`}
                >
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
        {/* Header bar */}
        <header className="h-14 bg-white border-b border-[oklch(0.91_0.006_264)] flex items-center justify-between px-6 flex-shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-[oklch(0.62_0.008_264)] font-mono tracking-wide">{pathname}</span>
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell />
            {user && (
              <span className="text-[13px] font-medium text-[oklch(0.18_0.012_265)] tracking-tight">
                {user.displayName}
              </span>
            )}
            <button onClick={logout}
              className="flex items-center gap-1.5 text-[12px] text-[oklch(0.55_0.008_264)] hover:text-[oklch(0.50_0.18_22)] transition-colors tracking-tight">
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
