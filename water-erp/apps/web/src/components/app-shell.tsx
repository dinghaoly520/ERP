'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';
import NotificationBell from './notification-bell';
import {
  LayoutDashboard, Building2, Megaphone, UsersRound,
  LogOut, PanelLeftClose, PanelLeft,
} from 'lucide-react';

interface NavItem {
  label: string;
  path?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

const navItems: NavItem[] = [
  { label: '首页驾驶舱', path: '/dashboard', icon: LayoutDashboard },
  { label: '信息发布中心', path: '/notice', icon: Megaphone },
  { label: '供应商管理中心', path: '/supplier', icon: Building2 },
  { label: '专家管理中心', path: '/expert', icon: UsersRound },
];

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  bid_host: '开标主持人',
  procurement_staff: '采购管理员',
  bid_expert: '评审专家',
  supplier: '供应商',
  mall: '商城采购员',
};

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

  const registeredName = user?.displayName?.trim() || user?.username || '未登录';
  const userInitial = registeredName.slice(0, 1);
  const roleLabel = user?.role ? ROLE_LABELS[user.role] || user.role : '';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f7f9fc]">
      {/* ── Top header — mall-style, full width ── */}
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-[#dce6f3] bg-white/95 backdrop-blur-xl">
        <div className="flex h-[72px] items-center justify-between px-6">
          {/* Brand */}
          <button onClick={() => router.push('/dashboard')} className="flex items-center gap-3">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-11 w-auto object-contain" />
            <span className="flex flex-col items-start leading-tight">
              <strong
                className="block text-xl font-black tracking-[0.12em] text-[#123a6e]"
                style={{ fontFamily: '"SimHei","黑体",sans-serif' }}
              >
                四川水发集团
              </strong>
              <span className="text-[11px] font-medium tracking-wide text-[#5a6d8a]">
                智慧水发 · 采购管理工作台
              </span>
            </span>
          </button>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <NotificationBell />
            <div className="flex items-center gap-2 rounded-xl bg-[#f3f7fc] px-3 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#064ea2] text-xs font-black text-white">
                {userInitial}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-black text-[#18243a]">{registeredName}</div>
                {roleLabel && <div className="text-[11px] text-[#8a96aa]">{roleLabel}</div>}
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

      {/* ── Body: sidebar + main ── */}
      <div className="flex flex-1 overflow-hidden">
        <aside
          className={`${collapsed ? 'w-[56px]' : 'w-56'} bg-[#0d2a4a] text-white flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden`}
        >
          {/* Nav items */}
          <nav className="flex-1 overflow-y-auto py-3 px-2">
            {navItems.map(item => (
              <button
                key={item.path}
                onClick={() => router.push(item.path!)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 mb-1 text-[13px] transition-colors relative rounded-lg ${
                  isActive(item.path!)
                    ? 'bg-[#064ea2] text-white font-semibold shadow-[0_8px_20px_rgba(6,78,162,0.28)]'
                    : 'text-white/50 hover:text-white/85 hover:bg-white/[0.05]'
                }`}
              >
                {isActive(item.path!) && (
                  <div className="w-[3px] h-4 bg-[#7dd3fc] rounded-r absolute left-0" />
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

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
