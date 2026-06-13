# Login UI Light Minimal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the four login pages on ports `3002`-`3005` from the current/dark visual direction to a bright, minimal, high-end enterprise technology style.

**Architecture:** Modify each login page in place while preserving its existing authentication logic, role checks, and redirects. Each page uses the same layout language: light gradient background, minimal left-side brand/module copy, right-side white login card, module-specific accent color, and very low-noise decoration.

**Tech Stack:** Next.js 16 + React 19 + Tailwind CSS v4 for `apps/mall`, `apps/web`, `apps/expert-portal`; Vue 3 + Vite + Element Plus scoped CSS for `apps/supplier-portal`.

---

## File Structure

- Modify `water-erp/apps/mall/src/app/login/page.tsx`
  - `3002` electronic mall login page.
  - Keep `handleLogin` and `router.push('/')` unchanged.
  - Use light blue/orange minimal style.

- Modify `water-erp/apps/supplier-portal/src/views/auth/Login.vue`
  - `3003` supplier portal login page.
  - Keep the entire `<script setup>` logic unchanged, including `authStore.login` and `router.push('/dashboard')`.
  - Use light blue/green minimal style.

- Modify `water-erp/apps/web/src/app/login/page.tsx`
  - `3004` procurement management login page.
  - Keep `handleLogin` and `router.push('/dashboard')` unchanged.
  - Use light blue/gold minimal style.

- Modify `water-erp/apps/expert-portal/src/app/login/page.tsx`
  - `3005` expert review login page.
  - Keep `handleLogin`, `/api/auth/me`, expert role guard, and `router.push('/')` unchanged.
  - Use light blue/purple minimal style.

- Do not modify unrelated current working tree files:
  - `water-erp/apps/supplier-portal/src/layouts/MainLayout.vue`
  - `water-erp/apps/supplier-portal/src/styles/global.css`
  - `water-erp/apps/supplier-portal/src/views/bid/BidList.vue`

---

## Shared UI Requirements for Every Task

Every login page must satisfy these requirements:

- Bright visual system: white / light gray-blue / soft water-blue background.
- Layout: left brand/module copy, right login card on desktop; stacked layout on mobile.
- Non-login elements must be minimal: no complex floating dashboards, dense matrices, or many decorative cards.
- Use the existing logo path for that app:
  - Next apps: `/assets/logo.jpg`
  - Supplier portal: `/logo.jpg`
- Include company name: `四川水发集团`.
- Include brand phrase: `智慧水发 · 蜀水云采`.
- Remove all test account hints: `测试`, `admin123`, `supplier1`, `lizhuren`.
- Preserve login logic exactly unless a build error forces formatting-only changes.
- Mobile must allow vertical scrolling and not clip the login card.

Recommended reusable visual structure for React pages:

```tsx
<div className="min-h-screen overflow-x-hidden bg-[#f6f9fd] text-slate-900" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(6,78,162,0.12),transparent_30%),radial-gradient(circle_at_82%_78%,ACCENT_GLOW,transparent_28%)]" />
  <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:px-12">
    {/* left brand/module copy */}
    {/* right login card */}
  </main>
</div>
```

Recommended login card visual style:

```tsx
<div className="w-full max-w-md rounded-[28px] border border-blue-100 bg-white/92 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur sm:p-10">
```

---

## Task 1: Convert `3002` electronic mall login to light minimal style

**Files:**
- Modify: `water-erp/apps/mall/src/app/login/page.tsx`

- [ ] **Step 1: Preserve login logic**

Keep this behavior unchanged:

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

- [ ] **Step 2: Implement the light mall layout**

Replace only returned JSX. The page must include:

```text
四川水发集团
智慧水发 · 蜀水云采
蜀水云采电子商城
集中采购目录 · 一站式水利工程物资采购平台
集中目录
透明价格
品质溯源
登录电子商城
进入水利工程物资采购平台
进入商城
返回门户
```

