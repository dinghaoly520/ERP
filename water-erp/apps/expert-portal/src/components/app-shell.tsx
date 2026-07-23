'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '../lib/types';
import {
  LayoutDashboard, ClipboardList, UserCircle,
  PanelLeftClose, PanelLeft, AlertTriangle, RefreshCw, LogOut,
} from 'lucide-react';
import ContactConfirmModal from './contact-confirm-modal';
import { api } from '../lib/api';

const LOGIN_URL = '/login';

const navItems = [
  { label: '工作台', caption: '评审总览', path: '/', icon: LayoutDashboard },
  { label: '评审项目', caption: '项目列表', path: '/projects', icon: ClipboardList },
  { label: '个人信息', caption: '资料管理', path: '/profile', icon: UserCircle },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);
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

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.replace(LOGIN_URL);
  };

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  const registeredName = user?.displayName?.trim() || user?.username || '专家';
  const userInitial = registeredName.slice(0, 1);

  return (
    <div className="flex h-screen flex-col overflow-hidden exp-page text-[var(--foreground)]">
      <header className="exp-topbar">
        <div className="flex h-[66px] items-center justify-between px-5">
          <button onClick={() => router.push('/')} className="flex items-center gap-3 text-left">
            <img src="/assets/logo.png" alt="智慧水发 · 蜀水云采" className="h-10 w-auto object-contain" />
            <span className="exp-brand-mark block text-lg leading-none">智慧水发 · 蜀水云采</span>
          </button>

          <div className="flex items-center gap-2.5">
            <div className="exp-user-chip">
              <span className="exp-user-chip-avatar">{userInitial}</span>
              <span className="hidden text-sm font-bold text-[var(--foreground)] md:block">{registeredName}</span>
            </div>
            <button onClick={logout} className="neu-btn-soft is-danger">
              <LogOut size={15} strokeWidth={1.7} />
              <span className="hidden sm:inline">退出登录</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className={`exp-sidebar ${collapsed ? 'w-[76px]' : 'w-[264px]'} m-3 mr-0`}>
          <nav className="flex-1 overflow-y-auto px-2.5 py-3" style={{ scrollbarWidth: 'thin' }}>
            {navItems.map(item => (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className={`exp-nav-item ${isActive(item.path) ? 'is-active' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={collapsed ? 20 : 18} strokeWidth={1.7} className="flex-shrink-0" />
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold tracking-tight">{item.label}</span>
                    {item.caption && <span className="mt-0.5 block truncate text-[11px] opacity-70">{item.caption}</span>}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="neu-btn-soft m-2.5 !h-10 !w-[calc(100%-20px)] justify-center"
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            {collapsed ? <PanelLeft size={16} strokeWidth={1.7} /> : <PanelLeftClose size={16} strokeWidth={1.7} />}
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {authError && (
            <div className="mx-5 mt-3">
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
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
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
