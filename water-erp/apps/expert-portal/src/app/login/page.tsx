'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { portalURL } from '@water-erp/config';
import './login.css';

const IconUser = (
  <svg className="lp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" /></svg>
);
const IconLock = (
  <svg className="lp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10" width="15" height="10" rx="2.5" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /></svg>
);

type Tab = 'expert' | 'admin';

/** 管理员 Tab 接受的 web 端角色（与后端 portal-cookie 的 ROLE_PORTAL 对齐） */
const WEB_ROLES = ['admin', 'bid_host', 'leader', 'staff'];

// Dev-only demo accounts — stripped to empty in production builds.
const DEMO_ACCOUNTS: Record<Tab, { username: string; password: string }> =
  process.env.NODE_ENV === 'production'
    ? { expert: { username: '', password: '' }, admin: { username: '', password: '' } }
    : { expert: { username: '周祥志', password: 'expert@2026' }, admin: { username: 'Swhi-CGZX-01', password: 'abc123' } };

export default function ExpertLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 平板深链登录后回到原页面：仅允许站内相对路径，防开放重定向
  const returnTo = (() => {
    const r = searchParams.get('redirect');
    return r && r.startsWith('/') && !r.startsWith('//') ? r : '/';
  })();
  const [tab, setTab] = useState<Tab>('admin');
  const [form, setForm] = useState({ ...DEMO_ACCOUNTS.admin });
  const [loading, setLoading] = useState(false);

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
          // 平板设备 → 写 cookie + 整页跳转 tablet（SPA 导航不会触发 beforeInteractive 脚本）
          if (isTabletDevice()) {
            document.cookie = 'device_mode=tablet;path=/;max-age=604800;SameSite=Lax';
            window.location.replace('/tablet');
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
    <main className="lp lp--expert">
      <div className="lp-bg" aria-hidden="true" />

      <div className="lp-brand" aria-label="智慧水发 · 蜀水云采">
        <img src="/assets/logo.png" alt="" className="lp-brand-mark" />
        <span className="lp-brand-name">智慧水发 · 蜀水云采</span>
      </div>

      <section className="lp-panel" aria-label="登录表单">
        <div className="lp-card">
          <div className="lp-head">
            <div className="lp-brand-word">智慧水发<span className="lp-dot">·</span>蜀水云采</div>
            <div className="lp-divider" aria-hidden="true">◆</div>
            <h1 className="lp-title">在线开评标系统</h1>
          </div>

          <div className="lp-tabs">
            {(['expert', 'admin'] as Tab[]).map(t => (
              <button key={t} type="button" className={`lp-tab${tab === t ? ' is-active' : ''}`} onClick={() => switchTab(t)}>
                {t === 'expert' ? '专家登录' : '管理员登录'}
              </button>
            ))}
          </div>

          <form className="lp-form" onSubmit={handleLogin} noValidate>
            <div className="lp-field">
              <label htmlFor="exp-user">{tab === 'expert' ? '专家账号' : '管理员账号'}</label>
              <div className="lp-input-wrap">
                {IconUser}
                <input id="exp-user" className="lp-input" type="text" autoComplete="username"
                  value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder={tab === 'expert' ? '请输入专家账户' : '请输入管理员账户'} />
              </div>
            </div>
            <div className="lp-field">
              <label htmlFor="exp-pass">密码</label>
              <div className="lp-input-wrap">
                {IconLock}
                <input id="exp-pass" className="lp-input" type="password" autoComplete="current-password"
                  value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="请输入密码" />
              </div>
            </div>
            <button className="lp-primary" type="submit" disabled={loading}>
              {loading ? '登录中…' : '登 录'}
            </button>
            {isDev && (
              <button type="button" onClick={fillDemo}
                style={{ all: 'unset', cursor: 'pointer', textAlign: 'center', marginTop: 2,
                         fontSize: 12, fontWeight: 600, color: 'oklch(0.55 0.06 var(--hue))' }}>
                填充演示账号（仅开发环境可见）
              </button>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
