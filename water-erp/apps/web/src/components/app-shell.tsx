'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@/lib/types';
import {
  LayoutDashboard, Building2, Megaphone, UsersRound,
  PanelLeftClose, PanelLeft, ChevronDown, ShoppingCart,
} from 'lucide-react';
import { NotificationCenter } from '@/components/workbench/notification-center';
import { CommandPalette } from '@/components/workbench/command-palette';
import { useNotifications } from '@/lib/hooks/use-notifications';

interface NavChild {
  label: string;
  path: string;
  badgeKey?: string;
}
interface NavItem {
  label: string;
  caption?: string;
  path?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  children?: NavChild[];
}

const navItems: NavItem[] = [
  { label: '首页驾驶舱', caption: '运营总览', path: '/dashboard', icon: LayoutDashboard },
  { label: '信息发布中心', caption: '公告 / 公示 / 政策', path: '/notice', icon: Megaphone },
  {
    label: '供应商管理中心', caption: '审批 / 库 / 评价', path: '/supplier', icon: Building2,
    children: [
      { label: '供应商审批', path: '/supplier/approval', badgeKey: 'supplierPending' },
      { label: '供应商库', path: '/supplier/repository' },
      { label: '供应商选取', path: '/supplier/selection' },
      { label: '供应商评价', path: '/supplier/evaluation' },
    ],
  },
  {
    label: '专家管理中心', caption: '录入 / 抽取 / 履职', path: '/expert', icon: UsersRound,
    children: [
      { label: '专家录入', path: '/expert/entry' },
      { label: '专家库', path: '/expert/repository' },
      { label: '专家抽取', path: '/expert/extract' },
      { label: '专家评价', path: '/expert/evaluation' },
    ],
  },
  {
    label: '电子商城管理', caption: '价格 / 目录 / 日志', path: '/mall-management', icon: ShoppingCart,
    children: [
      { label: '价格审批', path: '/mall-management/approval', badgeKey: 'mallReview' },
      { label: '价格录入', path: '/mall-management/price-entry' },
      { label: '集中采购目录管理', path: '/mall-management/catalog' },
      { label: '同步与操作日志', path: '/mall-management/logs' },
    ],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const { derivedTodo } = useNotifications();
  const badges: Record<string, number> = { supplierPending: derivedTodo.supplierPending, mallReview: derivedTodo.priceReview };

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const item of navItems) {
      if (item.children && item.path && pathname.startsWith(item.path + '/')) s.add(item.path);
    }
    return s;
  });

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
    <div className="flex h-screen flex-col overflow-hidden workbench-page-bg text-[#18243a]">
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-[#dbe6f3] bg-white/86 backdrop-blur-xl">
        <div className="flex h-[68px] items-center justify-between px-6">
          <button onClick={() => router.push('/dashboard')} className="flex items-center gap-3 text-left">
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
            <NotificationCenter />
            <div className="flex items-center gap-2 rounded-xl border border-[#e5ecf4] bg-white px-3 py-2 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#064ea2] to-[#0b63ce] text-xs font-black text-white">
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

      <div className="flex flex-1 overflow-hidden">
        <aside className={`${collapsed ? 'w-[68px]' : 'w-[272px]'} m-3 mr-0 flex flex-shrink-0 flex-col overflow-hidden rounded-[24px] border border-[#dbe6f3] bg-white/88 shadow-[0_18px_60px_rgba(15,47,87,0.10)] backdrop-blur transition-all duration-200`}>
          <nav className="flex-1 overflow-y-auto px-2 py-3">
            {navItems.map(item => {
              const hasChildren = !!item.children?.length;
              const groupActive = hasChildren && item.path !== undefined && isActive(item.path);
              const groupOpen = hasChildren && item.path !== undefined && openGroups.has(item.path);

              const onGroupClick = () => {
                if (collapsed || !item.children?.length) {
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
                <div key={item.path} className="mb-1.5">
                  <button
                    onClick={hasChildren ? onGroupClick : () => router.push(item.path!)}
                    className={`relative flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all ${
                      (hasChildren ? groupActive : isActive(item.path!))
                        ? 'bg-gradient-to-r from-[#064ea2] to-[#0b63ce] text-white shadow-[0_12px_28px_rgba(6,78,162,0.24)]'
                        : 'text-[#5a6d8a] hover:bg-[#eff6ff] hover:text-[#064ea2]'
                    }`}
                  >
                    {isActive(item.path!) && <div className="absolute left-0 h-6 w-[3px] rounded-r bg-[#67e8f9]" />}
                    <div className="flex-shrink-0"><item.icon size={collapsed ? 20 : 18} strokeWidth={1.7} /></div>
                    {!collapsed && (
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-black tracking-tight">{item.label}</span>
                        {item.caption && <span className="mt-0.5 block truncate text-[11px] opacity-70">{item.caption}</span>}
                      </span>
                    )}
                    {hasChildren && !collapsed && (
                      <ChevronDown size={14} strokeWidth={2} className={`flex-shrink-0 opacity-60 transition-transform ${groupOpen ? 'rotate-180' : ''}`} />
                    )}
                  </button>

                  {hasChildren && !collapsed && groupOpen && (
                    <div className="ml-5 mt-1.5 border-l border-[#dbeafe] pl-3">
                      {item.children!.map(child => (
                        <button
                          key={child.path}
                          onClick={() => router.push(child.path)}
                          className={`my-0.5 flex w-full items-center rounded-xl px-3 py-2 text-left text-[12.5px] transition-colors ${
                            pathname === child.path
                              ? 'bg-[#eff6ff] font-bold text-[#064ea2]'
                              : 'text-[#6b7c95] hover:bg-[#f8fbff] hover:text-[#064ea2]'
                          }`}
                        >
                          <span className="flex-1">{child.label}</span>
                          {child.badgeKey && badges[child.badgeKey] > 0 && (
                            <span className={`ml-2 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-extrabold tabular-nums ${
                              pathname === child.path
                                ? 'bg-[#064ea2] text-white'
                                : 'bg-[#e74c3c] text-white'
                            }`}>
                              {badges[child.badgeKey] > 99 ? '99+' : badges[child.badgeKey]}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            className="m-2 flex h-11 items-center justify-center rounded-2xl border border-[#e5ecf4] bg-[#f8fbff] text-[#5a6d8a] transition-colors hover:border-[#bfdbfe] hover:text-[#064ea2]"
          >
            {collapsed ? <PanelLeft size={16} strokeWidth={1.7} /> : <PanelLeftClose size={16} strokeWidth={1.7} />}
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}
