# Login UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the login UI for ports `3002` mall, `3003` supplier portal, `3004` procurement management, and `3005` expert portal into a unified high-end digital water cockpit style with module-specific visual themes.

**Architecture:** Keep all authentication, validation, role checks, and post-login redirects unchanged. Replace each login page's visual markup/styles in-place, using existing framework patterns: React/Next.js pages for `mall`, `web`, `expert-portal`, and a scoped Vue SFC for `supplier-portal`. Reuse a consistent visual language across pages: dark gradient shell, logo/company brand, module-specific accent color, glass login card, decorative business scene, responsive simplification.

**Tech Stack:** Next.js 16 + React 19 + Tailwind CSS v4 for `apps/mall`, `apps/web`, `apps/expert-portal`; Vue 3 + Vite + Element Plus scoped CSS for `apps/supplier-portal`; existing static logo assets copied from `water_erp_web/assets/logo.jpg` into each app's public assets.

---

## File Structure

### Existing files to modify

- `water-erp/apps/mall/src/app/login/page.tsx`
  - Responsible for `3002` electronic mall login UI.
  - Keep `handleLogin`, `/api/auth/login`, `router.push('/')`, and error handling unchanged.
  - Replace render markup with blue-orange B2B procurement marketplace design.

- `water-erp/apps/supplier-portal/src/views/auth/Login.vue`
  - Responsible for `3003` supplier portal login UI.
  - Keep `rules`, `handleLogin`, `authStore.login`, `router.push('/dashboard')`, and registration route unchanged.
  - Replace template and scoped CSS with blue-green supplier collaboration design.

- `water-erp/apps/web/src/app/login/page.tsx`
  - Responsible for `3004` procurement management platform login UI.
  - Keep `handleLogin`, `/api/auth/login`, `router.push('/dashboard')`, and error handling unchanged.
  - Replace render markup with blue-gold operations cockpit design.

- `water-erp/apps/expert-portal/src/app/login/page.tsx`
  - Responsible for `3005` expert review workstation login UI.
  - Keep `handleLogin`, `/api/auth/login`, `/api/auth/me`, `me.role !== 'bid_expert'` guard, `router.push('/')`, and error handling unchanged.
  - Replace render markup with blue-purple expert review cockpit design.

### Assets to verify or update

- Source logo: `water_erp_web/assets/logo.jpg`
- Existing destination logos:
  - `water-erp/apps/mall/public/assets/logo.jpg`
  - `water-erp/apps/supplier-portal/public/logo.jpg`
  - `water-erp/apps/web/public/assets/logo.jpg`
  - `water-erp/apps/expert-portal/public/assets/logo.jpg`

If any destination logo differs from the source, copy the source over that destination. Do not modify the source file.

### Files not to modify

- API code under `water-erp/apps/api/**`
- Auth stores/API wrappers except if a build error proves the login page imports are broken
- Non-login pages
- Route middleware
- Package dependencies

---

## Task 1: Verify and normalize logo assets

**Files:**
- Read: `water_erp_web/assets/logo.jpg`
- Modify if different: `water-erp/apps/mall/public/assets/logo.jpg`
- Modify if different: `water-erp/apps/supplier-portal/public/logo.jpg`
- Modify if different: `water-erp/apps/web/public/assets/logo.jpg`
- Modify if different: `water-erp/apps/expert-portal/public/assets/logo.jpg`

- [ ] **Step 1: Compare source and destination logo files**

Run from repo root `/Users/qihao/Desktop/ERP`:

```bash
shasum -a 256 water_erp_web/assets/logo.jpg \
  water-erp/apps/mall/public/assets/logo.jpg \
  water-erp/apps/supplier-portal/public/logo.jpg \
  water-erp/apps/web/public/assets/logo.jpg \
  water-erp/apps/expert-portal/public/assets/logo.jpg
```

Expected: either all hashes match, or mismatched hashes identify destinations that need updating.

- [ ] **Step 2: Copy source logo to mismatched destinations only**

If any destination differs, run the needed copy commands. Example if all differ:

```bash
cp water_erp_web/assets/logo.jpg water-erp/apps/mall/public/assets/logo.jpg
cp water_erp_web/assets/logo.jpg water-erp/apps/supplier-portal/public/logo.jpg
cp water_erp_web/assets/logo.jpg water-erp/apps/web/public/assets/logo.jpg
cp water_erp_web/assets/logo.jpg water-erp/apps/expert-portal/public/assets/logo.jpg
```

Expected: copy commands complete without output.

- [ ] **Step 3: Re-run hash comparison**

