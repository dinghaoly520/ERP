'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';
import NotificationBell from './notification-bell';
import {
  Gavel,
  Archive,
  LogOut,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { portalURL } from '@water-erp/config';

// 未登录/登出时跳转"在线开评标系统"统一登录入口（专家门户）。
// 由 @water-erp/config 的 PORTS 派生，端口重分配后无需手动同步。
const LOGIN_URL = portalURL('expert', '/login?forceLogin=1');

interface NavItem {
  label: string;
  caption?: string;
  path: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

// Phase 3 + 归档恢复：:3007 为纯开标执行终端，仅开标大厅 + 归档端（只读回看）。
// 项目管理 / 评标 / 澄清 / 归档操作全部归 :3005 采购管理工作台。
// （加密证书管理曾短暂设于本端侧栏/专页，2026-08-28 迁 :3005 系统管理——证书轮转属
// 投递期管理动作，按分工 v3 归 :3005；:3007 现场解外层全自动无需管理入口。）
const navItems: NavItem[] = [
  { label: '开标大厅', caption: '开标任务 · 在线开标', path: '/bid', icon: Gavel },
  { label: '归档端', caption: '已归档项目', path: '/bid/archive', icon: Archive },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('bid-portal.sidebar-collapsed') === '1';
  });

  useEffect(() => {
    localStorage.setItem('bid-portal.sidebar-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(u => { if (!u) window.location.href = LOGIN_URL; else setUser(u); })
      .catch(() => { window.location.href = LOGIN_URL; });
  }, []);

  // 用户菜单（复刻 :3004 sp-user-pill：点 pill 开下拉，点外部收起）
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!userMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [userMenuOpen]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = LOGIN_URL;
  };

  // 单一入口：任务板(/bid) 与项目工作区(/bid/project/[id]) 均高亮
  const isActive = (path: string) => {
    if (path === '/bid') return pathname === '/bid' || (pathname.startsWith('/bid/') && !pathname.startsWith('/bid/archive'));
    return pathname === path || pathname.startsWith(path + '/');
  };

  const registeredName = user?.displayName?.trim() || user?.username || '用户';
  const userInitial = registeredName.slice(0, 1);

  return (
    <div className="flow-page ambient-grid flex h-screen flex-col overflow-hidden">
      {/* cgzxui 水彩光晕 —— 五角 oklch 浅彩 bloom，作为玻璃面板背后漂移的色彩层 */}
      <div className="flow-glow" aria-hidden />

      {/* 统一顶栏 —— 整宽置于侧栏之上，复刻 :3004 sp-header：brand 落左上角（即左侧 panel 区） */}
      <div className="sp-header w-full shrink-0">
        <div className="sp-header-left">
          <button
            type="button"
            onClick={() => router.push('/bid')}
            className="sp-brand"
            aria-label="返回开标任务板"
          >
            <img src="/assets/logo.png" alt="蜀水云采·开评标系统" className="sp-brand-logo" />
            <strong className="sp-brand-title">蜀水云采 · 开评标系统</strong>
          </button>
        </div>

        <div className="sp-header-right">
          <NotificationBell />
          {/* 用户 pill + 下拉菜单（复刻 :3004 顶栏右侧：退出登录收进菜单，不再独立成钮） */}
          <div className="sp-notif-anchor" ref={userMenuRef}>
            <button
              type="button"
              className="sp-user-pill"
              aria-label={`${registeredName}账户菜单`}
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen(v => !v)}
            >
              <span className="sp-user-avatar">{userInitial}</span>
              <span className="sp-user-name">{registeredName}</span>
              <ChevronDown size={12} className={`sp-user-arrow${userMenuOpen ? ' rotate-180' : ''}`} />
            </button>
            {userMenuOpen && (
              <div className="sp-user-menu">
                <button type="button" className="sp-user-menu-item" onClick={() => void logout()}>
                  <LogOut size={15} aria-hidden="true" />退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full flex-1 gap-0 overflow-hidden px-3 pb-3 pt-3 [perspective:1500px]">
        {/* ── 3D 玻璃侧栏 ── */}
        <aside
          data-hidden={collapsed ? 'true' : 'false'}
          className="sidebar-sheen sidebar-3d sidebar-card hidden h-full shrink-0 flex-col lg:flex"
        >
          {/* nav — 与 :3004 sp-nav 同款节奏（mt-1.5 / px-2 py-1 / gap 2px / 顶部 16px 呼吸） */}
          <nav className="sidebar-scroll sidebar-nav min-h-0 flex-1 overflow-y-auto" style={{ marginTop: 6, padding: '16px 8px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {navItems.map(item => {
              const active = isActive(item.path);
              const Icon = item.icon;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => router.push(item.path)}
                  data-active={active}
                  className="sidebar-nav-item group relative"
                >
                  {active ? (
                    <span className="nav-active-skew absolute bottom-2 left-[2px] top-2 w-[2.5px]" />
                  ) : null}
                  <Icon size={16} strokeWidth={1.7} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* 底部折叠区（与 :3004 同款：渐隐发丝线 + 导航项同款按钮；rail 态按钮翻转变为展开）*/}
          {!collapsed && <div aria-hidden className="sp-sidebar-hairline" />}
          <div className="sp-collapse-zone">
            <button
              type="button"
              onClick={() => setCollapsed(v => !v)}
              aria-label={collapsed ? '展开菜单栏' : '收起菜单栏'}
              aria-expanded={!collapsed}
              title={collapsed ? '展开菜单栏' : '收起菜单栏'}
              className="sidebar-nav-item justify-center"
            >
              {collapsed
                ? <ChevronRight size={16} strokeWidth={1.7} aria-hidden="true" />
                : <ChevronLeft size={16} strokeWidth={1.7} aria-hidden="true" />}
            </button>
          </div>
        </aside>

        {/* ── 内容区 ── */}
        <section className="flex h-full min-w-0 flex-1 flex-col px-1">
          <main className="relative z-10 flex h-full min-h-0 flex-1 flex-col p-2.5 sm:p-3">
            {/* 页面内容滚动区 */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {children}
            </div>
          </main>
        </section>
      </div>
    </div>
  );
}