Use orange accent `#e8842c`, but keep most of the page white/light blue. Use at most one subtle background glow, a few small tags, and the login card.

- [ ] **Step 3: Verify forbidden text removed**

```bash
grep -n "测试\|admin123\|supplier1\|lizhuren" water-erp/apps/mall/src/app/login/page.tsx || true
```

Expected: no output.

- [ ] **Step 4: Build mall**

```bash
cd water-erp && pnpm --filter mall build
```

Expected: build succeeds, or failure is documented if unrelated to this login page.

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/mall/src/app/login/page.tsx
git commit -m "style: simplify mall login light theme" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Convert `3003` supplier portal login to light minimal style

**Files:**
- Modify: `water-erp/apps/supplier-portal/src/views/auth/Login.vue`

- [ ] **Step 1: Preserve script logic**

The `<script setup lang="ts">` block must remain behaviorally unchanged, including:

```ts
const ok = await authStore.login(form.username, form.password)
router.push('/dashboard')
```

- [ ] **Step 2: Implement the light supplier layout**

Replace template/style only. The page must include:

```text
四川水发集团
智慧水发 · 蜀水云采
供应商门户
入库协同 · 在线投标 · 全程可追踪
在线投标
进度跟踪
信息透明
供应商登录
进入供应商协同服务平台
登录门户
还没有账号？
立即注册供应商
```

Use green accent `#10b981` or `#18a56c`. Keep Element Plus inputs and button. Ensure mobile media query allows vertical scrolling:

```css
@media (max-width: 900px) {
  .sp-login {
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
  }
}
```

- [ ] **Step 3: Verify forbidden text removed**

```bash
grep -n "测试\|admin123\|supplier1\|lizhuren" water-erp/apps/supplier-portal/src/views/auth/Login.vue || true
```

Expected: no output.

- [ ] **Step 4: Build supplier portal**

```bash
cd water-erp && pnpm --filter supplier-portal build
```

Expected: build succeeds. Existing Vite chunk warnings are acceptable.

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/supplier-portal/src/views/auth/Login.vue
git commit -m "style: simplify supplier login light theme" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Convert `3004` procurement management login to light minimal style

**Files:**
- Modify: `water-erp/apps/web/src/app/login/page.tsx`

- [ ] **Step 1: Preserve login logic**

Keep `/api/auth/login`, `credentials: 'include'`, and `router.push('/dashboard')` unchanged.

- [ ] **Step 2: Implement the light procurement layout**

Replace only returned JSX. The page must include:

```text
四川水发集团
智慧水发 · 蜀水云采
采购管理平台
信息发布 · 供应商管理 · 专家管理
招采统筹
过程监管
资源协同
管理端登录
进入招采运营管理中枢
进入管理平台
返回门户
```

Use gold accent `#b08c3e` or `#d6a84f` sparingly. Keep layout clean and avoid dashboard-like decorative panels.

- [ ] **Step 3: Verify forbidden text removed**

```bash
grep -n "测试\|admin123\|supplier1\|lizhuren" water-erp/apps/web/src/app/login/page.tsx || true
```

Expected: no output.

- [ ] **Step 4: Build web**

```bash
cd water-erp && pnpm --filter web build
```

Expected: build succeeds, or failure is documented if unrelated and pre-existing.

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/web/src/app/login/page.tsx
git commit -m "style: simplify procurement login light theme" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Convert `3005` expert review login to light minimal style

**Files:**
- Modify: `water-erp/apps/expert-portal/src/app/login/page.tsx`

- [ ] **Step 1: Preserve expert auth logic**

Keep this behavior unchanged:

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

- [ ] **Step 2: Implement the light expert layout**

Replace only returned JSX. The page must include:

```text
四川水发集团
智慧水发 · 蜀水云采
专家评审工作站
独立评审 · 在线评分 · 全程留痕
独立评审
智能辅助
过程留痕
专家登录
进入在线开评标工作台
进入评审工作站
返回门户
```