```bash
shasum -a 256 water_erp_web/assets/logo.jpg \
  water-erp/apps/mall/public/assets/logo.jpg \
  water-erp/apps/supplier-portal/public/logo.jpg \
  water-erp/apps/web/public/assets/logo.jpg \
  water-erp/apps/expert-portal/public/assets/logo.jpg
```

Expected: all five hashes match.

- [ ] **Step 4: Commit logo normalization if files changed**

Only commit if `git status --short` shows logo changes:

```bash
git add water-erp/apps/mall/public/assets/logo.jpg \
  water-erp/apps/supplier-portal/public/logo.jpg \
  water-erp/apps/web/public/assets/logo.jpg \
  water-erp/apps/expert-portal/public/assets/logo.jpg
git commit -m "chore: normalize login logo assets" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: commit succeeds, or skip this step if no logo files changed.

---

## Task 2: Redesign `3002` mall electronic marketplace login

**Files:**
- Modify: `water-erp/apps/mall/src/app/login/page.tsx`

- [ ] **Step 1: Preserve existing login logic**

Before editing, confirm the function keeps this behavior:

```tsx
const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!form.username || !form.password) { toast.error('请输入用户名和密码'); return; }
  setLoading(true);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.error) { toast.error(data.error); setLoading(false); return; }
    toast.success('登录成功');
    router.push('/');
  } catch {
    toast.error('请求失败，请重试');
  }
  setLoading(false);
};
```

Expected: implementation still posts to `/api/auth/login` and redirects to `/` after success.

- [ ] **Step 2: Replace only the returned JSX**

In `MallLoginPage`, replace the `return (...)` block with this JSX. Do not change imports, state, or `handleLogin`.

```tsx
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#061427] text-white" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(34,211,238,0.22),transparent_30%),radial-gradient(circle_at_78%_72%,rgba(232,132,44,0.24),transparent_26%),linear-gradient(135deg,#061427_0%,#08244a_52%,#050b18_100%)]" />
      <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(125,211,252,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,0.12)_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className="absolute left-[8%] top-[18%] hidden h-64 w-64 rounded-full border border-cyan-300/20 lg:block" />
      <div className="absolute bottom-16 left-[10%] hidden w-[460px] grid-cols-2 gap-3 opacity-80 lg:grid">
        {['管材目录', '钢材采购', '机电设备', '工程服务'].map((item, index) => (
          <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl backdrop-blur-md" style={{ transform: `translateY(${index % 2 ? 18 : 0}px)` }}>
            <div className="mb-3 h-1.5 w-12 rounded-full bg-[#e8842c] shadow-[0_0_20px_rgba(232,132,44,0.55)]" />
            <div className="text-sm font-bold text-white/90">{item}</div>
            <div className="mt-1 text-xs text-white/42">集中目录 · 透明采购</div>
          </div>
        ))}
      </div>

      <main className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <section className="flex flex-1 flex-col justify-between px-7 py-8 sm:px-10 lg:px-16 xl:px-24">
          <div className="flex items-center gap-4">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-12 w-auto rounded-xl border border-white/12 object-cover shadow-[0_0_32px_rgba(34,211,238,0.16)]" />
            <div>
              <div className="text-lg font-black tracking-[0.16em]">四川水发集团</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.28em] text-cyan-100/45">Sichuan Water Development Group</div>
            </div>
          </div>

          <div className="my-16 max-w-2xl lg:my-0">
            <div className="mb-5 inline-flex rounded-full border border-[#e8842c]/30 bg-[#e8842c]/10 px-4 py-1.5 text-xs font-bold tracking-[0.22em] text-orange-200">B2B PROCUREMENT MALL</div>
            <h1 className="text-[clamp(40px,5vw,72px)] font-black leading-[1.02] tracking-tight" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>
              蜀水云采<br />电子商城
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-300/78">集中采购目录 · 一站式水利工程物资采购平台</p>
            <div className="mt-9 grid max-w-xl gap-3 sm:grid-cols-3">
              {['集中目录', '透明价格', '品质溯源'].map(item => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm font-semibold text-white/86 backdrop-blur-md">
                  <span className="mr-2 inline-block h-2 w-2 rotate-45 bg-[#e8842c] shadow-[0_0_14px_rgba(232,132,44,0.8)]" />{item}
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-white/35">智慧水发 · 蜀水云采 · 安全可信的企业采购入口</div>
        </section>

        <section className="flex w-full items-center justify-center px-6 pb-10 lg:w-[480px] lg:px-12 lg:py-0">
          <div className="w-full max-w-sm rounded-[28px] border border-cyan-100/16 bg-[#081428]/72 p-7 shadow-[0_30px_100px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-9">
            <div className="mb-8">
              <div className="mb-3 h-1 w-14 rounded-full bg-gradient-to-r from-[#e8842c] to-[#22d3ee]" />
              <h2 className="text-2xl font-black" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>登录电子商城</h2>
              <p className="mt-2 text-sm text-slate-300/65">进入水利工程物资采购平台</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/55">用户名</span>
                <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="请输入用户名" className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.07] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-cyan-300/70 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)]" />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/55">密码</span>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="请输入密码" className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.07] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-cyan-300/70 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)]" />
              </label>
              <button type="submit" disabled={loading} className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#064ea2] via-[#0ea5e9] to-[#22d3ee] text-sm font-black tracking-[0.18em] text-white shadow-[0_18px_45px_rgba(14,165,233,0.28)] transition hover:brightness-110 disabled:opacity-45">
                {loading ? '登录中...' : '进入商城'}
              </button>
            </form>

            <a href="http://localhost:3006" className="mt-7 inline-flex text-xs font-semibold text-cyan-100/55 transition hover:text-cyan-100" style={{ textDecoration: 'none' }}>← 返回门户</a>
          </div>
        </section>
      </main>
    </div>
  );
