'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';
import {
  LayoutDashboard, Building2, Megaphone, UsersRound,
  PanelLeftClose, PanelLeft, ChevronDown,
} from 'lucide-react';

interface NavChild {
  label: string;
  path: string;
}
interface NavItem {
  label: string;
  path?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  children?: NavChild[];
}

const navItems: NavItem[] = [
  { label: '首页驾驶舱', path: '/dashboard', icon: LayoutDashboard },
  { label: '信息发布中心', path: '/notice', icon: Megaphone },
  {
    label: '供应商管理中心', path: '/supplier', icon: Building2,
    children: [
      { label: '供应商审批', path: '/supplier/approval' },
      { label: '供应商库', path: '/supplier/repository' },
      { label: '供应商选取', path: '/supplier/selection' },
      { label: '供应商评价', path: '/supplier/evaluation' },
    ],
  },
  {
    label: '专家管理中心', path: '/expert', icon: UsersRound,
    children: [
      { label: '专家录入', path: '/expert/entry' },
      { label: '专家库', path: '/expert/repository' },
      { label: '专家抽取', path: '/expert/extract' },
      { label: '专家评价', path: '/expert/evaluation' },
    ],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  // 展开状态：初始展开当前路由所在的分组
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const item of navItems) {
      if (item.children && item.path && pathname.startsWith(item.path + '/')) s.add(item.path);
    }
    return s;
  });
  // 路由切换到某分组子项时，自动展开该分组
  useEffect(() => {
    for (const item of navItems) {
      if (item.children && item.path && pathname.startsWith(item.path + '/') && !openGroups.has(item.path)) {
        setOpenGroups(prev => new Set(prev).add(item.path!));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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

  const registeredName = user?.displayName?.trim() || user?.username || '未登录';
  const userInitial = registeredName.slice(0, 1);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f7f9fc]">
      {/* ── Top header — mall-style, full width ── */}
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-[#dce6f3] bg-white/95 backdrop-blur-xl">
        <div className="flex h-[72px] items-center justify-between px-6">
          {/* Brand */}
          <button onClick={() => router.push('/dashboard')} className="flex items-center gap-3">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-11 w-auto object-contain" />
            <strong
              className="block text-xl font-black tracking-[0.12em] text-[#123a6e]"
              style={{ fontFamily: '"SimHei","黑体",sans-serif' }}
            >
              四川水发集团
            </strong>
          </button>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl bg-[#f3f7fc] px-3 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#064ea2] text-xs font-black text-white">
                {userInitial}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-black text-[#18243a]">{registeredName}</div>
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
            {navItems.map(item => {
              const hasChildren = !!item.children?.length;
              const groupActive = hasChildren && item.path !== undefined && isActive(item.path);
              const groupOpen = hasChildren && item.path !== undefined && openGroups.has(item.path);

              const onGroupClick = () => {
                if (collapsed || !item.children?.length) {
                  // 折叠态：直接进入首个子页
                  router.push(item.children![0].path);
                  return;
                }
                setOpenGroups(prev => {
                  const next = new Set(prev);
                  if (next.has(item.path!)) next.delete(item.path!);
                  else next.add(item.path!);
                  return next;
                });
              };

              return (
                <div key={item.path} className="mb-1">
                  <button
                    onClick={hasChildren ? onGroupClick : () => router.push(item.path!)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] transition-colors relative rounded-lg ${
                      (hasChildren ? groupActive : isActive(item.path!))
                        ? 'bg-[#064ea2] text-white font-semibold shadow-[0_8px_20px_rgba(6,78,162,0.28)]'
                        : 'text-white/50 hover:text-white/85 hover:bg-white/[0.05]'
                    }`}
                  >
                    {isActive(item.path!) && (
                      <div className="w-[3px] h-4 bg-[#7dd3fc] rounded-r absolute left-0" />
                    )}
                    <div className="flex-shrink-0"><item.icon size={collapsed ? 18 : 16} strokeWidth={1.5} /></div>
                    {!collapsed && <span className="tracking-tight flex-1 text-left">{item.label}</span>}
                    {hasChildren && !collapsed && (
                      <ChevronDown
                        size={14}
                        strokeWidth={2}
                        className={`flex-shrink-0 text-white/40 transition-transform ${groupOpen ? 'rotate-180' : ''}`}
                      />
                    )}
                  </button>

                  {/* 子菜单 */}
                  {hasChildren && !collapsed && groupOpen && (
                    <div className="mt-0.5 ml-3 pl-3 border-l border-white/[0.08]">
                      {item.children!.map(child => (
                        <button
                          key={child.path}
                          onClick={() => router.push(child.path)}
                          className={`w-full flex items-center px-3 py-2 my-0.5 text-[12.5px] rounded-lg transition-colors ${
                            pathname === child.path
                              ? 'bg-white/[0.08] text-white font-semibold'
                              : 'text-white/45 hover:text-white/80 hover:bg-white/[0.04]'
                          }`}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
