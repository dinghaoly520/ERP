'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { landingURL } from '@water-erp/config';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   在线开评标系统 · 登录页 — 清爽产品风 · 水绿玻璃
   背景：bg-hydro-hero-9 · 支持专家 / 管理员双 Tab
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const LP_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');
.lp{--ink:#09251d;--muted:#587269;--green:#0f7b54;--green-deep:#064635;--mist:#eef6f0;--line:rgba(9,37,29,.14);--ease:cubic-bezier(.2,.8,.2,1);position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,520px);min-height:100vh;isolation:isolate;overflow:hidden;font-family:"Manrope","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--mist)}
.lp-bg{position:absolute;inset:0;z-index:-3;background-image:url('/assets/bg-hydro-hero-9.png');background-position:center;background-size:cover;filter:saturate(.72) contrast(.88) brightness(1.08);transform:scale(1.04)}
.lp::before,.lp::after{position:absolute;inset:0;content:"";pointer-events:none}
.lp::before{z-index:-2;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);-webkit-mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.14) 38%,rgba(0,0,0,.72) 68%,#000 100%);mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.14) 38%,rgba(0,0,0,.72) 68%,#000 100%)}
.lp::after{z-index:-1;background:linear-gradient(90deg,rgba(238,246,240,.08) 0%,rgba(238,246,240,.24) 34%,rgba(238,246,240,.64) 66%,rgba(238,246,240,.9) 100%),radial-gradient(circle at 84% 50%,rgba(255,255,255,.64),transparent 34%),linear-gradient(90deg,rgba(3,34,24,.3),transparent 42%)}
.lp-brand{position:fixed;top:28px;right:6vw;z-index:3;display:inline-flex;align-items:center;gap:10px;font-weight:900;letter-spacing:.02em;font-family:"Plus Jakarta Sans","Microsoft YaHei",sans-serif}
.lp-brand-mark{width:36px;height:36px;border-radius:13px;object-fit:cover;border:1px solid rgba(255,255,255,.6);box-shadow:0 14px 30px rgba(15,123,84,.24)}
.lp-showcase{grid-column:1;grid-row:1;display:flex;align-items:flex-end;justify-content:flex-start;min-height:100vh;padding:96px 24px 48px 6vw}
.lp-board{display:grid;width:min(540px,100%);gap:14px;animation:lp-in .7s var(--ease) .12s both}
@keyframes lp-in{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:translateX(0)}}
.lp-kicker{justify-self:start;border:1px solid rgba(255,255,255,.5);border-radius:999px;background:rgba(255,255,255,.16);backdrop-filter:blur(8px);padding:7px 16px;color:#effaf3;font-size:11px;font-weight:800;letter-spacing:.2em}
.lp-board h2{margin:0;color:#fff;font-family:"Plus Jakarta Sans","Microsoft YaHei",sans-serif;font-size:clamp(40px,6vw,72px);line-height:.95;letter-spacing:-.01em;text-shadow:0 14px 50px rgba(0,0,0,.34)}
.lp-board p{margin:0;color:rgba(255,255,255,.92);font-size:16px;line-height:1.6;max-width:32ch;text-shadow:0 8px 30px rgba(0,0,0,.3)}
.lp-tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}
.lp-tile{min-height:104px;padding:16px;border:1px solid rgba(255,255,255,.42);border-radius:18px;background:rgba(255,255,255,.82);backdrop-filter:blur(16px);box-shadow:0 18px 42px rgba(0,0,0,.1)}
.lp-tile strong{display:block;font-family:"Plus Jakarta Sans",sans-serif;font-size:22px;font-weight:800}
.lp-tile small{color:#5c746b;font-size:12px;line-height:1.45}
.lp-panel{grid-column:2;grid-row:1;display:flex;min-height:100vh;flex-direction:column;justify-content:center;align-items:flex-end;padding:96px 6vw 40px 32px}
.lp-card{width:min(440px,100%);padding:30px;border:1px solid rgba(9,37,29,.12);border-radius:24px;background:rgba(255,255,255,.82);box-shadow:0 24px 70px rgba(20,58,44,.18);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);animation:lp-rise .58s var(--ease) both}
@keyframes lp-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.lp-tabs{display:flex;gap:5px;padding:5px;margin-bottom:22px;border:1px solid var(--line);border-radius:16px;background:rgba(9,37,29,.05)}
.lp-tab{flex:1;height:42px;border:0;border-radius:12px;background:transparent;color:var(--muted);font-family:inherit;font-weight:800;font-size:13px;cursor:pointer;transition:background .2s var(--ease),color .2s var(--ease),box-shadow .2s var(--ease)}
.lp-tab.is-active{background:#fff;color:var(--green-deep);box-shadow:0 6px 16px rgba(20,58,44,.12)}
.lp-card h1{margin:0;font-family:"Plus Jakarta Sans","Microsoft YaHei",sans-serif;font-size:30px;line-height:1}
.lp-sub{margin:12px 0 24px;color:var(--muted);line-height:1.55;font-size:14px}
.lp-form{display:grid;gap:16px}
.lp-field{display:grid;gap:8px}
.lp-field label{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.lp-input{width:100%;height:52px;border:1px solid var(--line);border-radius:14px;padding:0 16px;outline:none;color:var(--ink);background:rgba(255,255,255,.74);font-family:inherit;font-size:14px;transition:border .2s var(--ease),box-shadow .2s var(--ease),background .2s var(--ease)}
.lp-input::placeholder{color:rgba(9,37,29,.46)}
.lp-input:focus{border-color:rgba(15,123,84,.62);box-shadow:0 0 0 4px rgba(15,123,84,.14);background:#fff}
.lp-primary{display:inline-flex;align-items:center;justify-content:center;width:100%;height:54px;margin-top:4px;border:0;border-radius:16px;color:#effaf3;background:var(--green);box-shadow:0 18px 36px rgba(15,123,84,.24);font-weight:800;font-size:15px;cursor:pointer;transition:transform .2s var(--ease),filter .2s var(--ease)}
.lp-primary:hover{transform:translateY(-2px);filter:saturate(1.08)}
.lp-primary:disabled{cursor:wait;opacity:.78;transform:none}
.lp-divider{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;color:#6d817b;font-size:12px;margin-top:4px}
.lp-divider:before,.lp-divider:after{content:"";height:1px;background:currentColor;opacity:.22}
.lp-back{display:inline-flex;justify-content:center;gap:6px;margin-top:20px;font-size:13px;font-weight:600;color:#607870;text-decoration:none;transition:color .2s}
.lp-back:hover{color:var(--green-deep)}
@media(max-width:860px){.lp{grid-template-columns:1fr}.lp::before{backdrop-filter:blur(14px);-webkit-mask-image:linear-gradient(180deg,transparent 0%,rgba(0,0,0,.18) 34%,rgba(0,0,0,.8) 62%,#000 100%);mask-image:linear-gradient(180deg,transparent 0%,rgba(0,0,0,.18) 34%,rgba(0,0,0,.8) 62%,#000 100%)}.lp::after{background:linear-gradient(180deg,rgba(238,246,240,.14) 0%,rgba(238,246,240,.28) 36%,rgba(238,246,240,.8) 70%,rgba(238,246,240,.94) 100%),radial-gradient(circle at 50% 76%,rgba(255,255,255,.64),transparent 34%)}.lp-brand{top:20px;right:18px}.lp-panel{grid-column:1;grid-row:2;align-items:stretch;min-height:auto;padding:84px 18px 24px}.lp-showcase{grid-column:1;grid-row:1;min-height:44vh;padding:90px 18px 24px}}
`;

type Tab = 'expert' | 'admin';

/** 管理员 Tab 接受的 web 端角色（与后端 portal-cookie 的 ROLE_PORTAL 对齐） */
const WEB_ROLES = ['admin', 'bid_host', 'procurement_staff'];

const TAB_CONFIG: Record<Tab, {
  title: string;
  subtitle: string;
  accountLabel: string;
  userPlaceholder: string;
  hint: string;
  button: string;
  defaults: { username: string; password: string };
}> = {
  expert: {
    title: '专家登录',
    subtitle: '进入在线开评标工作台',
    accountLabel: '专家账号',
    userPlaceholder: '请输入专家账户',
    hint: 'wangjg / wangjg@2026',
    button: '进入开评标系统',
    defaults: { username: 'wangjg', password: 'wangjg@2026' },
  },
  admin: {
    title: '管理员登录',
    subtitle: '进入管理后台',
    accountLabel: '管理员账号',
    userPlaceholder: '请输入管理员账户',
    hint: 'caigou / caigou@2026 · lizhuren / lizhuren@2026',
    button: '进入管理后台',
    defaults: { username: 'caigou', password: 'caigou@2026' },
  },
};

export default function ExpertLoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('expert');
  const [form, setForm] = useState({ ...TAB_CONFIG.expert.defaults });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('forceLogin') !== '1') return;
    fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Portal': 'expert' }, credentials: 'include' });
  }, []);

  const switchTab = (next: Tab) => {
    setTab(next);
    setForm({ ...TAB_CONFIG[next].defaults });
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

  const cfg = TAB_CONFIG[tab];

  return (
    <main className="lp">
      <style dangerouslySetInnerHTML={{ __html: LP_CSS }} />
      <div className="lp-bg" aria-hidden="true" />

      <div className="lp-brand" aria-label="蜀水云采">
        <img src="/assets/logo.jpg" alt="" className="lp-brand-mark" />
        蜀水云采
      </div>

      <section className="lp-showcase" aria-label="产品概览">
        <div className="lp-board">
          <span className="lp-kicker">ONLINE BID OPENING &amp; EVALUATION</span>
          <h2>独立评审，全程留痕。</h2>
          <p>专家独立打分 · AI 智能辅助 · 过程可回溯</p>
          <div className="lp-tiles">
            <div className="lp-tile">
              <strong>独立</strong>
              <small>评审身份加密隔离</small>
            </div>
            <div className="lp-tile">
              <strong>智能</strong>
              <small>AI 辅助异常识别</small>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-panel" aria-label="登录表单">
        <div className="lp-card">
          <div className="lp-tabs">
            {(['expert', 'admin'] as Tab[]).map(t => (
              <button key={t} type="button" className={`lp-tab${tab === t ? ' is-active' : ''}`} onClick={() => switchTab(t)}>
                {TAB_CONFIG[t].title}
              </button>
            ))}
          </div>

          <h1>{cfg.title}</h1>
          <p className="lp-sub">{cfg.subtitle}</p>

          <form className="lp-form" onSubmit={handleLogin} noValidate>
            <div className="lp-field">
              <label htmlFor="exp-user">{cfg.accountLabel}</label>
              <input id="exp-user" className="lp-input" type="text" autoComplete="username"
                value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder={cfg.userPlaceholder} />
            </div>
            <div className="lp-field">
              <label htmlFor="exp-pass">密码</label>
              <input id="exp-pass" className="lp-input" type="password" autoComplete="current-password"
                value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="请输入密码" />
            </div>
            <button className="lp-primary" type="submit" disabled={loading}>
              {loading ? '验证中…' : cfg.button}
            </button>
          </form>

          <div className="lp-divider">测试账号　{cfg.hint}</div>
          <a className="lp-back" href="http://localhost:3006">← 返回门户</a>
        </div>
      </section>
    </main>
  );
}
