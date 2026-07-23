'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, LogOut, RefreshCw,
} from 'lucide-react';
import type { User } from '@/lib/types';

/**
 * 平板触屏 layout（Phase ⑤ Task 6 · cgzxui 新拟态重构）
 *
 * 与桌面 AppShell 的差异：
 * - 无左侧 sidebar —— 平板横向空间宝贵，改为顶部紧凑 header（h-14）+ 全宽 content
 * - 退出/返回/重试按钮放大，主触控目标 ≥ 44px
 * - 鉴权同 (app)：fetch /api/auth/me，401 → /login（cookie + X-Portal 由 api 客户端处理）
 */
const LOGIN_URL = '/login';

export default function TabletLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState(false);
  const [authRetrying, setAuthRetrying] = useState(false);
  const retryRef = useRef(0);
  const MAX_RETRIES = 3;

  const checkAuth = () => {
    setAuthRetrying(true);
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => {
        if (r.status === 401) { router.replace(LOGIN_URL); return null; }
        // P2：非 401 的失败（如瞬时 500）抛错走重试分支，不当作登出
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(u => {
        if (!u) return; // 401 已跳转登录
        setUser(u);
        setAuthError(false);
        setAuthRetrying(false);
        retryRef.current = 0;
      })
      .catch(() => {
        setAuthError(true);
        setAuthRetrying(false);
        if (retryRef.current < MAX_RETRIES) {
          retryRef.current++;
          setTimeout(checkAuth, 3000 * retryRef.current);
        }
      });
  };

  useEffect(() => { checkAuth(); }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.replace(LOGIN_URL);
  };

  const registeredName = user?.displayName?.trim() || user?.username || '专家';
  const userInitial = registeredName.slice(0, 1);

  // 平板评标界面隐藏 header，把纵向空间全部留给打分 + 手写备忘
  const isEvaluatePage = pathname.includes('/evaluate/');

  return (
    <div className="exp-page flex h-screen flex-col overflow-hidden text-[var(--foreground)]">
      {/* 紧凑顶栏 —— 评标页隐藏，落地页展示（含退出） */}
      {!isEvaluatePage && (
        <header className="exp-topbar">
          <div className="flex h-14 items-center justify-between px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              {pathname !== '/tablet' && (
                <button
                  type="button"
                  onClick={() => router.push('/tablet')}
                  aria-label="返回平板工作台"
                  className="neu-btn-soft !h-11 !w-11 !p-0"
                >
                  <ArrowLeft size={17} strokeWidth={1.7} />
                </button>
              )}
              <img src="/assets/logo.png" alt="智慧水发 · 蜀水云采" className="h-8 w-auto object-contain" />
              <span className="exp-brand-mark truncate text-base leading-none">专家评标</span>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="exp-user-chip">
                <span className="exp-user-chip-avatar">{userInitial}</span>
                <span className="hidden text-sm font-bold text-[var(--foreground)] sm:block">{registeredName}</span>
              </div>
              <button type="button" onClick={logout} className="neu-btn-soft is-danger !h-11">
                <LogOut size={15} strokeWidth={1.7} />
                退出
              </button>
            </div>
          </div>
        </header>
      )}

      {authError && (
        <div className="mx-4 mt-3">
          <div className="exp-alert exp-alert--warn flex items-center gap-3">
            <AlertTriangle size={16} strokeWidth={1.6} className="shrink-0" />
            <span className="flex-1">身份验证失败，请检查网络后重试</span>
            <button
              type="button"
              onClick={() => { retryRef.current = 0; checkAuth(); }}
              disabled={authRetrying}
              className="neu-btn-soft is-warning !h-11"
            >
              <RefreshCw size={13} className={authRetrying ? 'animate-spin' : ''} />
              {authRetrying ? '重试中…' : '重试'}
            </button>
          </div>
        </div>
      )}

      {/* 全宽 content —— 评标页无 padding（页面自行控制），落地页保留 p-4 */}
      <main className={`flex-1 overflow-y-auto ${isEvaluatePage ? '' : 'p-4'}`}>
        {children}
      </main>
    </div>
  );
}
