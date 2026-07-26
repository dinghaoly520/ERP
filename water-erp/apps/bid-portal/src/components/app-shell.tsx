'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';
import NotificationBell from './notification-bell';
import RecentProjects from './recent-projects';
import {
  Gavel,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
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

  // 顶栏左侧上下文标签：大厅实时执行 vs 任务板
  // 大厅实际路由为工作区 /bid/project/[id]（open tab）；/bid/open 仅重定向中间态。
  const inHall =
    pathname?.startsWith('/bid/open') || pathname?.startsWith('/bid/project/');
  const CtxIcon = inHall ? Gavel : ClipboardList;
  const ctxLabel = inHall ? '开标大厅 · 实时执行' : '开标任务板';

  return (
    <div className="flow-page ambient-grid h-screen overflow-hidden px-2.5 pb-2.5 sm:px-3.5 lg:pr-4 lg:pl-0">
      {/* cgzxui 水彩光晕 —— 五角 oklch 浅彩 bloom，作为玻璃面板背后漂移的色彩层 */}
      <div className="flow-glow" aria-hidden />

      <div className="mx-auto flex h-full w-full overflow-hidden [perspective:1500px]">
        {/* ── 3D 玻璃侧栏 ── */}
        <aside
          data-hidden={collapsed ? 'true' : 'false'}
          className="sidebar-sheen sidebar-3d sidebar-card mr-4 hidden h-full w-[268px] shrink-0 flex-col rounded-tl-[24px] rounded-tr-[24px] rounded-bl-none rounded-br-[24px] pr-2 lg:flex"
        >
          <header className="flex flex-col items-center gap-2 px-3.5 pb-3.5 pt-4">
            <button
              type="button"
              onClick={() => router.push('/bid')}
              className="command-orb brand-orb-3d flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px]"
              aria-label="返回开标任务板"
            >
              <img
                src="/assets/logo.png"
                alt="智慧水发·蜀水云采"
                className="h-[46px] w-[46px] rounded-[12px] object-cover"
              />
            </button>
            <div className="w-full text-center">
              <div className="truncate font-[family-name:var(--font-display)] text-[1rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                智慧水发 · 蜀水云采
              </div>
              <div className="mt-0.5 truncate text-[11px] font-medium tracking-[0.04em] text-[color:var(--muted-foreground)]">
                在线开评标执行终端
              </div>
            </div>
          </header>

          <div aria-hidden className="mx-3.5 h-px bg-[linear-gradient(90deg,transparent,oklch(0.7_0.04_258_/_0.5),transparent)]" />

          <nav className="sidebar-scroll sidebar-nav mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-1">
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
            {/* 统一浮动顶栏 */}
            <div className="flow-header">
              <div className="flex min-w-0 items-center gap-2.5">
                {/* 移动端品牌（侧栏隐藏时显示） */}
                <div className="flex items-center gap-2 lg:hidden">
                  <span className="flow-brand-mark">
                    <img src="/assets/logo.png" alt="智慧水发·蜀水云采" className="h-7 w-7 rounded-[8px] object-cover" />
                  </span>
                  <span className="truncate font-[family-name:var(--font-display)] text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--foreground)]">
                    智慧水发 · 蜀水云采
                  </span>
                </div>
                {/* 桌面端上下文标签 */}
                <div className="hidden items-center gap-2 lg:flex">
                  <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[oklch(0.62_0.16_258_/_0.12)] text-[color:var(--accent-strong)]">
                    <CtxIcon size={15} strokeWidth={1.7} />
                  </span>
                  <span className="truncate font-[family-name:var(--font-display)] text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--foreground)]">
                    {ctxLabel}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <NotificationBell />
                <span className="neu-chip rounded-[11px] px-2.5 py-1.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent-strong),var(--accent))] text-[11px] font-black text-white">
                    {userInitial}
                  </span>
                  <span className="hidden text-[13px] font-semibold text-[color:var(--foreground)] sm:block">{registeredName}</span>
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="neu-btn-soft h-[38px] !px-3"
                >
                  <LogOut size={15} strokeWidth={1.7} />
                  <span className="hidden sm:inline">退出登录</span>
                </button>
              </div>
            </div>

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