```

- [ ] **Step 3: Verify no test account text remains**

Run:

```bash
grep -n "测试\|admin123\|supplier1" water-erp/apps/mall/src/app/login/page.tsx || true
```

Expected: no output.

- [ ] **Step 4: Build mall app**

Run from `water-erp/`:

```bash
pnpm --filter mall build
```

Expected: Next.js build succeeds.

- [ ] **Step 5: Commit mall login redesign**

```bash
git add water-erp/apps/mall/src/app/login/page.tsx
git commit -m "feat: redesign mall login page" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: commit succeeds.

---

## Task 3: Redesign `3003` supplier portal login

**Files:**
- Modify: `water-erp/apps/supplier-portal/src/views/auth/Login.vue`

- [ ] **Step 1: Preserve existing script logic**

Keep the entire `<script setup lang="ts">` block unchanged. It must still contain:

```ts
async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const ok = await authStore.login(form.username, form.password)
    if (ok) {
      ElMessage.success('登录成功')
      router.push('/dashboard')
    } else {
      ElMessage.error('用户名或密码错误')
    }
  } catch {
    ElMessage.error('登录失败，请检查账号密码')
  } finally {
    loading.value = false
  }
}
```

Expected: auth and redirect behavior remain unchanged.

- [ ] **Step 2: Replace the `<template>` block**

Replace the current `<template>...</template>` with:

```vue
<template>
  <div class="sp-login">
    <div class="sp-bg-grid" />
    <div class="sp-bg-orb sp-bg-orb-a" />
    <div class="sp-bg-orb sp-bg-orb-b" />

    <section class="sp-hero">
      <div class="sp-brand-row">
        <img src="/logo.jpg" alt="四川水发集团" class="sp-logo" />
        <div>
          <strong class="sp-brand-name">四川水发集团</strong>
          <small class="sp-brand-sub">智慧水发 · 蜀水云采</small>
        </div>
      </div>

      <div class="sp-hero-copy">
        <span class="sp-kicker">SUPPLIER COLLABORATION PORTAL</span>
        <h1>供应商门户</h1>
        <p>入库协同 · 在线投标 · 全程可追踪</p>
      </div>

      <div class="sp-flow-panel">
        <div v-for="item in ['入库', '投标', '开标', '结果']" :key="item" class="sp-flow-node">
          <span />
          {{ item }}
        </div>
      </div>

      <div class="sp-feature-grid">
        <div class="sp-feature-card">
          <span class="sp-feature-dot" />
          <strong>在线投标</strong>
          <small>实时获取招标信息，高效提交资料</small>
        </div>
        <div class="sp-feature-card">
          <span class="sp-feature-dot" />
          <strong>进度跟踪</strong>
          <small>开标、评标、结果全流程可见</small>
        </div>
        <div class="sp-feature-card">
          <span class="sp-feature-dot" />
          <strong>信息透明</strong>
          <small>公告公示、政策法规随时查阅</small>
        </div>
      </div>
    </section>

    <section class="sp-form-area">
      <div class="sp-form-card">
        <div class="sp-card-accent" />
        <h2>供应商登录</h2>
        <p>进入供应商协同服务平台</p>

        <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="handleLogin">
          <el-form-item prop="username">
            <el-input v-model="form.username" placeholder="请输入用户名" prefix-icon="User" />
          </el-form-item>
          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" placeholder="请输入密码" prefix-icon="Lock" show-password />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="loading" class="sp-login-btn" @click="handleLogin">
              {{ loading ? '登录中...' : '登录门户' }}
            </el-button>
          </el-form-item>
        </el-form>

        <div class="sp-form-footer">
          <span>还没有账号？</span>
          <router-link to="/register">立即注册供应商</router-link>
        </div>
      </div>
    </section>
  </div>
</template>
```

