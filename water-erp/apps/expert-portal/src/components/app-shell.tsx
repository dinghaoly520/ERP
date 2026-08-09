'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '../lib/types';
import {
  LayoutDashboard, ClipboardList, ClipboardCheck, UserCircle, UserRound,
  AlertTriangle, RefreshCw, LogOut, ChevronDown, ChevronLeft, ChevronRight,
} from 'lucide-react';
import ContactConfirmModal from './contact-confirm-modal';
import { api } from '../lib/api';

const LOGIN_URL = '/login';

type NavItem = { key: string; label: string; caption?: string; path: string; icon: typeof LayoutDashboard };
type NavGroup = { key: string; label: string; icon: typeof LayoutDashboard; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    key: 'review',
    label: '评审工作',
    icon: ClipboardCheck,
    items: [
      { key: 'workbench', label: '工作台', caption: '评审总览', path: '/', icon: LayoutDashboard },
      { key: 'projects', label: '评审项目', caption: '项目列表', path: '/projects', icon: ClipboardList },
    ],
  },
  {
    key: 'me',
    label: '个人',
    icon: UserRound,
    items: [
      { key: 'profile', label: '个人信息', caption: '资料管理', path: '/profile', icon: UserCircle },
    ],
  },
];

function keyForPath(pathname: string): string {
  if (pathname === '/') return 'workbench';
  if (pathname.startsWith('/projects')) return 'projects';
  if (pathname.startsWith('/profile')) return 'profile';
  return '';
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [authError, setAuthError] = useState(false);
  const [authRetrying, setAuthRetrying] = useState(false);
  const [contactInfo, setContactInfo] = useState<{ phone: string; email: string; displayName: string; contactConfirmedAt: string | null } | null>(null);

  const checkAuth = () => {
    setAuthRetrying(true);
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => {
        if (r.status === 401) { router.replace(LOGIN_URL); return null; }
        return r.ok ? r.json() : null;
      })
      .then(u => {
        if (!u) { router.replace(LOGIN_URL); return; }
        setUser(u);
        setAuthError(false);
        setAuthRetrying(false);
      })
      .catch(() => {
        setAuthError(true);
        setAuthRetrying(false);
        // Auto-retry once after 3 seconds
        setTimeout(() => {
          if (!user) checkAuth();
        }, 3000);
      });
  };

  useEffect(() => { checkAuth(); }, []);

  useEffect(() => {
    if (!user) return;
    api.get<{ phone: string; email: string; displayName: string; contactConfirmedAt: string | null }>('/expert/profile/contact-check')
      .then(setContactInfo)
      .catch(() => { /* 检查失败时不阻断使用（fail-open） */ });
  }, [user]);

  // 侧栏折叠状态持久化（localStorage，与 web :3005 一致）
  useEffect(() => {
    const stored = window.localStorage.getItem('expert-shell:sidebar-hidden');
    if (stored === '1') setSidebarHidden(true);
  }, []);
  useEffect(() => {
    window.localStorage.setItem('expert-shell:sidebar-hidden', sidebarHidden ? '1' : '0');
  }, [sidebarHidden]);

  const logout = () => {
    // 退出不等 API 响应 —— fire-and-forget 销毁服务端会话，立即跳转登录页
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'X-Portal': 'expert' },
      credentials: 'include',
    }).catch(() => {});
    router.replace(LOGIN_URL);
  };

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const activeKey = keyForPath(pathname);

  return (
    <div className="flow-page ambient-grid flex h-screen flex-col overflow-hidden px-2.5 pb-2.5 text-[var(--foreground)] sm:px-3.5 lg:pl-0 lg:pr-4">
      {/* cgzxui 水彩光晕 —— 玻璃侧栏背后漂移的色彩层 */}
      <div className="flow-glow" aria-hidden />

      <div className="mx-auto flex h-full w-full overflow-hidden [perspective:1500px]">
        <aside
          data-hidden={sidebarHidden ? 'true' : 'false'}
          className="sidebar-sheen sidebar-3d sidebar-card mr-4 flex h-full w-[268px] shrink-0 flex-col rounded-tl-[24px] rounded-tr-[24px] rounded-br-[24px] rounded-bl-none pr-2"
        >
          {/* 品牌球 + 标题 */}
          <header className="flex flex-col items-center gap-2 px-3.5 pb-3.5 pt-4">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="brand-orb-3d exp-brand-orb flex h-12 w-12 shrink-0 items-center justify-center"
              aria-label="返回工作台"
            >
              <img src="/assets/logo.png" alt="智慧水发 · 专家门户" className="h-[42px] w-[42px] object-contain" />
            </button>
            <div className="w-full text-center">
              <div className="truncate text-[1rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                智慧水发 · 专家门户
              </div>
            </div>
          </header>

          <div aria-hidden className="mx-3.5 h-px bg-[linear-gradient(90deg,transparent,rgba(160,178,210,0.70),transparent)]" />

          {/* 分组导航 */}
          <nav className="sidebar-scroll sidebar-nav mt-1.5 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
            {navGroups.map(group => {
              const GroupIcon = group.icon;
              const isCollapsed = collapsedGroups.has(group.key);
              return (
                <div key={group.key} className="mb-0.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="sidebar-group-header flex w-full items-center gap-2 rounded-[12px] px-2 py-1.5 text-left transition-all duration-300"
                  >
                    <GroupIcon size={14} className="shrink-0 text-[color:var(--muted-foreground)]" strokeWidth={1.7} />
                    <span className="flex-1 text-sm font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
                      {group.label}
                    </span>
                    <ChevronDown
                      size={12}
                      className={`shrink-0 text-[color:var(--muted-foreground)] transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                    />
                  </button>

                  <div className={`sidebar-group-panel ml-1 border-l border-white/60 pl-1.5 ${!isCollapsed ? 'is-open' : ''}`}>
                    <div className="space-y-0.5">
                      {group.items.map(item => {
                        const Icon = item.icon;
                        const active = item.key === activeKey;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            data-active={active}
                            onClick={() => router.push(item.path)}
                            className="sidebar-nav-item group relative"
                            title={item.label}
                          >
                            {active && <span className="nav-active-skew absolute bottom-2 left-[2px] top-2 w-[2.5px]" />}
                            <Icon size={16} className="shrink-0" strokeWidth={1.7} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{item.label}</span>
                              {item.caption && (
                                <span className="block truncate text-[11px] text-[color:var(--muted-foreground)]">{item.caption}</span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>

          {/* 侧栏底栏 —— 退出 */}
          <div className="px-2.5 pb-3 pt-2">
            <div aria-hidden className="mx-1 mb-2.5 h-px bg-[linear-gradient(90deg,transparent,rgba(160,178,210,0.6),transparent)]" />
            <button onClick={logout} className="neu-btn-soft is-danger w-full justify-center">
              <LogOut size={15} strokeWidth={1.7} />
              <span>退出登录</span>
            </button>
          </div>

          {/* 右边缘折叠手柄 */}
          <button
            type="button"
            onClick={() => setSidebarHidden(true)}
            aria-label="收起菜单栏"
            className="sidebar-edge-tab group absolute right-0 top-1/2 z-20 flex h-8 w-[13px] -translate-y-1/2 items-center justify-center rounded-l-[7px] border border-r-0 border-white/85 bg-[linear-gradient(90deg,rgba(241,245,251,0.62),rgba(255,255,255,0.95))] text-[color:var(--muted-foreground)] shadow-[-4px_0_7px_-3px_rgba(69,99,158,0.22)] transition-colors duration-200 hover:bg-white hover:text-[color:var(--accent)]"
          >
            <ChevronLeft size={12} />
          </button>
        </aside>

        {/* 折叠态 —— 左边缘展开手柄 */}
        {sidebarHidden && (
          <button
            type="button"
            onClick={() => setSidebarHidden(false)}
            aria-label="展开菜单栏"
            className="sidebar-edge-tab group fixed left-0 top-1/2 z-30 flex h-8 w-[13px] -translate-y-1/2 items-center justify-center rounded-r-[7px] border border-l-0 border-white/85 bg-[linear-gradient(270deg,rgba(241,245,251,0.62),rgba(255,255,255,0.95))] text-[color:var(--muted-foreground)] shadow-[4px_0_7px_-3px_rgba(69,99,158,0.22)] transition-colors duration-200 hover:bg-white hover:text-[color:var(--accent)]"
          >
            <ChevronRight size={12} />
          </button>
        )}

        <section className="flex h-full min-h-0 min-w-0 flex-1 overflow-visible px-1">
          <main className="relative z-10 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-visible p-3.5 sm:p-4 lg:p-4">
            <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
              {authError && (
                <div className="mb-3">
                  <div className="exp-alert exp-alert--warn flex items-center gap-3">
                    <AlertTriangle size={16} strokeWidth={1.6} className="shrink-0" />
                    <span className="flex-1">身份验证失败，请检查网络后重试</span>
                    <button onClick={checkAuth} disabled={authRetrying} className="neu-btn-xs is-warning">
                      <RefreshCw size={12} className={authRetrying ? 'animate-spin' : ''} />
                      {authRetrying ? '重试中…' : '重试'}
                    </button>
                  </div>
                </div>
              )}
              {children}
            </div>
          </main>
        </section>
      </div>

      {contactInfo && !contactInfo.contactConfirmedAt && (
        <ContactConfirmModal
          initialPhone={contactInfo.phone}
          initialEmail={contactInfo.email}
          displayName={contactInfo.displayName}
          onConfirmed={() => setContactInfo(prev => (prev ? { ...prev, contactConfirmedAt: new Date().toISOString() } : prev))}
        />
      )}
    </div>
  );
}
