'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';
import NotificationBell from './notification-bell';
import RecentProjects from './recent-projects';
import {
  Gavel,
  LogOut, PanelLeftClose, PanelLeft,
} from 'lucide-react';
import { portalURL } from '@water-erp/config';

// 未登录/登出时跳转"在线开评标系统"统一登录入口（专家门户）。
// 由 @water-erp/config 的 PORTS 派生，端口重分配后无需手动同步。
const LOGIN_URL = portalURL('expert', '/login?forceLogin=1');

interface NavItem {
  label: string;
  caption?: string;
  path: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

// Phase 3：:3007 为纯开标执行终端，仅余开标大厅一个业务入口（任务板 + 大厅）。
// 项目管理 / 评标 / 澄清 / 归档全部归 :3005 采购管理工作台。
const navItems: NavItem[] = [
  { label: '开标大厅', caption: '开标任务 · 在线开标', path: '/bid', icon: Gavel },
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

  // 单一入口：任务板(/bid) 与开标大厅(/bid/open) 均高亮
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  const registeredName = user?.displayName?.trim() || user?.username || '用户';
  const userInitial = registeredName.slice(0, 1);

  return (
    <div className="flex h-screen flex-col overflow-hidden workbench-page-bg text-[#18243a]">
      {/* ── Header — sticky glass bar ── */}
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-white/30 bg-white/78 backdrop-blur-xl">
        <div className="flex h-[68px] items-center justify-between px-6">
          <button onClick={() => router.push('/bid')} className="flex items-center gap-3 text-left">
            <img src="/assets/logo.png" alt="智慧水发 · 蜀水云采" className="h-10 w-auto object-contain" />
            <div>
              <strong
                className="block text-lg font-black tracking-[0.10em]"
                style={{
                  fontFamily: '"SimHei","黑体",sans-serif',
                  background: 'linear-gradient(to right, #1a2332, #2563EB, #0891b2, #18a56c, #1a2332)',
                  backgroundSize: '200% auto',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  animation: 'brandShift 6s ease infinite',
                }}
              >
                智慧水发 · 蜀水云采
              </strong>
            </div>
          </button>

          <div className="flex items-center gap-3">
            <NotificationBell />
            <div className="flex items-center gap-2 rounded-xl border border-[#e5ecf4] bg-white px-3 py-1.5 shadow-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#064ea2] to-[#0b63ce] text-[11px] font-black text-white">
                {userInitial}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="text-[13px] font-black text-[#18243a]">{registeredName}</div>
              </div>
            </div>
            <button
              onClick={logout}
              className="rounded-xl border border-[#d5e0ef] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#5a6d8a] transition hover:border-[#e74c3c] hover:text-[#e74c3c]"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      {/* ── Body: floating sidebar + content ── */}
      <div className="flex flex-1 overflow-hidden">
        <aside className={`${collapsed ? 'w-[68px]' : 'w-[200px]'} m-3 mr-0 flex flex-shrink-0 flex-col overflow-hidden rounded-[24px] border border-[#dbe6f3] bg-white/88 shadow-[0_18px_60px_rgba(15,47,87,0.10)] backdrop-blur transition-all duration-200`}>
          <nav className="flex-1 overflow-y-auto px-2 py-3">
            {navItems.map(item => (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className={`relative flex w-full items-center gap-3 rounded-2xl px-3 py-3 mb-1.5 text-left transition-all ${
                  isActive(item.path)
                    ? 'bg-gradient-to-r from-[#064ea2] to-[#0b63ce] text-white shadow-[0_12px_28px_rgba(6,78,162,0.24)]'
                    : 'text-[#5a6d8a] hover:bg-[#eff6ff] hover:text-[#064ea2]'
                }`}
              >
                {isActive(item.path) && <div className="absolute left-0 h-6 w-[3px] rounded-r bg-[#67e8f9]" />}
                <div className="flex-shrink-0"><item.icon size={collapsed ? 20 : 18} strokeWidth={1.7} /></div>
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black tracking-tight">{item.label}</span>
                    {item.caption && <span className="mt-0.5 block truncate text-[11px] opacity-70">{item.caption}</span>}
                  </span>
                )}
              </button>
            ))}
            {!collapsed && <RecentProjects />}
          </nav>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="m-2 flex h-11 items-center justify-center rounded-2xl border border-[#e5ecf4] bg-[#f8fbff] text-[#5a6d8a] transition-colors hover:border-[#bfdbfe] hover:text-[#064ea2]"
          >
            {collapsed ? <PanelLeft size={16} strokeWidth={1.7} /> : <PanelLeftClose size={16} strokeWidth={1.7} />}
          </button>
        </aside>

        {/* ── Content area ── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