- [ ] **Step 3: Replace the `<style scoped>` block**

Replace the current `<style scoped>...</style>` with:

```vue
<style scoped>
.sp-login {
  min-height: 100vh;
  position: relative;
  display: flex;
  overflow: hidden;
  background: radial-gradient(circle at 18% 20%, rgba(34, 211, 238, 0.2), transparent 30%),
    radial-gradient(circle at 82% 74%, rgba(16, 185, 129, 0.24), transparent 28%),
    linear-gradient(135deg, #061427 0%, #08244a 54%, #050b18 100%);
  color: #fff;
}

.sp-bg-grid {
  position: absolute;
  inset: 0;
  opacity: 0.32;
  background-image: linear-gradient(rgba(125, 211, 252, 0.12) 1px, transparent 1px),
    linear-gradient(90deg, rgba(125, 211, 252, 0.12) 1px, transparent 1px);
  background-size: 36px 36px;
}

.sp-bg-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(2px);
  pointer-events: none;
}

.sp-bg-orb-a {
  left: 9%;
  top: 17%;
  width: 260px;
  height: 260px;
  border: 1px solid rgba(34, 211, 238, 0.22);
}

.sp-bg-orb-b {
  right: 11%;
  bottom: 13%;
  width: 320px;
  height: 320px;
  border: 1px solid rgba(16, 185, 129, 0.18);
}

.sp-hero {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 48px 72px;
}

.sp-brand-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.sp-logo {
  height: 52px;
  width: auto;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  object-fit: cover;
  box-shadow: 0 0 32px rgba(34, 211, 238, 0.16);
}

.sp-brand-name {
  display: block;
  font-family: "SimHei", "黑体", sans-serif;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0.16em;
}

.sp-brand-sub {
  display: block;
  margin-top: 5px;
  color: rgba(203, 213, 225, 0.52);
  font-size: 10px;
  letter-spacing: 0.22em;
}

.sp-hero-copy {
  max-width: 620px;
}

.sp-kicker {
  display: inline-flex;
  margin-bottom: 20px;
  border: 1px solid rgba(16, 185, 129, 0.34);
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.1);
  padding: 7px 14px;
  color: rgba(187, 247, 208, 0.88);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
}

.sp-hero-copy h1 {
  margin: 0;
  font-family: "SimHei", "黑体", sans-serif;
  font-size: clamp(42px, 5vw, 76px);
  font-weight: 900;
  line-height: 1.02;
}

.sp-hero-copy p {
  margin: 24px 0 0;
  color: rgba(203, 213, 225, 0.78);
  font-size: 16px;
  letter-spacing: 0.06em;
}

.sp-flow-panel {
  position: absolute;
  right: 10%;
  top: 25%;
  display: grid;
  gap: 14px;
  width: 170px;
}

.sp-flow-node {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  padding: 12px 14px;
  color: rgba(255, 255, 255, 0.84);
  font-size: 13px;
  backdrop-filter: blur(14px);
}

.sp-flow-node span,
.sp-feature-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #10b981;
  box-shadow: 0 0 18px rgba(16, 185, 129, 0.8);
}

.sp-feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  max-width: 720px;
}

.sp-feature-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.055);
  padding: 18px;
  backdrop-filter: blur(14px);
}

.sp-feature-card strong {
  display: block;
  margin-top: 12px;
  font-size: 15px;
}

.sp-feature-card small {
  display: block;
  margin-top: 6px;
  color: rgba(203, 213, 225, 0.56);
  line-height: 1.6;
}

.sp-form-area {
  position: relative;
  z-index: 2;
  flex: 0 0 480px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
}

.sp-form-card {
  width: 100%;
  max-width: 370px;
  border: 1px solid rgba(186, 230, 253, 0.16);
  border-radius: 30px;
  background: rgba(8, 20, 40, 0.72);
  padding: 36px;
  box-shadow: 0 30px 100px rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(22px);
}

.sp-card-accent {
  width: 56px;
  height: 4px;
  margin-bottom: 24px;
  border-radius: 999px;
  background: linear-gradient(90deg, #10b981, #22d3ee);
}

.sp-form-card h2 {
  margin: 0;
  font-family: "SimHei", "黑体", sans-serif;
  font-size: 26px;
  font-weight: 900;
}

.sp-form-card p {
  margin: 9px 0 30px;
  color: rgba(203, 213, 225, 0.64);
  font-size: 14px;
}

.sp-form-card :deep(.el-input__wrapper) {
  min-height: 48px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.07);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12) inset;
}

.sp-form-card :deep(.el-input__wrapper:hover),
.sp-form-card :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.72) inset, 0 0 0 4px rgba(34, 211, 238, 0.12);
}

.sp-form-card :deep(.el-input__inner) {
  color: #fff;
}

.sp-form-card :deep(.el-input__inner::placeholder) {
  color: rgba(255, 255, 255, 0.32);
}

.sp-login-btn {
  width: 100%;
  height: 48px;
  border: 0;
  border-radius: 16px;
  background: linear-gradient(90deg, #064ea2, #10b981, #22d3ee);
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.18em;
  box-shadow: 0 18px 45px rgba(16, 185, 129, 0.25);
}

.sp-form-footer {
  margin-top: 22px;
  text-align: center;
  color: rgba(203, 213, 225, 0.58);
  font-size: 13px;
}

.sp-form-footer a {
  margin-left: 5px;
  color: #67e8f9;
  font-weight: 800;
  text-decoration: none;
}

.sp-form-footer a:hover {
  color: #a7f3d0;
}

@media (max-width: 1024px) {
  .sp-login {
    flex-direction: column;
  }

  .sp-hero {
    padding: 32px 28px;
  }

  .sp-flow-panel {
    display: none;
  }

  .sp-feature-grid {
    grid-template-columns: 1fr;
  }

  .sp-form-area {
    flex: none;
    width: 100%;
    padding: 0 24px 36px;
  }
}
</style>
```

