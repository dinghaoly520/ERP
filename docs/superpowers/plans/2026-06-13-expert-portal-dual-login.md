# 专家门户双角色登录（专家 / 管理员）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在专家门户登录页（`expert-portal/src/app/login/page.tsx`）增加"专家登录 / 管理员登录"Tab 切换，管理员 Tab 登录后跳转 web 门户后台。

**Architecture:** 单文件前端改造。登录 cookie 按角色命名（web 角色→`token_web`，专家→`token_expert`）且在 `localhost` 跨端口共享，因此管理员在专家门户登录后浏览器拿到 `token_web`，跳 `:3004` 时 `web/proxy.ts` 读 `token_web` 放行——后端零改动。`role` 直接从 `POST /auth/login` 响应体读取（不调 `/auth/me`，因为本页 `X-Portal: expert` 会让 `/auth/me` 读 `token_expert`，对管理员不生效）。

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 · `@water-erp/config`（`landingURL`）。

**测试策略（重要）：** expert-portal 没有单测框架（仅 API 有 Jest）。为一个登录页 UI 改动引入 Vitest+RTL+msw 属于 YAGNI。本计划以 **`lint` + TS 编译 + 手动验证矩阵** 为质量门；开发服务器（已在 :3005 运行）会热重载并暴露类型错误。spec：`docs/superpowers/specs/2026-06-13-expert-portal-dual-login-design.md`。

---

## File Structure

| 文件 | 操作 | 职责 |
|---|---|---|
| `water-erp/apps/expert-portal/src/app/login/page.tsx` | 修改（整体重写） | 双 Tab 登录页：Tab 切换 UI、按 Tab 分支的角色校验与跳转 |

不新增文件，不动后端 / `packages/config` / `packages/shared` / 其它门户。

---

## Task 1: 专家门户登录页改为双 Tab（专家 / 管理员）

**Files:**
- Modify: `water-erp/apps/expert-portal/src/app/login/page.tsx`（整体替换）

