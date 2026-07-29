'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';
import NotificationBell from './notification-bell';
import RecentProjects from './recent-projects';
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
const navItems: NavItem[] = [
  { label: '开标大厅', caption: '开标任务 · 在线开标', path: '/bid', icon: Gavel },
  { label: '归档端', caption: '已归档项目', path: '/bid/archive', icon: Archive },
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
            <img src="/assets/logo.png" alt="智慧水发·蜀水云采" className="sp-brand-logo" />
            <strong className="sp-brand-title">智慧水发 · 蜀水云采</strong>
          </button>
        </div>

        <div className="sp-header-right">
          <NotificationBell />
          <span className="sp-user-pill">
            <span className="sp-user-avatar">{userInitial}</span>
            <span className="sp-user-name">{registeredName}</span>
            <ChevronDown size={12} className="sp-user-arrow" />
          </span>
          <button type="button" onClick={logout} className="sp-logout-btn">
            <LogOut size={15} strokeWidth={1.7} />
            <span>退出登录</span>
          </button>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full flex-1 gap-3 overflow-hidden px-3 pb-3 pt-3 [perspective:1500px]">
        {/* ── 3D 玻璃侧栏 ── */}
        <aside
          data-hidden={collapsed ? 'true' : 'false'}
          className="sidebar-sheen sidebar-3d sidebar-card hidden h-full w-[268px] shrink-0 flex-col rounded-[24px] pr-2 lg:flex"
        >
          {/* 品牌块已上移至顶栏 sp-brand；侧栏顶部仅留呼吸 padding */}
          <nav className="sidebar-scroll sidebar-nav mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pt-3 pb-1">
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
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.label}</span>
                    {item.caption ? (
                      <span className="mt-0.5 block truncate text-[11px] text-[color:var(--muted-foreground)]">{item.caption}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}

            <RecentProjects />
          </nav>

          {/* 右边缘折叠手柄 —— 点击向左折叠 */}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="收起菜单栏"
            className="sidebar-edge-tab right-0 top-1/2 z-20 flex h-8 w-[13px] -translate-y-1/2 items-center justify-center rounded-l-[7px]"
          >
            <ChevronLeft size={12} />
          </button>
        </aside>

        {/* 折叠态：左缘展开手柄 */}
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="展开菜单栏"
            className="sidebar-edge-tab fixed left-0 top-1/2 z-30 hidden h-8 w-[13px] -translate-y-1/2 items-center justify-center rounded-r-[7px] lg:flex"
          >
            <ChevronRight size={12} />
          </button>
        ) : null}

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