Use purple accent `#6366f1` or `#7c3aed`. Keep the page serious, low-noise, and readable.

- [ ] **Step 3: Verify forbidden text removed and role guard kept**

```bash
grep -n "测试\|admin123\|supplier1\|lizhuren" water-erp/apps/expert-portal/src/app/login/page.tsx || true
grep -n "me.role !== 'bid_expert'" water-erp/apps/expert-portal/src/app/login/page.tsx
```

Expected: first command has no output; second command prints the role guard line.

- [ ] **Step 4: Build expert portal**

```bash
cd water-erp && pnpm --filter expert-portal build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/expert-portal/src/app/login/page.tsx
git commit -m "style: simplify expert login light theme" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Integrated validation

**Files:**
- Validate all four login files above.

- [ ] **Step 1: Run forbidden-text scan**

```bash
grep -RIn "测试\|admin123\|supplier1\|lizhuren" \
  water-erp/apps/mall/src/app/login/page.tsx \
  water-erp/apps/supplier-portal/src/views/auth/Login.vue \
  water-erp/apps/web/src/app/login/page.tsx \
  water-erp/apps/expert-portal/src/app/login/page.tsx || true
```

Expected: no output.

- [ ] **Step 2: Run builds**

```bash
cd water-erp
pnpm --filter mall build
pnpm --filter supplier-portal build
pnpm --filter web build
pnpm --filter expert-portal build
```

Expected: all builds pass, except known unrelated pre-existing build failures must be reported precisely.

- [ ] **Step 3: Check rendered route text if dev servers are running**

```bash
python3 - <<'PY'
import urllib.request, re
expected = {
    3002: ['蜀水云采电子商城', '登录电子商城', '进入商城'],
    3003: ['供应商门户', '供应商登录', '登录门户', '立即注册供应商'],
    3004: ['采购管理平台', '管理端登录', '进入管理平台'],
    3005: ['专家评审工作站', '专家登录', '进入评审工作站'],
}
for port, terms in expected.items():
    raw = urllib.request.urlopen(f'http://localhost:{port}/login', timeout=10).read().decode('utf-8', 'replace')
    text = re.sub(r'<[^>]+>', ' ', raw)
    missing = [term for term in terms if term not in text]
    forbidden = [term for term in ['测试', 'admin123', 'supplier1', 'lizhuren'] if term in text]
    print(port, 'missing=', missing, 'forbidden=', forbidden)
    if missing or forbidden:
        raise SystemExit(1)
PY
```

Expected: every port prints `missing= [] forbidden= []`. If dev servers are not running, start them with `cd water-erp && pnpm dev` or report that route smoke was skipped.

- [ ] **Step 4: Final status**

```bash
git status --short
```

Expected: no unexpected changes. Pre-existing unrelated modified supplier files may still appear and must be listed as unrelated.

---

## Self-Review

### Spec coverage

- Bright color system: Tasks 1-4 explicitly convert each page to white/light gray-blue backgrounds.
- Minimal layout: Tasks 1-4 require left copy + right login card and forbid complex decorations.
- Module differences: each task has its accent color and required module text.
- Logo/company/brand phrase: covered by shared requirements and each task.
- Test account removal: per-task grep and integrated grep.
- Auth preservation: specified per task, including expert role guard.
- Mobile usability: shared requirement plus supplier explicit CSS; React pages use non-clipping `min-h-screen` and normal vertical document scrolling.

### Placeholder scan

No TBD/TODO placeholders are present. All tasks include exact paths, commands, expected results, and concrete content requirements.

### Type consistency

React tasks keep the same state and handler names already in their files. Vue task keeps the existing `form`, `loading`, `formRef`, `rules`, and `handleLogin` names. Route destinations remain `/`, `/dashboard`, `/register`, and `http://localhost:3006` as appropriate.
