'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { landingURL } from '@water-erp/config';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   在线开评标系统 · 登录页 — 浅色炫彩毛玻璃 · 浅薰衣草
   背景：bg-hydro-hero-9 · 专家 / 管理员双 Tab
   遮罩：左清晰 → 右渐近不透明（平滑渐变）
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const LP_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');
.lp{--tint:oklch(0.975 0.02 var(--hue));--ink:oklch(0.26 0.025 var(--hue));--muted:#6b787e;--line:oklch(0.93 0.015 var(--hue));--ease:cubic-bezier(.2,.8,.2,1);position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,520px);min-height:100vh;isolation:isolate;overflow:hidden;font-family:"Manrope","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--tint)}
.lp--expert{--hue:285}
.lp-bg{position:absolute;inset:0;z-index:-3;background-image:url('/assets/bg-hydro-hero-9.png');background-position:center;background-size:cover;filter:saturate(.8) contrast(.92) brightness(1.05);transform:scale(1.04)}
.lp::before,.lp::after{position:absolute;inset:0;content:"";pointer-events:none}
.lp::before{z-index:-2;backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);-webkit-mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.03) 40%,rgba(0,0,0,.3) 68%,rgba(0,0,0,.85) 92%,#000 100%);mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.03) 40%,rgba(0,0,0,.3) 68%,rgba(0,0,0,.85) 92%,#000 100%)}
.lp::after{z-index:-1;background:linear-gradient(90deg,transparent 0%,color-mix(in oklch,var(--tint) 5%,transparent) 42%,color-mix(in oklch,var(--tint) 35%,transparent) 70%,color-mix(in oklch,var(--tint) 92%,white) 100%),radial-gradient(circle at 86% 46%,color-mix(in oklch,white 30%,transparent),transparent 42%),linear-gradient(90deg,rgba(3,30,40,.1),transparent 45%)}
.lp-brand{position:fixed;top:26px;left:6vw;z-index:3;display:inline-flex;align-items:center;gap:12px}
.lp-brand-mark{width:42px;height:42px;border-radius:13px;object-fit:cover;border:1px solid rgba(255,255,255,.7);box-shadow:0 10px 26px rgba(20,40,50,.18)}
.lp-brand-name{font-family:"Plus Jakarta Sans","Microsoft YaHei",sans-serif;font-size:18px;font-weight:800;letter-spacing:.05em;color:#fff;text-shadow:0 6px 22px rgba(0,0,0,.32)}
.lp-showcase{grid-column:1;grid-row:1;display:flex;align-items:flex-end;justify-content:flex-start;min-height:100vh;padding:96px 24px 48px 6vw}
.lp-board{display:grid;width:min(540px,100%);gap:14px;animation:lp-in .7s var(--ease) .12s both}
@keyframes lp-in{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:translateX(0)}}
.lp-kicker{justify-self:start;border:1px solid rgba(255,255,255,.5);border-radius:999px;background:rgba(255,255,255,.16);backdrop-filter:blur(8px);padding:7px 16px;color:#effaf3;font-size:11px;font-weight:800;letter-spacing:.2em}
.lp-board h2{margin:0;color:#fff;font-family:"Plus Jakarta Sans","Microsoft YaHei",sans-serif;font-size:clamp(40px,6vw,70px);line-height:.96;letter-spacing:-.01em;text-shadow:0 14px 50px rgba(0,0,0,.4)}
.lp-board p{margin:0;color:rgba(255,255,255,.94);font-size:16px;line-height:1.6;max-width:32ch;text-shadow:0 8px 30px rgba(0,0,0,.34)}
.lp-tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}
.lp-tile{min-height:102px;padding:16px;border:1px solid rgba(255,255,255,.5);border-radius:18px;background:rgba(255,255,255,.82);backdrop-filter:blur(16px);box-shadow:0 16px 38px rgba(0,0,0,.09)}
.lp-tile strong{display:block;font-family:"Plus Jakarta Sans",sans-serif;font-size:22px;font-weight:800;color:var(--ink)}
.lp-tile small{color:#5c746b;font-size:12px;line-height:1.45}
.lp-panel{grid-column:2;grid-row:1;display:flex;min-height:100vh;flex-direction:column;justify-content:center;align-items:flex-end;padding:96px 6vw 40px 32px}
.lp-card{position:relative;width:min(440px,100%);padding:34px 32px 30px;border-radius:26px;background:radial-gradient(circle at 92% 0%,color-mix(in oklch,oklch(0.93 0.055 var(--hue)) 38%,transparent),transparent 36%),radial-gradient(circle at 4% 96%,color-mix(in oklch,oklch(0.93 0.045 calc(var(--hue) + 80)) 32%,transparent),transparent 34%),linear-gradient(160deg,rgba(255,255,255,.74),rgba(255,255,255,.54));backdrop-filter:blur(24px) saturate(1.4);-webkit-backdrop-filter:blur(24px) saturate(1.4);box-shadow:0 24px 60px color-mix(in oklch,oklch(0.5 0.05 var(--hue)) 13%,transparent),inset 0 1px 0 rgba(255,255,255,.9);animation:lp-rise .58s var(--ease) both}
@keyframes lp-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.lp-card::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1.2px;pointer-events:none;background:linear-gradient(135deg,color-mix(in oklch,oklch(0.9 0.06 var(--hue)) 78%,white),rgba(255,255,255,.72) 46%,color-mix(in oklch,oklch(0.9 0.05 calc(var(--hue) + 90)) 70%,white));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.lp-tabs{position:relative;display:flex;gap:5px;padding:5px;margin-bottom:22px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.4)}
.lp-tab{flex:1;height:40px;border:0;border-radius:11px;background:transparent;color:var(--muted);font-family:inherit;font-weight:800;font-size:13px;cursor:pointer;transition:background .2s var(--ease),color .2s var(--ease),box-shadow .2s var(--ease)}
.lp-tab.is-active{background:#fff;color:oklch(0.42 0.08 var(--hue));box-shadow:0 6px 16px color-mix(in oklch,oklch(0.5 0.05 var(--hue)) 13%,transparent)}
.lp-head{margin-bottom:24px}
.lp-brand-word{display:flex;align-items:center;font-family:"Plus Jakarta Sans","Microsoft YaHei",sans-serif;font-size:13px;font-weight:700;letter-spacing:.26em;color:oklch(0.5 0.07 var(--hue));margin-bottom:12px}
.lp-brand-word .lp-dot{font-size:18px;line-height:1;margin:0 4px;opacity:.5}
.lp-title{margin:0;font-family:"Plus Jakarta Sans","Microsoft YaHei",sans-serif;font-size:30px;font-weight:800;line-height:1.05;color:oklch(0.26 0.04 var(--hue));letter-spacing:-.01em}
.lp-tag{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.5}
.lp-form{display:grid;gap:16px}
.lp-field{display:grid;gap:8px}
.lp-field label{font-size:12px;font-weight:800;letter-spacing:.06em;color:color-mix(in oklch,var(--ink) 82%,#000)}
.lp-input-wrap{position:relative}
.lp-input-icon{position:absolute;left:15px;top:50%;transform:translateY(-50%);width:18px;height:18px;color:oklch(0.58 0.06 var(--hue));opacity:.9;pointer-events:none}
.lp-input{width:100%;height:54px;border:1px solid var(--line);border-radius:15px;padding:0 16px 0 46px;outline:none;color:var(--ink);background:rgba(255,255,255,.62);font-family:inherit;font-size:14.5px;transition:border .2s var(--ease),box-shadow .2s var(--ease),background .2s var(--ease)}
.lp-input::placeholder{color:oklch(0.66 0.018 var(--hue))}
.lp-input:focus{border-color:oklch(0.66 0.08 var(--hue));box-shadow:0 0 0 4px color-mix(in oklch,oklch(0.78 0.08 var(--hue)) 16%,transparent);background:#fff}
.lp-primary{display:inline-flex;align-items:center;justify-content:center;width:100%;height:54px;margin-top:6px;border:1px solid color-mix(in oklch,oklch(0.8 0.06 var(--hue)) 50%,white);border-radius:15px;color:oklch(0.32 0.07 var(--hue));background:linear-gradient(135deg,oklch(0.93 0.055 var(--hue)),oklch(0.91 0.048 calc(var(--hue) + 24)));box-shadow:0 10px 24px color-mix(in oklch,oklch(0.5 0.05 var(--hue)) 14%,transparent),inset 0 1px 0 rgba(255,255,255,.65);font-family:inherit;font-weight:800;font-size:15px;letter-spacing:.16em;cursor:pointer;transition:transform .2s var(--ease),filter .2s var(--ease)}
.lp-primary:hover{transform:translateY(-2px);filter:brightness(1.02)}
.lp-primary:disabled{cursor:wait;opacity:.7;transform:none}
@media(max-width:860px){.lp{grid-template-columns:1fr}.lp::before{backdrop-filter:blur(14px) saturate(1.2);-webkit-mask-image:linear-gradient(180deg,transparent 0%,rgba(0,0,0,.04) 38%,rgba(0,0,0,.4) 64%,rgba(0,0,0,.9) 100%);mask-image:linear-gradient(180deg,transparent 0%,rgba(0,0,0,.04) 38%,rgba(0,0,0,.4) 64%,rgba(0,0,0,.9) 100%)}.lp::after{background:linear-gradient(180deg,transparent 0%,color-mix(in oklch,var(--tint) 8%,transparent) 40%,color-mix(in oklch,var(--tint) 45%,transparent) 72%,color-mix(in oklch,var(--tint) 92%,white) 100%),radial-gradient(circle at 50% 78%,color-mix(in oklch,white 28%,transparent),transparent 40%)}.lp-brand{top:18px;left:18px}.lp-panel{grid-column:1;grid-row:2;align-items:stretch;min-height:auto;padding:80px 18px 28px}.lp-showcase{grid-column:1;grid-row:1;min-height:40vh;padding:80px 18px 18px}}
`;

const IconUser = (
  <svg className="lp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" /></svg>
);
const IconLock = (
  <svg className="lp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10" width="15" height="10" rx="2.5" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /></svg>
);

type Tab = 'expert' | 'admin';

/** 管理员 Tab 接受的 web 端角色（与后端 portal-cookie 的 ROLE_PORTAL 对齐） */
const WEB_ROLES = ['admin', 'bid_host', 'procurement_staff'];

const TAB_DEFAULTS: Record<Tab, { username: string; password: string }> = {
  expert: { username: 'wangjg', password: 'wangjg@2026' },
  admin: { username: 'caigou', password: 'caigou@2026' },
};

export default function ExpertLoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('expert');
  const [form, setForm] = useState({ ...TAB_DEFAULTS.expert });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('forceLogin') !== '1') return;
    fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Portal': 'expert' }, credentials: 'include' });
  }, []);

  const switchTab = (next: Tab) => {
    setTab(next);
    setForm({ ...TAB_DEFAULTS[next] });
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
        if (role === 'bid_expert') { toast.success('登录成功'); router.push('/'); }
        else toast.error('非专家账户，请使用专家账号登录');
      } else if (WEB_ROLES.includes(role)) {
        toast.success('登录成功，正在跳转管理后台...');
        window.location.href = landingURL(role); // → http://localhost:3004/dashboard
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
      <style dangerouslySetInnerHTML={{ __html: LP_CSS }} />
      <div className="lp-bg" aria-hidden="true" />

      <div className="lp-brand" aria-label="四川水发集团">
        <img src="/assets/logo.jpg" alt="" className="lp-brand-mark" />
        <span className="lp-brand-name">四川水发集团</span>
      </div>

      <section className="lp-showcase" aria-label="产品概览">
        <div className="lp-board">
          <span className="lp-kicker">ONLINE BID OPENING &amp; EVALUATION</span>
          <h2>独立评审，全程留痕。</h2>
          <p>专家独立打分 · AI 智能辅助 · 过程可回溯</p>
          <div className="lp-tiles">
            <div className="lp-tile"><strong>独立</strong><small>评审身份加密隔离</small></div>
            <div className="lp-tile"><strong>智能</strong><small>AI 辅助异常识别</small></div>
          </div>
        </div>
      </section>

      <section className="lp-panel" aria-label="登录表单">
        <div className="lp-card">
          <div className="lp-head">
            <div className="lp-brand-word">智慧水发<span className="lp-dot">·</span>蜀水云采</div>
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
          </form>
        </div>
      </section>
    </main>
  );
}
