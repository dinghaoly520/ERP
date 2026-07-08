'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '../lib/types';
import {
  LayoutDashboard, ClipboardList, UserCircle,
  PanelLeftClose, PanelLeft, AlertTriangle, RefreshCw,
} from 'lucide-react';

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
    <div className="flex h-screen flex-col overflow-hidden workbench-page-bg text-[#18243a]">
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-[#dbe6f3] bg-white/86 backdrop-blur-xl">
        <div className="flex h-[68px] items-center justify-between px-6">
          <button onClick={() => router.push('/')} className="flex items-center gap-3 text-left">
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
            <div className="flex items-center gap-2 rounded-xl border border-white/30 bg-white/50 px-3 py-2 shadow-sm backdrop-blur-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#064ea2] to-[#0b63ce] text-xs font-black text-white">
                {userInitial}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-black text-[#18243a]">{registeredName}</div>
              </div>
            </div>
            <button
              onClick={logout}
              className="rounded-xl border border-white/30 bg-white/50 px-3 py-2 text-sm font-semibold text-[#5a6d8a] transition hover:border-[#e74c3c] hover:text-[#e74c3c] backdrop-blur-sm"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className={`${collapsed ? 'w-[68px]' : 'w-[272px]'} m-3 mr-0 flex flex-shrink-0 flex-col overflow-hidden rounded-[24px] border border-[#dbe6f3] bg-white/88 shadow-[0_18px_60px_rgba(15,47,87,0.10)] backdrop-blur transition-all duration-200`}>
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
          </nav>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="m-2 flex h-11 items-center justify-center rounded-2xl border border-[#e5ecf4] bg-[#f8fbff] text-[#5a6d8a] transition-colors hover:border-[#bfdbfe] hover:text-[#064ea2]"
          >
            {collapsed ? <PanelLeft size={16} strokeWidth={1.7} /> : <PanelLeftClose size={16} strokeWidth={1.7} />}
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {authError && (
            <div className="mx-6 mt-3 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm">
              <AlertTriangle size={16} strokeWidth={1.5} className="text-amber-500 shrink-0" />
              <span className="flex-1 font-semibold text-amber-700">身份验证失败，请检查网络后重试</span>
              <button
                onClick={checkAuth}
                disabled={authRetrying}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition disabled:opacity-50"
              >
                <RefreshCw size={12} className={authRetrying ? 'animate-spin' : ''} />
                {authRetrying ? '重试中…' : '重试'}
              </button>
            </div>
          )}
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
