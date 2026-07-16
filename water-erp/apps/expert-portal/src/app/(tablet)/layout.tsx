'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, RefreshCw,
} from 'lucide-react';
import type { User } from '@/lib/types';

/**
 * 平板触屏 layout（Phase ⑤ Task 6）
 *
 * 与桌面 AppShell 的差异：
 * - 无左侧 sidebar —— 平板横向空间宝贵，改为顶部紧凑 header + 全宽 content
 * - 退出/重试按钮放大、touch target ≥ 44px
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
        return r.ok ? r.json() : null;
      })
      .then(u => {
        if (!u) { router.replace(LOGIN_URL); return; }
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

  return (
    <div className="flex h-screen flex-col overflow-hidden workbench-page-bg text-[#18243a]">
      {/* 紧凑 header —— 无 sidebar，释放纵向空间 */}
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-[#dbe6f3] bg-white/90 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            {pathname !== '/' && (
              <button
                type="button"
                onClick={() => router.push('/')}
                aria-label="返回工作台"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[oklch(0.55_0.01_264)] transition hover:bg-[oklch(0.97_0.005_264)]"
              >
                <ArrowLeft size={18} strokeWidth={1.7} />
              </button>
            )}
            <img src="/assets/logo.png" alt="" className="h-7 w-auto object-contain" />
            <strong className="text-sm font-black tracking-wide text-[#18243a]">专家评标</strong>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-white/40 bg-white/60 px-2.5 py-1.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#064ea2] to-[#0b63ce] text-[11px] font-black text-white">
                {userInitial}
              </span>
              <span className="text-xs font-bold text-[#18243a]">{registeredName}</span>
            </div>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-white/40 bg-white/60 px-3 py-2 text-xs font-semibold text-[#5a6d8a] transition hover:border-[#e74c3c] hover:text-[#e74c3c]"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {authError && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <AlertTriangle size={16} strokeWidth={1.5} className="shrink-0 text-amber-500" />
          <span className="flex-1 font-semibold text-amber-700">身份验证失败，请检查网络后重试</span>
          <button
            type="button"
            onClick={() => { retryRef.current = 0; checkAuth(); }}
            disabled={authRetrying}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            <RefreshCw size={12} className={authRetrying ? 'animate-spin' : ''} />
            {authRetrying ? '重试中…' : '重试'}
          </button>
        </div>
      )}

      {/* 全宽 content —— 无 sidebar 占用 */}
      <main className="flex-1 overflow-y-auto p-4">
        {children}
      </main>
    </div>
  );
}
