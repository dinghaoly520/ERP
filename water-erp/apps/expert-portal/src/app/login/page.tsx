'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { portalURL } from '@water-erp/config';
import './login.css';

const IconUser = (
  <svg className="login-field-shell__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" /></svg>
);
const IconLock = (
  <svg className="login-field-shell__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10" width="15" height="10" rx="2.5" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /></svg>
);
const IconArrow = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
);
const IconEye = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
);
const IconEyeOff = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
);

type Tab = 'expert' | 'admin';

/** 管理员 Tab 接受的 web 端角色（与后端 portal-cookie 的 ROLE_PORTAL 对齐） */
const WEB_ROLES = ['admin', 'bid_host', 'leader', 'staff'];

// Dev-only demo accounts — stripped to empty in production builds.
const DEMO_ACCOUNTS: Record<Tab, { username: string; password: string }> =
  process.env.NODE_ENV === 'production'
    ? { expert: { username: '', password: '' }, admin: { username: '', password: '' } }
    : { expert: { username: '周祥志', password: 'expert@2026' }, admin: { username: 'Swhi-CGZX-admin', password: 'Swhi-CGZX-admin@2026' } };

function ExpertLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 平板深链登录后回到原页面：仅允许站内相对路径，防开放重定向
  const returnTo = (() => {
    const r = searchParams.get('redirect');
    return r && r.startsWith('/') && !r.startsWith('//') ? r : '/';
  })();
  // 从邀请确认链接（/invitation）进入时默认专家登录 tab，避免专家看到管理员登录表单
  const fromInvitation = returnTo.startsWith('/invitation');
  const [tab, setTab] = useState<Tab>(fromInvitation ? 'expert' : 'admin');
  const [form, setForm] = useState(fromInvitation ? { ...DEMO_ACCOUNTS.expert } : { ...DEMO_ACCOUNTS.admin });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('forceLogin') !== '1') return;
    fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Portal': 'expert' }, credentials: 'include' });
  }, []);

  const switchTab = (next: Tab) => {
    setTab(next);
    setForm({ ...DEMO_ACCOUNTS[next] });
  };

  const fillDemo = () => setForm({ ...DEMO_ACCOUNTS[tab] });
  const isDev = process.env.NODE_ENV !== 'production';

  // 平板设备检测（与 root layout 脚本、proxy.ts 保持一致的逻辑）
  const isTabletDevice = () => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    if (/iPad|PlayBook|Kindle|Silk|KFAPWI|Tablet|CrOS/i.test(ua)) return true;
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return true;
    if (navigator.maxTouchPoints > 1 && !/Mobile/i.test(ua)) return true;
    return false;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.password) { toast.error('请输入用户名和密码'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Portal': 'expert' },
        credentials: 'include',
        body: JSON.stringify({ username: form.username, password: form.password }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as any).error || '登录失败'); }
      // role 直接取登录响应：本页发 X-Portal:expert，/auth/me 会读 token_expert，
      // 而管理员登录拿到的是 token_web（按角色命名），读不到。登录响应本身已含 role。
      const { role } = (await res.json()) as { role: string };
      if (tab === 'expert') {
        if (role === 'bid_expert') {
          // 邀请确认页（/invitation）已豁免桌面/平板分流，优先回跳，保证通知链接在平板上可用
          if (returnTo.startsWith('/invitation')) {
            window.location.replace(returnTo);
          } else if (isTabletDevice()) {
            // 平板设备 → 写 cookie + 整页跳转人脸识别核验（SPA 导航不会触发 beforeInteractive 脚本）
            document.cookie = 'device_mode=tablet;path=/;max-age=604800;SameSite=Lax';
            window.location.replace('/tablet/face-verify');
          } else {
            router.push(returnTo);
          }
        }
        else toast.error('非专家账户，请使用专家账号登录');
      } else if (WEB_ROLES.includes(role)) {
        // 管理员 Tab = 开评标管理端(:3007) 入口：无论具体 web 端角色，统一跳 :3007/bid。
        // 与 bid-portal proxy.ts 的 ALLOWED_ROLES 对齐（admin/bid_host/leader/staff）。
        window.location.href = portalURL('bid', '/bid');
      } else {
        toast.error('请使用管理员账号登录');
      }
    } catch (e: any) {
      toast.error(e.message || '登录失败');
    }
    setLoading(false);
  };

  return (
    <main className="login-stage ambient-grid flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-10">
      {/* 光束 + 雾 */}
      <div aria-hidden className="login-stage__rays">
        <div className="login-stage__ray login-stage__ray--far-left" />
        <div className="login-stage__ray login-stage__ray--left" />
        <div className="login-stage__ray login-stage__ray--center" />
        <div className="login-stage__ray login-stage__ray--right" />
        <div className="login-stage__ray login-stage__ray--far-right" />
      </div>
      <div aria-hidden className="login-stage__veil" />

      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center text-center">
        {/* 品牌光晕标 */}
        <div className="login-mark flex h-[72px] w-[72px] items-center justify-center">
          <span aria-hidden className="login-mark__halo login-mark__halo--soft" />
          <span aria-hidden className="login-mark__halo login-mark__halo--rich" />
          <span aria-hidden className="login-mark__ring" />
          <img src="/assets/logo.png" alt="" className="relative z-10 h-[58px] w-[58px] object-contain" />
        </div>

        <h1 className="login-title mt-4 font-[family-name:var(--font-display)] text-[clamp(1.7rem,4.6vw,2.3rem)] font-semibold tracking-[-0.06em] text-[color:var(--foreground)]">
          智慧水发 · <span className="whitespace-nowrap">专家门户</span>
        </h1>
        <p className="login-slogan mt-4 text-[0.82rem] font-semibold tracking-[0.22em]">独立评审 · 客观公正 · 全程留痕</p>

        {/* 角色切换 —— 复用 cgzxui 内凹 tab */}
        <div className="neu-tab-bar mt-7">
          {(['expert', 'admin'] as Tab[]).map(t => (
            <button key={t} type="button" className={`neu-tab${tab === t ? ' is-active' : ''}`} onClick={() => switchTab(t)}>
              {t === 'expert' ? '专家登录' : '管理员登录'}
            </button>
          ))}
        </div>

        <form className="mt-5 flex w-full flex-col gap-[1.05rem]" onSubmit={handleLogin} noValidate>
          <div className="login-field-shell">
            <label htmlFor="exp-user" className="sr-only">{tab === 'expert' ? '专家账号' : '管理员账号'}</label>
            <span aria-hidden className="login-field-shell__icon-rail">{IconUser}</span>
            <input id="exp-user" className="login-field-input w-full bg-transparent px-5 pb-4 pl-[3rem] pt-4 text-[15px] text-[color:var(--foreground)] outline-none placeholder:text-[#9aa7ba]"
              type="text" autoComplete="username"
              value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder={tab === 'expert' ? '请输入专家账户' : '请输入管理员账户'} />
            <span aria-hidden className="login-field-shell__line" />
          </div>

          <div className="login-field-shell">
            <label htmlFor="exp-pass" className="sr-only">密码</label>
            <span aria-hidden className="login-field-shell__icon-rail">{IconLock}</span>
            <input id="exp-pass" className="login-field-input w-full bg-transparent pb-4 pl-[3rem] pr-[3rem] pt-4 text-[15px] text-[color:var(--foreground)] outline-none placeholder:text-[#9aa7ba]"
              type={showPassword ? "text" : "password"} autoComplete="current-password"
              value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="请输入密码" />
            <button
              type="button"
              className="login-field-shell__password-toggle"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              tabIndex={-1}
            >
              {showPassword ? IconEyeOff : IconEye}
            </button>
            <span aria-hidden className="login-field-shell__line" />
          </div>

          <button className="login-submit-button mt-1 inline-flex w-full items-center justify-center gap-2 rounded-[20px] px-6 py-4 text-sm font-semibold text-[color:var(--foreground)]" type="submit" disabled={loading}>
            <span className="login-submit-label">{loading ? '登录中…' : '登 录'}</span>
            {IconArrow}
          </button>

          {isDev && (
            <button type="button" onClick={fillDemo} className="login-demo-link">
              填充演示账号（仅开发环境可见）
            </button>
          )}
        </form>

        <div className="login-credit mt-7 text-[0.72rem] tracking-[0.12em] text-[color:var(--muted-foreground)]">
          智慧水发 · 蜀水云采 · 在线开评标
        </div>
      </div>
    </main>
  );
}

// Next 16 CSR bailout：useSearchParams 须处于 Suspense 边界内方可静态预渲染；
// 本文件为 client page，force-dynamic 不生效，故以包装组件提供边界（2026-08-14 修 build:expert 既有红）。
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <ExpertLoginPage />
    </Suspense>
  );
}