- [ ] **Step 1: 用下方完整内容替换 `water-erp/apps/expert-portal/src/app/login/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { landingURL } from '@water-erp/config';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   在线开评标系统 · 登录页 — Light Minimal · 紫色系
   支持专家登录 / 管理员登录双 Tab
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

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
    <div className="relative min-h-screen overflow-x-hidden bg-[#f6f9fd] text-slate-900" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(6,78,162,0.12),transparent_30%),radial-gradient(circle_at_84%_78%,rgba(139,92,246,0.16),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white to-transparent" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:px-12">
        <section className="flex max-w-2xl flex-col justify-center py-8 lg:py-0">
          <div className="mb-16 flex items-center gap-4 lg:mb-24">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-12 w-auto rounded-2xl border border-purple-100 bg-white object-cover shadow-sm" />
            <div>
              <div className="text-lg font-black tracking-[0.16em] text-slate-950" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>四川水发集团</div>
              <div className="mt-1 text-xs font-medium tracking-[0.22em] text-slate-500">智慧水发 · 蜀水云采</div>
            </div>
          </div>
          <div>
            <div className="mb-5 inline-flex rounded-full border border-purple-300 bg-purple-50 px-4 py-1.5 text-xs font-bold tracking-[0.18em] text-[#7c3aed]">ONLINE BID OPENING & EVALUATION</div>
            <h1 className="text-[clamp(34px,5vw,64px)] font-black leading-tight tracking-tight text-slate-950" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>在线开评标系统</h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-600">独立评审 · 在线评分 · 全程留痕</p>
            <div className="mt-8 flex flex-wrap gap-3">
              {['独立评审', '智能辅助', '过程留痕'].map(item => (
                <span key={item} className="rounded-full border border-purple-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#8b5cf6]" />{item}
                </span>
              ))}
            </div>
          </div>
        </section>
        <section className="flex w-full justify-center py-8 lg:w-[460px] lg:py-0">
          <div className="w-full max-w-md rounded-[28px] border border-purple-100 bg-white/95 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur sm:p-10">
            {/* Tab 切换 */}
            <div className="mb-6 flex gap-1 rounded-2xl bg-slate-100 p-1">
              {(['expert', 'admin'] as Tab[]).map(t => (
                <button key={t} type="button" onClick={() => switchTab(t)}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${tab === t ? 'bg-white text-[#7c3aed] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {TAB_CONFIG[t].title}
                </button>
              ))}
            </div>
            <div className="mb-8">
              <div className="mb-4 h-1 w-12 rounded-full bg-[#8b5cf6]" />
              <h2 className="text-2xl font-black text-slate-950" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>{cfg.title}</h2>
              <p className="mt-2 text-sm text-slate-500">{cfg.subtitle}</p>
            </div>
            <form onSubmit={handleLogin} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">{cfg.accountLabel}</span>
                <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder={cfg.userPlaceholder} className="h-12 w-full rounded-2xl border border-[#d7e3f2] bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#8b5cf6] focus:ring-4 focus:ring-purple-100" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">密码</span>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="请输入密码" className="h-12 w-full rounded-2xl border border-[#d7e3f2] bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#8b5cf6] focus:ring-4 focus:ring-purple-100" />
              </label>
              <button type="submit" disabled={loading} className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#064ea2] to-[#8b5cf6] text-sm font-black tracking-[0.12em] text-white shadow-[0_16px_36px_rgba(139,92,246,0.25)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45">
                {loading ? '验证中...' : cfg.button}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-slate-400">测试账号：{cfg.hint}</p>
            <a href="http://localhost:3006" className="mt-7 inline-flex text-sm font-semibold text-slate-500 transition hover:text-[#8b5cf6]" style={{ textDecoration: 'none' }}>← 返回门户</a>
          </div>
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 跑 lint 确认无报错**

Run: `pnpm --filter expert-portal lint`
Expected: 通过，无 error（已有的 `(err as any)` 沿用既有写法，与仓库 lint 配置一致）。

- [ ] **Step 3: 确认 TS 编译无误**

开发服务器已在 :3005 运行，保存后会热重载。查看 dev 日志（`tail -f /tmp/watererp-dev.log`，过滤 `[expert]`）确认无 TypeScript / 编译错误；或运行：
Run: `pnpm --filter expert-portal exec tsc --noEmit`
Expected: 无报错退出。

- [ ] **Step 4: 手动验证矩阵（浏览器访问 http://localhost:3005/login）**

逐项确认：

| # | 操作 | 预期 |
|---|---|---|
| 1 | 默认进入页面 | 停在「专家登录」Tab，账号预填 `wangjg`，按钮「进入开评标系统」 |
| 2 | 切到「管理员登录」Tab | 卡片标题/副标题/placeholder/提示/按钮文案切换；账号重置为 `caigou` |
| 3 | 专家 Tab + `wangjg / wangjg@2026` | toast「登录成功」→ 进入 `:3005/` 专家工作台 |
| 4 | 管理员 Tab + `caigou / caigou@2026` | toast「登录成功，正在跳转管理后台…」→ 跳 `:3004/dashboard` 且已登录（不再被踢回登录页） |
| 5 | 管理员 Tab + `lizhuren / lizhuren@2026` | 同 #4，跳 `:3004/dashboard` 且已登录 |
| 6 | 管理员 Tab + 专家账号 `wangjg` | toast「请使用管理员账号登录」，停留本页 |
| 7 | 专家 Tab + 管理员账号 `caigou` | toast「非专家账户，请使用专家账号登录」，停留本页 |
| 8 | 任意 Tab + 错误密码 | toast「登录失败」（或后端返回的错误信息），停留本页 |
| 9 | 从公众门户 `:3006/` 点「在线开评标系统」卡片进入（带 `forceLogin=1`） | 登录页正常显示双 Tab，#3–#8 流程不受影响 |

> #4/#5 是核心验收点：验证"按角色命名的 cookie + 跨端口共享"确实让管理员从专家门户登录后直通 web 后台。

- [ ] **Step 5: 提交**

```bash
cd "D:/Claude projects/ERP-main"
git add water-erp/apps/expert-portal/src/app/login/page.tsx
git commit -m "feat(expert-portal): 登录页增加管理员登录 Tab，支持登录后跳转 web 后台"
```

---

## Self-Review（已对照 spec 自检）

1. **Spec 覆盖**：spec §2 三个目标（Tab 切换 / 专家 Tab 保持 / 管理员 Tab 跳 web）→ Task 1 Step 1 全覆盖；§3 关键事实（role 取登录响应、硬跳转）→ handleLogin 注释 + `window.location.href = landingURL(role)` 落实；§4.2 Tab 内容表 → `TAB_CONFIG` 字段一一对应；§4.4 不变量（不产生 token_expert、串角色拦截）→ Step 4 #6/#7 验证；§5 非目标 → 未触碰。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤均为完整代码。
3. **类型一致性**：`Tab`、`WEB_ROLES`、`TAB_CONFIG`、`cfg`、`switchTab`、`handleLogin` 命名前后一致；`landingURL` 来自 `@water-erp/config`（已存在导出，公众门户登录页已使用同款）。

无遗留问题。