- [ ] **Step 4: Verify no test account text remains**

Run:

```bash
grep -n "测试\|supplier1\|admin123" water-erp/apps/supplier-portal/src/views/auth/Login.vue || true
```

Expected: no output.

- [ ] **Step 5: Build supplier portal**

Run from `water-erp/`:

```bash
pnpm --filter supplier-portal build
```

Expected: Vite build succeeds.

- [ ] **Step 6: Commit supplier login redesign**

```bash
git add water-erp/apps/supplier-portal/src/views/auth/Login.vue
git commit -m "feat: redesign supplier login page" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: commit succeeds.

---

## Task 4: Redesign `3004` procurement management login

**Files:**
- Modify: `water-erp/apps/web/src/app/login/page.tsx`

- [ ] **Step 1: Preserve existing login logic**

Keep `handleLogin` unchanged. It must continue to post to `/api/auth/login` and redirect to `/dashboard`.

- [ ] **Step 2: Replace only the returned JSX**

Replace the `return (...)` block in `ProcurementLoginPage` with:

```tsx
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#061427] text-white" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(34,211,238,0.2),transparent_30%),radial-gradient(circle_at_80%_75%,rgba(176,140,62,0.24),transparent_28%),linear-gradient(135deg,#061427_0%,#09264d_55%,#050b18_100%)]" />
      <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(125,211,252,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,0.12)_1px,transparent_1px)] [background-size:40px_40px]" />
      <div className="absolute left-[45%] top-[12%] hidden h-[520px] w-[520px] rounded-full border border-[#b08c3e]/18 lg:block" />
      <div className="absolute left-[9%] bottom-24 hidden w-[520px] rounded-[28px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-md lg:block">
        <div className="mb-4 flex items-center justify-between text-xs text-white/42"><span>招采运营态势</span><span>LIVE</span></div>
        <div className="grid grid-cols-3 gap-3">
          {['招采统筹', '过程监管', '资源协同'].map((item, index) => (
            <div key={item} className="rounded-2xl border border-white/10 bg-[#061427]/45 p-4">
              <div className="text-2xl font-black text-[#d6a84f]">0{index + 1}</div>
              <div className="mt-2 text-sm font-bold text-white/86">{item}</div>
              <div className="mt-1 h-1 rounded-full bg-gradient-to-r from-[#b08c3e] to-transparent" />
            </div>
          ))}
        </div>
      </div>

      <main className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <section className="flex flex-1 flex-col justify-between px-7 py-8 sm:px-10 lg:px-16 xl:px-24">
          <div className="flex items-center gap-4">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-12 w-auto rounded-xl border border-white/12 object-cover shadow-[0_0_32px_rgba(34,211,238,0.16)]" />
            <div>
              <div className="text-lg font-black tracking-[0.16em]">四川水发集团</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.28em] text-cyan-100/45">智慧水发 · 蜀水云采</div>
            </div>
          </div>

          <div className="my-16 max-w-2xl lg:my-0">
            <div className="mb-5 inline-flex rounded-full border border-[#b08c3e]/35 bg-[#b08c3e]/10 px-4 py-1.5 text-xs font-bold tracking-[0.22em] text-amber-100">PROCUREMENT OPERATIONS CENTER</div>
            <h1 className="text-[clamp(40px,5vw,72px)] font-black leading-[1.02] tracking-tight" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>
              采购管理<br />运营中枢
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-300/78">信息发布 · 供应商管理 · 专家管理</p>
            <div className="mt-9 grid max-w-xl gap-3 sm:grid-cols-3">
              {['招采统筹', '过程监管', '资源协同'].map(item => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm font-semibold text-white/86 backdrop-blur-md">
                  <span className="mr-2 inline-block h-2 w-2 rotate-45 bg-[#d6a84f] shadow-[0_0_14px_rgba(214,168,79,0.8)]" />{item}
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-white/35">企业级招采全流程管理入口</div>
        </section>

        <section className="flex w-full items-center justify-center px-6 pb-10 lg:w-[480px] lg:px-12 lg:py-0">
          <div className="w-full max-w-sm rounded-[28px] border border-cyan-100/16 bg-[#081428]/72 p-7 shadow-[0_30px_100px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-9">
            <div className="mb-8">
              <div className="mb-3 h-1 w-14 rounded-full bg-gradient-to-r from-[#d6a84f] to-[#22d3ee]" />
              <h2 className="text-2xl font-black" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>管理端登录</h2>
              <p className="mt-2 text-sm text-slate-300/65">进入招采运营管理中枢</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/55">用户名</span><input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="请输入用户名" className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.07] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-cyan-300/70 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)]" /></label>
              <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/55">密码</span><input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="请输入密码" className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.07] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-cyan-300/70 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)]" /></label>
              <button type="submit" disabled={loading} className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#064ea2] via-[#0ea5e9] to-[#22d3ee] text-sm font-black tracking-[0.18em] text-white shadow-[0_18px_45px_rgba(14,165,233,0.28)] transition hover:brightness-110 disabled:opacity-45">{loading ? '验证中...' : '进入管理平台'}</button>
            </form>

            <a href="http://localhost:3006" className="mt-7 inline-flex text-xs font-semibold text-cyan-100/55 transition hover:text-cyan-100" style={{ textDecoration: 'none' }}>← 返回门户</a>
          </div>
        </section>
      </main>
    </div>
  );
```

- [ ] **Step 3: Verify no test account text remains**

```bash
grep -n "测试\|admin123\|lizhuren" water-erp/apps/web/src/app/login/page.tsx || true
```

Expected: no output.

- [ ] **Step 4: Build web app**

Run from `water-erp/`:

```bash
pnpm --filter web build
```

Expected: Next.js build succeeds.

- [ ] **Step 5: Commit procurement login redesign**

```bash
git add water-erp/apps/web/src/app/login/page.tsx
git commit -m "feat: redesign procurement login page" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: commit succeeds.

---

## Task 5: Redesign `3005` expert review workstation login

**Files:**
- Modify: `water-erp/apps/expert-portal/src/app/login/page.tsx`

- [ ] **Step 1: Preserve expert role guard**

Confirm the final file still contains this exact role check:

```tsx
const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
if (me.role !== 'bid_expert') {
  toast.error('非专家账户，请使用专家账号登录');
  setLoading(false);
  return;
}
toast.success('登录成功');
router.push('/');
```

Expected: non-expert accounts remain blocked.

- [ ] **Step 2: Replace only the returned JSX**

Replace the `return (...)` block in `ExpertLoginPage` with:

```tsx
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#061427] text-white" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_78%_72%,rgba(124,58,237,0.25),transparent_28%),linear-gradient(135deg,#061427_0%,#101c4e_55%,#050b18_100%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(125,211,252,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,0.1)_1px,transparent_1px)] [background-size:38px_38px]" />
      <div className="absolute left-[10%] bottom-20 hidden w-[520px] rounded-[28px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-md lg:block">
        <div className="mb-4 flex items-center justify-between text-xs text-white/42"><span>评审评分矩阵</span><span>TRACEABLE</span></div>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 20 }).map((_, index) => (
            <div key={index} className="h-9 rounded-lg border border-white/8 bg-white/[0.04]" style={{ boxShadow: index % 4 === 0 ? '0 0 22px rgba(124,58,237,0.28) inset' : undefined }} />
          ))}
        </div>
      </div>

      <main className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <section className="flex flex-1 flex-col justify-between px-7 py-8 sm:px-10 lg:px-16 xl:px-24">
          <div className="flex items-center gap-4">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-12 w-auto rounded-xl border border-white/12 object-cover shadow-[0_0_32px_rgba(34,211,238,0.16)]" />
            <div>
              <div className="text-lg font-black tracking-[0.16em]">四川水发集团</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.28em] text-cyan-100/45">智慧水发 · 蜀水云采</div>
            </div>
          </div>

          <div className="my-16 max-w-2xl lg:my-0">
            <div className="mb-5 inline-flex rounded-full border border-violet-300/35 bg-violet-500/10 px-4 py-1.5 text-xs font-bold tracking-[0.22em] text-violet-100">EXPERT REVIEW STATION</div>
            <h1 className="text-[clamp(40px,5vw,72px)] font-black leading-[1.02] tracking-tight" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>
              专家评审<br />工作站
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-300/78">独立评审 · 在线评分 · 全程留痕</p>
            <div className="mt-9 grid max-w-xl gap-3 sm:grid-cols-3">
              {['独立评审', '智能辅助', '过程留痕'].map(item => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm font-semibold text-white/86 backdrop-blur-md">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#7c3aed] shadow-[0_0_14px_rgba(124,58,237,0.8)]" />{item}
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-white/35">专业、独立、可信的在线开评标入口</div>
        </section>

        <section className="flex w-full items-center justify-center px-6 pb-10 lg:w-[480px] lg:px-12 lg:py-0">
          <div className="w-full max-w-sm rounded-[28px] border border-cyan-100/16 bg-[#081428]/72 p-7 shadow-[0_30px_100px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-9">
            <div className="mb-8">
              <div className="mb-3 h-1 w-14 rounded-full bg-gradient-to-r from-[#7c3aed] via-[#b08c3e] to-[#22d3ee]" />
              <h2 className="text-2xl font-black" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>专家登录</h2>
              <p className="mt-2 text-sm text-slate-300/65">进入在线开评标工作台</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/55">专家账号</span><input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="请输入专家账户" className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.07] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-cyan-300/70 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)]" /></label>
              <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-cyan-100/55">密码</span><input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="请输入密码" className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.07] px-4 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-cyan-300/70 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)]" /></label>
              <button type="submit" disabled={loading} className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#064ea2] via-[#6366f1] to-[#22d3ee] text-sm font-black tracking-[0.16em] text-white shadow-[0_18px_45px_rgba(99,102,241,0.28)] transition hover:brightness-110 disabled:opacity-45">{loading ? '验证中...' : '进入评审工作站'}</button>
            </form>

            <a href="http://localhost:3006" className="mt-7 inline-flex text-xs font-semibold text-cyan-100/55 transition hover:text-cyan-100" style={{ textDecoration: 'none' }}>← 返回门户</a>
          </div>
        </section>
      </main>
    </div>
  );
```

- [ ] **Step 3: Verify no test account text remains and role guard remains**

```bash
grep -n "测试\|admin123\|supplier1" water-erp/apps/expert-portal/src/app/login/page.tsx || true
grep -n "me.role !== 'bid_expert'" water-erp/apps/expert-portal/src/app/login/page.tsx
```

Expected: first command has no output; second command prints the role guard line.

- [ ] **Step 4: Build expert portal**

Run from `water-erp/`:

```bash
pnpm --filter expert-portal build
```

Expected: Next.js build succeeds.

- [ ] **Step 5: Commit expert login redesign**

```bash
git add water-erp/apps/expert-portal/src/app/login/page.tsx
git commit -m "feat: redesign expert login page" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: commit succeeds.

---

## Task 6: Run integrated validation for all four login pages

**Files:**
- Validate: `water-erp/apps/mall/src/app/login/page.tsx`
- Validate: `water-erp/apps/supplier-portal/src/views/auth/Login.vue`
- Validate: `water-erp/apps/web/src/app/login/page.tsx`
- Validate: `water-erp/apps/expert-portal/src/app/login/page.tsx`

- [ ] **Step 1: Run all relevant builds**

Run from `water-erp/`:

```bash
pnpm --filter mall build
pnpm --filter supplier-portal build
pnpm --filter web build
pnpm --filter expert-portal build
```

Expected: all four builds succeed.

- [ ] **Step 2: Start or confirm dev servers**

If dev servers are not already listening on `3002-3005`, run from `water-erp/`:

```bash
pnpm dev
```

Expected: ports are available as:

- `http://localhost:3002/login` mall electronic marketplace
- `http://localhost:3003/login` supplier portal
- `http://localhost:3004/login` procurement management platform
- `http://localhost:3005/login` expert review workstation

- [ ] **Step 3: Smoke-check visible text via HTTP**

Run:

```bash
python3 - <<'PY'
import urllib.request, re
expected = {
    3002: ['蜀水云采', '电子商城', '登录电子商城', '进入商城'],
    3003: ['供应商门户', '供应商登录', '登录门户', '立即注册供应商'],
    3004: ['采购管理', '运营中枢', '管理端登录', '进入管理平台'],
    3005: ['专家评审', '工作站', '专家登录', '进入评审工作站'],
}
for port, terms in expected.items():
    raw = urllib.request.urlopen(f'http://localhost:{port}/login', timeout=10).read().decode('utf-8', 'replace')
    text = re.sub(r'<[^>]+>', ' ', raw)
    missing = [term for term in terms if term not in text]
    forbidden = [term for term in ['测试', 'admin123', 'supplier1'] if term in text]
    print(port, 'missing=', missing, 'forbidden=', forbidden)
    if missing or forbidden:
        raise SystemExit(1)
PY
```

Expected:

```text
3002 missing= [] forbidden= []
3003 missing= [] forbidden= []
3004 missing= [] forbidden= []
3005 missing= [] forbidden= []
```

- [ ] **Step 4: Manually inspect pages in browser**

Open each page:

```bash
open http://localhost:3002/login
open http://localhost:3003/login
open http://localhost:3004/login
open http://localhost:3005/login
```

Expected visual checks:

- All pages show the四川水发集团 logo and company name.
- All pages share a dark digital water cockpit style.
- `3002` uses orange accents and marketplace/procurement catalog language.
- `3003` uses green accents and supplier collaboration language.
- `3004` uses gold accents and procurement operations language.
- `3005` uses purple accents and expert review language.
- No page shows test account hints.
- Login form fields remain visible and usable.

- [ ] **Step 5: Commit validation-only fixes if needed**

If Step 3 or Step 4 reveals small copy/visual issues, fix those files, rerun Steps 1 and 3, then commit:

```bash
git add water-erp/apps/mall/src/app/login/page.tsx \
  water-erp/apps/supplier-portal/src/views/auth/Login.vue \
  water-erp/apps/web/src/app/login/page.tsx \
  water-erp/apps/expert-portal/src/app/login/page.tsx
git commit -m "fix: polish redesigned login pages" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: commit succeeds, or skip if no fixes are needed.

---

## Task 7: Final review and status report

**Files:**
- Review: git diff/status and commit history

- [ ] **Step 1: Check working tree**

```bash
git status --short
```

Expected: no unexpected changes. If unrelated pre-existing files remain modified, report them and do not include them in login UI commits.

- [ ] **Step 2: Confirm recent commits**

```bash
git log --oneline -6
```

Expected: shows the spec commit plus login redesign commits.

- [ ] **Step 3: Prepare final summary**

Final response must include:

```markdown
Implemented login UI redesign for:
- 3002 mall electronic marketplace
- 3003 supplier portal
- 3004 procurement management platform
- 3005 expert review workstation

Verified:
- all four builds pass
- actual login routes render expected module text
- test account hints removed
- auth logic and redirects preserved

Notes:
- [list any unrelated pre-existing changes, if present]
```

Expected: user receives accurate outcome, including any failed/skipped checks.

---

## Self-Review

### Spec coverage

- Correct port mapping covered: Task 2 (`3002` mall), Task 3 (`3003` supplier), Task 4 (`3004` procurement), Task 5 (`3005` expert).
- Unified brand system covered: Tasks 1-5 use logo/company name and dark digital water cockpit style.
- Module-specific accents covered: orange, green, gold, purple per task.
- Test account removal covered: each task includes grep verification, and Task 6 repeats integrated forbidden-text check.
- Auth preservation covered: each app task explicitly preserves existing login logic; expert task explicitly preserves role guard.
- Responsive behavior covered by Tailwind responsive classes and Vue media query.
- Validation covered by individual builds plus integrated HTTP/manual checks.

### Placeholder scan

No TBD/TODO/fill-later placeholders are present. Each task includes exact file paths, commands, expected outputs, and concrete code blocks for code changes.

### Type consistency

React pages keep existing `useState`, `useRouter`, `toast`, and `React.FormEvent` usage. Vue page keeps existing `formRef`, `rules`, `form`, `loading`, `handleLogin`, and Element Plus components. Route destinations remain `/`, `/dashboard`, `/register`, and `http://localhost:3006` as defined in the existing pages.
