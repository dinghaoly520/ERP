# Supplier Portal Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Vue supplier portal on port 3003 into a branded supplier business cockpit with improved navigation, dashboard, tender opportunity, bid progress, announcement, and login experiences.

**Architecture:** Keep the existing Vue 3 + Vite + Element Plus + Pinia architecture and current API contracts. Implement the upgrade as focused presentation-layer changes: global design tokens/utilities first, then shell/navigation, then high-impact pages that reuse existing stores and routes.

**Tech Stack:** Vue 3 single-file components, Vite, Element Plus, Pinia, TypeScript, CSS variables, existing `supplierApi`, `bidStore`, `supplierStore`, `announcementStore`, and `notificationStore`.

---

## File Structure

Modify these files only for the first implementation pass:

- `water-erp/apps/supplier-portal/src/styles/global.css`
  - Own the refreshed design language: richer shadows, gradients, business cockpit utility classes, page headers, filter panels, opportunity cards, task cards, announcement rows, and responsive behavior.
- `water-erp/apps/supplier-portal/src/layouts/MainLayout.vue`
  - Own global shell: grouped navigation labels, brand block, header search/quick action area, mobile drawer behavior, notification and user controls.
- `water-erp/apps/supplier-portal/src/views/dashboard/Dashboard.vue`
  - Own the new supplier cockpit: status hero, today tasks, metrics, tender opportunities, announcements, notifications, and progress guidance.
- `water-erp/apps/supplier-portal/src/views/bid/BidList.vue`
  - Own tender opportunity browsing: upgraded page header, stage summary, filters, opportunity cards, deadline emphasis, and empty state.
- `water-erp/apps/supplier-portal/src/views/bid/MyBids.vue`
  - Own bid progress management: summary cards, card-first progress layout, withdrawal action, and empty state.
- `water-erp/apps/supplier-portal/src/views/announcement/AnnouncementList.vue`
  - Own announcement/public notice browsing: upgraded header, category filters, list hierarchy, and empty state.
- `water-erp/apps/supplier-portal/src/views/auth/Login.vue`
  - Own first impression: branded split login page, platform value points, demo credentials, and responsive layout.

Do not modify the backend, database schema, or `water_erp_web/` legacy prototype.

## Task 1: Global Supplier Portal Design Language

**Files:**
- Modify: `water-erp/apps/supplier-portal/src/styles/global.css`

- [ ] **Step 1: Replace visual tokens at the top of `global.css`**

Replace the existing `:root { ... }` block with:

```css
:root {
  /* Primary palette — Sichuan Water / procurement trust */
  --sp-primary: #0756a5;
  --sp-primary-light: #1684d8;
  --sp-primary-lighter: #e8f4ff;
  --sp-primary-dark: #042a58;

  /* Water brand accents */
  --sp-cyan: #06a8c9;
  --sp-cyan-light: #d8f7ff;
  --sp-green: #059669;
  --sp-green-light: #dff8ec;
  --sp-orange: #d97706;
  --sp-orange-light: #fff3d6;
  --sp-red: #dc2626;
  --sp-red-light: #ffe4e6;
  --sp-purple: #7c3aed;
  --sp-purple-light: #ede9fe;

  /* Neutrals */
  --sp-gray-900: #0f172a;
  --sp-gray-700: #334155;
  --sp-gray-600: #475569;
  --sp-gray-500: #64748b;
  --sp-gray-400: #94a3b8;
  --sp-gray-300: #cbd5e1;
  --sp-gray-200: #e2e8f0;
  --sp-gray-100: #f1f5f9;
  --sp-gray-50: #f8fafc;
  --sp-white: #ffffff;

  /* Surfaces */
  --sp-bg: #eef5fb;
  --sp-surface: #ffffff;
  --sp-surface-soft: rgba(255, 255, 255, 0.82);
  --sp-surface-hover: #f8fbff;
  --sp-border: #dbe7f3;
  --sp-border-light: #edf4fa;

  /* Shadows */
  --sp-shadow-xs: 0 1px 2px rgba(15, 23, 42, 0.05);
  --sp-shadow-sm: 0 10px 30px rgba(4, 42, 88, 0.06);
  --sp-shadow-md: 0 18px 45px rgba(4, 42, 88, 0.10);
  --sp-shadow-lg: 0 28px 70px rgba(4, 42, 88, 0.16);
  --sp-shadow-primary: 0 18px 45px rgba(7, 86, 165, 0.22);

  /* Radius */
  --sp-radius-sm: 6px;
  --sp-radius-md: 12px;
  --sp-radius-lg: 18px;
  --sp-radius-xl: 24px;
  --sp-radius-full: 999px;

  /* Transitions */
  --sp-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --sp-duration-fast: 150ms;
  --sp-duration-normal: 250ms;
  --sp-duration-slow: 350ms;
}
```

- [ ] **Step 2: Replace the `body { ... }` block**

Use this exact block:

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC",
    "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: var(--sp-gray-900);
  background:
    radial-gradient(circle at 14% 4%, rgba(22, 132, 216, 0.16), transparent 28%),
    radial-gradient(circle at 90% 12%, rgba(6, 168, 201, 0.12), transparent 26%),
    linear-gradient(180deg, #f5faff 0%, var(--sp-bg) 44%, #edf5fb 100%);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 3: Update Element Plus card/dialog/button radius overrides**

Find the `.el-button--primary`, `.el-card`, `.el-dialog`, `.el-tag`, and `.el-input__wrapper` overrides. Ensure they match these values without deleting unrelated overrides:

```css
.el-button--primary {
  --el-button-bg-color: var(--sp-primary);
  --el-button-border-color: var(--sp-primary);
  --el-button-hover-bg-color: var(--sp-primary-light);
  --el-button-hover-border-color: var(--sp-primary-light);
  --el-button-active-bg-color: var(--sp-primary-dark);
  --el-button-active-border-color: var(--sp-primary-dark);
  box-shadow: var(--sp-shadow-xs);
  border-radius: var(--sp-radius-sm);
  font-weight: 700;
}

.el-input__wrapper,
.el-textarea__inner {
  border-radius: var(--sp-radius-sm) !important;
  box-shadow: 0 0 0 1px var(--sp-border) inset !important;
}

.el-card {
  border-radius: var(--sp-radius-md) !important;
  border: 1px solid var(--sp-border) !important;
  box-shadow: var(--sp-shadow-sm) !important;
}

.el-dialog { border-radius: var(--sp-radius-md) !important; }
.el-tag { border-radius: var(--sp-radius-full) !important; font-weight: 700; }
```

- [ ] **Step 4: Append business cockpit utility CSS before the existing responsive section**

Insert this block immediately before the comment `/* ─── Responsive ─── */`:

```css
/* ─── Business cockpit utilities ─── */
.sp-page-hero {
  position: relative;
  overflow: hidden;
  border-radius: var(--sp-radius-xl);
  padding: 28px;
  color: #fff;
  background:
    linear-gradient(135deg, rgba(4, 42, 88, 0.96), rgba(7, 86, 165, 0.92) 48%, rgba(6, 168, 201, 0.86)),
    radial-gradient(circle at 78% 22%, rgba(255, 255, 255, 0.22), transparent 24%);
  box-shadow: var(--sp-shadow-primary);
}

.sp-page-hero::after {
  content: '';
  position: absolute;
  inset: auto -8% -44% 36%;
  height: 180px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  transform: rotate(-6deg);
}

.sp-hero-kicker {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: var(--sp-radius-full);
  background: rgba(255, 255, 255, 0.12);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.sp-hero-title {
  position: relative;
  z-index: 1;
  margin-top: 14px;
  font-size: 30px;
  line-height: 1.18;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.sp-hero-desc {
  position: relative;
  z-index: 1;
  margin-top: 8px;
  max-width: 680px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 14px;
}

.sp-hero-actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}

.sp-glass-card {
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(219, 231, 243, 0.9);
  border-radius: var(--sp-radius-lg);
  box-shadow: var(--sp-shadow-sm);
  backdrop-filter: blur(14px);
}

.sp-filter-panel {
  padding: 18px 20px;
  border-radius: var(--sp-radius-lg);
  border: 1px solid var(--sp-border);
  background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,251,255,0.92));
  box-shadow: var(--sp-shadow-sm);
}

.sp-metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.sp-business-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--sp-border);
  border-radius: var(--sp-radius-lg);
  background: var(--sp-surface);
  box-shadow: var(--sp-shadow-sm);
  transition: transform var(--sp-duration-normal) var(--sp-ease), box-shadow var(--sp-duration-normal) var(--sp-ease), border-color var(--sp-duration-normal) var(--sp-ease);
}

.sp-business-card:hover {
  transform: translateY(-3px);
  border-color: rgba(22, 132, 216, 0.42);
  box-shadow: var(--sp-shadow-md);
}

.sp-task-list {
  display: grid;
  gap: 12px;
}

.sp-task-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: var(--sp-radius-md);
  border: 1px solid var(--sp-border-light);
  background: var(--sp-gray-50);
  cursor: pointer;
  transition: all var(--sp-duration-fast) var(--sp-ease);
}

.sp-task-item:hover {
  background: var(--sp-primary-lighter);
  border-color: rgba(22, 132, 216, 0.32);
}

.sp-task-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 18px;
}

.sp-task-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--sp-gray-900);
}

.sp-task-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--sp-gray-500);
}

.sp-opportunity-card {
  padding: 18px;
  border-radius: var(--sp-radius-lg);
  border: 1px solid var(--sp-border);
  background: linear-gradient(180deg, #fff 0%, #fbfdff 100%);
  box-shadow: var(--sp-shadow-sm);
  cursor: pointer;
  transition: all var(--sp-duration-normal) var(--sp-ease);
}

.sp-opportunity-card:hover {
  transform: translateY(-3px);
  border-color: var(--sp-primary-light);
  box-shadow: var(--sp-shadow-md);
}

.sp-opportunity-title {
  margin-top: 12px;
  color: var(--sp-gray-900);
  font-size: 16px;
  font-weight: 850;
  line-height: 1.42;
}

.sp-opportunity-meta {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  color: var(--sp-gray-500);
  font-size: 13px;
}

.sp-meta-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.sp-meta-line .el-icon { color: var(--sp-primary-light); }

.sp-deadline-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: var(--sp-radius-full);
  color: #92400e;
  background: var(--sp-orange-light);
  font-size: 12px;
  font-weight: 800;
}

.sp-page-title-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-end;
  margin-bottom: 18px;
}

.sp-page-eyebrow {
  color: var(--sp-primary);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.sp-modern-title {
  margin-top: 4px;
  font-size: 28px;
  line-height: 1.18;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: var(--sp-gray-900);
}

.sp-modern-desc {
  margin-top: 6px;
  color: var(--sp-gray-500);
}

.sp-chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sp-chip {
  border-radius: var(--sp-radius-full) !important;
  font-weight: 800 !important;
}

.sp-section-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.sp-section-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--sp-gray-900);
  font-size: 16px;
  font-weight: 900;
}

.sp-section-card-subtitle {
  margin-top: 2px;
  color: var(--sp-gray-500);
  font-size: 12px;
}

@media (max-width: 1200px) {
  .sp-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 768px) {
  .sp-page-title-row { align-items: flex-start; flex-direction: column; }
  .sp-page-hero { padding: 22px; border-radius: var(--sp-radius-lg); }
  .sp-hero-title { font-size: 24px; }
  .sp-metric-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 5: Run supplier portal build**

Run from `/Users/qihao/Desktop/ERP/water-erp`:

```bash
pnpm --filter supplier-portal build
```

Expected: build completes. If build fails because CSS syntax was pasted incorrectly, fix the syntax before continuing.

- [ ] **Step 6: Commit global styles**

```bash
git add water-erp/apps/supplier-portal/src/styles/global.css
git commit -m "style: upgrade supplier portal design language"
```

## Task 2: Shell and Navigation Upgrade

**Files:**
- Modify: `water-erp/apps/supplier-portal/src/layouts/MainLayout.vue`

- [ ] **Step 1: Replace the `menuItems` array**

Use this exact array in the `<script setup>` section:

```ts
const menuItems = [
  { path: '/dashboard', title: '业务工作台', icon: HomeFilled, desc: '状态与待办总览' },
  { divider: true, label: '投标中心' },
  { path: '/bids', title: '招标机会', icon: Document, desc: '发现可参与项目' },
  { path: '/my-bids', title: '投标进展', icon: DocumentChecked, desc: '跟踪已投项目' },
  { divider: true, label: '企业档案' },
  { path: '/onboarding', title: '入驻状态', icon: Stamp, desc: '审核与补正进度' },
  { path: '/profile', title: '企业信息', icon: OfficeBuilding, desc: '主体资料维护' },
  { path: '/qualifications', title: '资质与证照', icon: Medal, desc: '证照有效期管理' },
  { path: '/contacts', title: '联系人', icon: Phone, desc: '业务联系人维护' },
  { path: '/change-records', title: '资料变更申请', icon: EditPen, desc: '变更审核记录' },
  { divider: true, label: '信息中心' },
  { path: '/announcements', title: '公告公示', icon: Bell, desc: '公告与政策' },
  { path: '/notifications', title: '消息通知', icon: ChatDotRound, badge: true, desc: '平台消息' },
  { path: '/evaluations', title: '履约评价', icon: Star, desc: '评价记录' },
]
```

- [ ] **Step 2: Add the active menu object computed value**

After `const activeMenu = computed(() => route.path)`, add:

```ts
const activeMenuItem = computed(() => menuItems.find((item: any) => item.path === route.path))
```

- [ ] **Step 3: Replace the logo block template**

Replace the `<div class="sp-sidebar-logo" ...>` block with:

```vue
<div class="sp-sidebar-logo" @click="router.push('/dashboard')">
  <img src="/logo.jpg" alt="四川水发集团" class="sp-logo-img" />
  <transition name="sp-fade">
    <div v-show="!isCollapse" class="sp-logo-text">
      <span class="sp-logo-title">蜀水云采</span>
      <span class="sp-logo-sub">供应商业务门户</span>
    </div>
  </transition>
</div>
```

- [ ] **Step 4: Replace the breadcrumb/header-left template**

In the header, replace the current `.sp-header-left` contents with:

```vue
<div class="sp-header-left">
  <el-icon class="sp-collapse-btn" @click="isCollapse = !isCollapse">
    <component :is="isCollapse ? Expand : Fold" />
  </el-icon>
  <div class="sp-header-title-wrap">
    <div class="sp-header-kicker">SUPPLIER PORTAL</div>
    <div class="sp-header-title">{{ activeMenuItem?.title || route.meta?.title || '供应商门户' }}</div>
  </div>
</div>
```

- [ ] **Step 5: Add a quick search button before the notification bell**

Inside `.sp-header-right`, before the notification popover, add:

```vue
<el-button class="sp-header-search" @click="router.push('/bids')">
  <el-icon><Search /></el-icon>
  <span>查找招标机会</span>
</el-button>
```

- [ ] **Step 6: Append layout scoped CSS**

At the end of `MainLayout.vue`, if there is an existing `<style scoped>` section, append this CSS inside it. If there is no style section, create one:

```css
.sp-layout {
  min-height: 100vh;
  background: transparent;
}

.sp-sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at 24% 10%, rgba(6, 168, 201, 0.28), transparent 28%),
    linear-gradient(180deg, #042a58 0%, #063d7a 48%, #032342 100%);
  box-shadow: 14px 0 40px rgba(4, 42, 88, 0.16);
  transition: width var(--sp-duration-normal) var(--sp-ease);
}

.sp-sidebar-logo {
  height: 76px;
  padding: 16px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.10);
}

.sp-logo-img {
  width: 38px;
  height: 38px;
  object-fit: cover;
  border-radius: 10px;
  background: #fff;
}

.sp-logo-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.sp-logo-title {
  color: #fff;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.sp-logo-sub {
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 12px;
}

.sp-sidebar-menu {
  border-right: none !important;
  padding: 14px 10px 24px;
}

.sp-menu-section {
  margin: 16px 10px 8px;
  color: rgba(255, 255, 255, 0.38);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
}

.sp-menu-section-dot {
  height: 14px;
}

.sp-menu-item {
  height: 44px !important;
  margin: 4px 0;
  border-radius: 12px !important;
}

.sp-menu-item.is-active {
  background: rgba(255, 255, 255, 0.16) !important;
  box-shadow: inset 3px 0 0 #31d0ff;
}

.sp-menu-badge {
  margin-left: 8px;
}

.sp-main {
  min-width: 0;
}

.sp-header {
  position: sticky;
  z-index: 10;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.86);
  border-bottom: 1px solid rgba(219, 231, 243, 0.9);
  backdrop-filter: blur(16px);
}

.sp-header-left,
.sp-header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.sp-collapse-btn,
.sp-header-icon {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: var(--sp-gray-600);
  cursor: pointer;
  transition: all var(--sp-duration-fast) var(--sp-ease);
}

.sp-collapse-btn:hover,
.sp-header-icon:hover {
  color: var(--sp-primary);
  background: var(--sp-primary-lighter);
}

.sp-header-kicker {
  color: var(--sp-primary);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.14em;
}

.sp-header-title {
  color: var(--sp-gray-900);
  font-size: 17px;
  font-weight: 900;
}

.sp-header-search {
  border-radius: var(--sp-radius-full) !important;
  font-weight: 800;
}

.sp-user-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 5px 5px;
  border-radius: var(--sp-radius-full);
  cursor: pointer;
  transition: background var(--sp-duration-fast) var(--sp-ease);
}

.sp-user-bar:hover {
  background: var(--sp-gray-100);
}

.sp-user-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--sp-gray-700);
  font-weight: 800;
}

.sp-content {
  padding: 0;
}

.sp-notif-popover {
  max-height: 420px;
  overflow: auto;
}

.sp-notif-header,
.sp-notif-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sp-notif-title {
  font-weight: 900;
  color: var(--sp-gray-900);
}

.sp-notif-empty {
  padding: 30px;
  text-align: center;
  color: var(--sp-gray-400);
}

.sp-notif-item {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--sp-border-light);
  cursor: pointer;
}

.sp-notif-dot {
  width: 8px;
  height: 8px;
  margin-top: 8px;
  border-radius: 50%;
  background: var(--sp-red);
  flex-shrink: 0;
}

.sp-notif-content { min-width: 0; }
.sp-notif-item-title { font-weight: 800; color: var(--sp-gray-900); }
.sp-notif-item-desc { color: var(--sp-gray-500); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-notif-item-time { color: var(--sp-gray-400); font-size: 11px; margin-top: 2px; }
.sp-notif-footer { justify-content: center; padding-top: 12px; color: var(--sp-primary); font-weight: 800; cursor: pointer; }

@media (max-width: 768px) {
  .sp-sidebar { display: none; }
  .sp-header-search span,
  .sp-user-name,
  .sp-header-kicker { display: none; }
  .sp-header { padding: 0 12px !important; }
}
```

- [ ] **Step 7: Run supplier portal build**

```bash
cd /Users/qihao/Desktop/ERP/water-erp
pnpm --filter supplier-portal build
```

Expected: build completes. Fix missing imports or duplicate style errors before continuing.

- [ ] **Step 8: Commit shell upgrade**

```bash
git add water-erp/apps/supplier-portal/src/layouts/MainLayout.vue
git commit -m "feat: upgrade supplier portal shell navigation"
```

## Task 3: Dashboard Business Cockpit

**Files:**
- Modify: `water-erp/apps/supplier-portal/src/views/dashboard/Dashboard.vue`

- [ ] **Step 1: Add computed task list and primary project helpers**

In the `<script setup>` section, after `const quickActions = computed(() => { ... })`, add:

```ts
const activeProjects = computed(() => bidStore.projects.filter((p: any) => ['DOWNLOAD', 'SUBMIT', 'OPENING'].includes(p.stage)))
const urgentSubmitProjects = computed(() => bidStore.projects.filter((p: any) => p.stage === 'SUBMIT').slice(0, 3))

const todayTasks = computed(() => {
  const s = stats.value
  const status = statusInfo.value
  if (!s || !status) return []

  const tasks = []

  if (status.status === 'RETURNED') {
    tasks.push({
      icon: 'EditPen',
      title: '处理入驻补正',
      desc: status.returnReason || '企业入驻资料被退回，请按审核意见补正',
      path: '/onboarding',
      tone: 'orange',
    })
  }

  if ((s.profileCompleteness?.score || 0) < 100) {
    tasks.push({
      icon: 'OfficeBuilding',
      title: '完善企业档案',
      desc: `当前完整度 ${s.profileCompleteness?.score || 0}%，补齐资料可提升投标效率`,
      path: '/profile',
      tone: 'blue',
    })
  }

  if (s.expiringQualifications > 0) {
    tasks.push({
      icon: 'WarningFilled',
      title: '更新即将到期资质',
      desc: `${s.expiringQualifications} 项资质临近有效期，请及时维护`,
      path: '/qualifications',
      tone: 'orange',
    })
  }

  if (urgentSubmitProjects.value.length > 0) {
    tasks.push({
      icon: 'DocumentChecked',
      title: '处理可投递项目',
      desc: `${urgentSubmitProjects.value.length} 个项目处于加密投递阶段`,
      path: '/bids',
      tone: 'green',
    })
  }

  if (s.unreadNotifications > 0) {
    tasks.push({
      icon: 'ChatDotRound',
      title: '查看未读消息',
      desc: `${s.unreadNotifications} 条平台消息待处理`,
      path: '/notifications',
      tone: 'red',
    })
  }

  if (tasks.length === 0) {
    tasks.push({
      icon: 'CircleCheckFilled',
      title: '当前暂无紧急待办',
      desc: '可继续浏览招标机会或维护企业资质信息',
      path: '/bids',
      tone: 'green',
    })
  }

  return tasks.slice(0, 5)
})

function taskToneStyle(tone: string) {
  const map: Record<string, { bg: string; color: string }> = {
    blue: { bg: 'var(--sp-primary-lighter)', color: 'var(--sp-primary)' },
    green: { bg: 'var(--sp-green-light)', color: 'var(--sp-green)' },
    orange: { bg: 'var(--sp-orange-light)', color: 'var(--sp-orange)' },
    red: { bg: 'var(--sp-red-light)', color: 'var(--sp-red)' },
  }
  return map[tone] || map.blue
}
```

- [ ] **Step 2: Replace the first welcome banner row in the template**

Replace the row containing the comment `<!-- Welcome banner + Profile completeness -->` through its closing `</el-row>` with:

```vue
<el-row :gutter="20">
  <el-col :xs="24" :lg="16">
    <div class="sp-page-hero" v-if="statusInfo">
      <div class="sp-hero-kicker">蜀水云采 · 供应商业务驾驶舱</div>
      <h1 class="sp-hero-title">
        {{ new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好' }}，{{ authStore.displayName || statusInfo.name }}
      </h1>
      <p class="sp-hero-desc">
        当前入驻状态为
        <strong>{{ statusLabel[statusInfo.status] || statusInfo.status }}</strong>
        <template v-if="statusInfo.status === 'RETURNED' && statusInfo.returnReason">
          ，请优先处理补正：{{ statusInfo.returnReason }}
        </template>
        <template v-else>
          。你可以在这里跟踪招标机会、投标进展、资质风险与平台消息。
        </template>
      </p>
      <div class="sp-hero-actions">
        <el-button type="primary" color="#ffffff" plain @click="router.push('/bids')">查看招标机会</el-button>
        <el-button color="#ffffff" plain @click="router.push('/my-bids')">跟踪投标进展</el-button>
        <el-button color="#ffffff" plain @click="router.push('/qualifications')">维护资质证照</el-button>
      </div>
    </div>
  </el-col>

  <el-col :xs="24" :lg="8">
    <div class="sp-card completeness-wrapper">
      <ProfileCompleteness :score="completeness.score" :missing="completeness.missing" />
    </div>
  </el-col>
</el-row>
```

- [ ] **Step 3: Insert today tasks section after hero row**

Immediately after the hero row from Step 2, add:

```vue
<el-row :gutter="20" style="margin-top: 20px;">
  <el-col :xs="24" :lg="10">
    <div class="sp-card">
      <div class="sp-section-card-header">
        <div>
          <div class="sp-section-card-title"><el-icon><Notification /></el-icon> 今日待办</div>
          <div class="sp-section-card-subtitle">按紧急程度整理你下一步应该处理的事项</div>
        </div>
      </div>
      <div class="sp-task-list">
        <div v-for="task in todayTasks" :key="task.title" class="sp-task-item" @click="router.push(task.path)">
          <div class="sp-task-icon" :style="taskToneStyle(task.tone)">
            <el-icon><component :is="task.icon" /></el-icon>
          </div>
          <div>
            <div class="sp-task-title">{{ task.title }}</div>
            <div class="sp-task-desc">{{ task.desc }}</div>
          </div>
        </div>
      </div>
    </div>
  </el-col>

  <el-col :xs="24" :lg="14">
    <div class="sp-card">
      <div class="sp-section-card-header">
        <div>
          <div class="sp-section-card-title"><el-icon><Document /></el-icon> 重点投标机会</div>
          <div class="sp-section-card-subtitle">优先展示下载、投递、开标阶段项目</div>
        </div>
        <el-button link type="primary" @click="router.push('/bids')">查看全部</el-button>
      </div>
      <div v-if="activeProjects.length === 0" class="sp-empty" style="padding: 28px;">
        <div class="sp-empty-icon">📋</div>
        <div class="sp-empty-text">暂无进行中的招标机会</div>
        <div class="sp-empty-desc">可稍后关注平台公告或招标机会列表</div>
      </div>
      <div v-else class="dashboard-opportunity-list">
        <div v-for="p in activeProjects.slice(0, 3)" :key="p.id" class="sp-opportunity-card" @click="router.push(`/bids/${p.id}`)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <span class="sp-status" :style="{ background: (stageMap[p.stage]?.color || '#94a3b8') + '18', color: stageMap[p.stage]?.color || '#94a3b8' }">
              {{ stageMap[p.stage]?.label || p.stage }}
            </span>
            <span class="sp-deadline-pill"><el-icon><Clock /></el-icon>{{ dayjs(p.deadline).format('MM-DD HH:mm') }} 截止</span>
          </div>
          <div class="sp-opportunity-title">{{ p.name }}</div>
          <div class="sp-opportunity-meta">
            <div class="sp-meta-line"><el-icon><Document /></el-icon>{{ p.projectCode }}</div>
            <div class="sp-meta-line"><el-icon><Calendar /></el-icon>开标：{{ dayjs(p.openTime).format('YYYY-MM-DD HH:mm') }}</div>
          </div>
        </div>
      </div>
    </div>
  </el-col>
</el-row>
```

- [ ] **Step 4: Change stats grid labels**

In the existing stats array, replace labels as follows:

```ts
{ icon: 'Medal', label: '履约评价', value: stats.evaluationCount, color: 'blue', path: '/evaluations' },
{ icon: 'DocumentChecked', label: '投标记录', value: stats.submissionCount, color: 'green', path: '/my-bids' },
{ icon: 'Folder', label: '资质证照', value: stats.qualificationCount, color: 'orange', path: '/qualifications' },
{ icon: 'EditPen', label: '待审变更', value: stats.pendingChanges, color: 'cyan', path: '/change-records' },
{ icon: 'ChatDotRound', label: '未读消息', value: stats.unreadNotifications, color: 'red', path: '/notifications' },
{ icon: 'WarningFilled', label: '到期风险', value: stats.expiringQualifications, color: 'orange', path: '/qualifications' },
```

- [ ] **Step 5: Append dashboard scoped CSS**

At the end of the component style section, append:

```css
.dashboard-opportunity-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 1200px) {
  .dashboard-opportunity-list { grid-template-columns: 1fr; }
}
```

- [ ] **Step 6: Run supplier portal build**

```bash
cd /Users/qihao/Desktop/ERP/water-erp
pnpm --filter supplier-portal build
```

Expected: build completes. If Element Plus icons such as `CircleCheckFilled`, `Notification`, `Clock`, or `Calendar` are unresolved in template compilation, import them in the component or use string component names consistently with the existing setup.

- [ ] **Step 7: Commit dashboard cockpit**

```bash
git add water-erp/apps/supplier-portal/src/views/dashboard/Dashboard.vue
git commit -m "feat: upgrade supplier dashboard cockpit"
```

## Task 4: Tender Opportunity List Upgrade

**Files:**
- Modify: `water-erp/apps/supplier-portal/src/views/bid/BidList.vue`

- [ ] **Step 1: Add stage count helper**

After `const filteredProjects = computed(() => { ... })`, add:

```ts
function stageCount(stage: string) {
  if (!stage) return bidStore.projects.length
  return bidStore.projects.filter((p: any) => p.stage === stage).length
}
```

- [ ] **Step 2: Replace page header template**

Replace the existing `.page-header` block with:

```vue
<div class="sp-page-title-row">
  <div>
    <div class="sp-page-eyebrow">Tender Opportunities</div>
    <h1 class="sp-modern-title">招标机会</h1>
    <p class="sp-modern-desc">聚合当前可参与项目，重点关注文件下载、加密投递和开标时间节点。</p>
  </div>
  <el-button type="primary" @click="router.push('/my-bids')">
    <el-icon><DocumentChecked /></el-icon>查看投标进展
  </el-button>
</div>
```

- [ ] **Step 3: Replace filter card template**

Replace the existing filter card with:

```vue
<div class="sp-filter-panel">
  <el-row :gutter="16" align="middle">
    <el-col :xs="24" :sm="12" :md="8">
      <el-input v-model="search" placeholder="搜索项目名称或编号" prefix-icon="Search" clearable size="large" />
    </el-col>
    <el-col :xs="24" :sm="12" :md="16">
      <div class="sp-chip-group">
        <el-button
          v-for="f in stageFilters"
          :key="f.value"
          :type="filterStage === f.value ? 'primary' : 'default'"
          class="sp-chip"
          @click="filterStage = f.value"
        >
          {{ f.label }} · {{ stageCount(f.value) }}
        </el-button>
      </div>
    </el-col>
  </el-row>
</div>
```

- [ ] **Step 4: Update project card root class and body classes**

In the project list, change the card root from:

```vue
<div v-for="p in filteredProjects" :key="p.id" class="sp-card project-card" @click="router.push(`/bids/${p.id}`)">
```

to:

```vue
<div v-for="p in filteredProjects" :key="p.id" class="sp-opportunity-card project-card" @click="router.push(`/bids/${p.id}`)">
```

Change `<h3 class="project-name">{{ p.name }}</h3>` to:

```vue
<h3 class="sp-opportunity-title">{{ p.name }}</h3>
```

Change `<div class="project-meta">` to:

```vue
<div class="sp-opportunity-meta">
```

Change every `class="meta-item"` inside the card to `class="sp-meta-line"`.

- [ ] **Step 5: Replace the project footer countdown block**

Replace the contents of `.project-footer` with:

```vue
<div class="sp-deadline-pill">
  <el-icon><Clock /></el-icon>
  <span>{{ isDeadlinePassed(p.deadline) ? '已截止' : `剩余 ${getCountdown(p.deadline)}` }}</span>
</div>
<el-button type="primary" size="small">
  查看详情 <el-icon><ArrowRight /></el-icon>
</el-button>
```

- [ ] **Step 6: Simplify scoped CSS**

Remove old styles for `.project-card:hover`, `.project-name`, `.project-meta`, `.meta-item`, and `.countdown` because global utility classes now own them. Keep `.project-grid`, `.project-card-top`, `.project-code`, and `.project-footer`. Ensure `.project-grid` is:

```css
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
}
```

- [ ] **Step 7: Run supplier portal build**

```bash
cd /Users/qihao/Desktop/ERP/water-erp
pnpm --filter supplier-portal build
```

Expected: build completes.

- [ ] **Step 8: Commit tender list**

```bash
git add water-erp/apps/supplier-portal/src/views/bid/BidList.vue
git commit -m "feat: upgrade tender opportunity list"
```

## Task 5: Bid Progress Page Upgrade

**Files:**
- Modify: `water-erp/apps/supplier-portal/src/views/bid/MyBids.vue`

- [ ] **Step 1: Change import line**

Replace:

```ts
import { ref, onMounted } from 'vue'
```

with:

```ts
import { ref, onMounted, computed } from 'vue'
```

- [ ] **Step 2: Add summary computed values**

After `const loading = ref(true)`, add:

```ts
const summary = computed(() => {
  const list = supplierStore.bidSubmissions
  return {
    total: list.length,
    draft: list.filter((item: any) => item.status === 'draft').length,
    submitted: list.filter((item: any) => item.status === 'submitted').length,
    withdrawn: list.filter((item: any) => item.status === 'withdrawn').length,
  }
})
```

- [ ] **Step 3: Replace the page header**

Replace the `sp-section-header` block at the top of the template with:

```vue
<div class="sp-page-title-row">
  <div>
    <div class="sp-page-eyebrow">Bid Progress</div>
    <h1 class="sp-modern-title">投标进展</h1>
    <p class="sp-modern-desc">集中跟踪标书草稿、已提交记录、撤回状态和项目截止时间。</p>
  </div>
  <el-button type="primary" @click="router.push('/bids')">
    <el-icon><Plus /></el-icon>浏览招标机会
  </el-button>
</div>
```

- [ ] **Step 4: Insert summary cards after the page header**

Add:

```vue
<div class="sp-metric-grid" style="margin-bottom: 18px;">
  <div class="sp-stat">
    <div class="sp-stat-icon blue"><el-icon><Document /></el-icon></div>
    <div class="sp-stat-content"><div class="sp-stat-value">{{ summary.total }}</div><div class="sp-stat-label">全部记录</div></div>
  </div>
  <div class="sp-stat">
    <div class="sp-stat-icon orange"><el-icon><EditPen /></el-icon></div>
    <div class="sp-stat-content"><div class="sp-stat-value">{{ summary.draft }}</div><div class="sp-stat-label">草稿待提交</div></div>
  </div>
  <div class="sp-stat">
    <div class="sp-stat-icon green"><el-icon><DocumentChecked /></el-icon></div>
    <div class="sp-stat-content"><div class="sp-stat-value">{{ summary.submitted }}</div><div class="sp-stat-label">已提交</div></div>
  </div>
  <div class="sp-stat">
    <div class="sp-stat-icon red"><el-icon><RefreshLeft /></el-icon></div>
    <div class="sp-stat-content"><div class="sp-stat-value">{{ summary.withdrawn }}</div><div class="sp-stat-label">已撤回</div></div>
  </div>
</div>
```

- [ ] **Step 5: Replace the table card with card layout**

Replace the entire `<div class="sp-card" v-if="supplierStore.bidSubmissions.length > 0"> ... </div>` table block with:

```vue
<div v-if="supplierStore.bidSubmissions.length > 0" class="bid-progress-grid">
  <div v-for="row in supplierStore.bidSubmissions" :key="row.id" class="sp-business-card bid-progress-card">
    <div class="bid-progress-top">
      <span class="sp-status" :class="statusMap[row.status]?.class || 'draft'">
        {{ statusMap[row.status]?.label || row.status }}
      </span>
      <span class="bid-progress-code">{{ row.project?.projectCode || '-' }}</span>
    </div>
    <h3 class="bid-progress-title">{{ row.project?.name || '-' }}</h3>
    <div class="bid-progress-meta">
      <div><span>投标报价</span><strong>{{ row.bidPrice || '-' }}</strong></div>
      <div><span>交货/工期</span><strong>{{ row.deliveryPeriod || '-' }}</strong></div>
      <div><span>提交时间</span><strong>{{ row.submittedAt ? dayjs(row.submittedAt).format('YYYY-MM-DD HH:mm') : '-' }}</strong></div>
      <div><span>截止时间</span><strong>{{ row.project?.deadline ? dayjs(row.project.deadline).format('YYYY-MM-DD HH:mm') : '-' }}</strong></div>
    </div>
    <div class="bid-progress-actions">
      <el-button type="primary" @click="router.push(`/bids/${row.projectId}`)">查看项目</el-button>
      <el-button v-if="row.status === 'submitted'" type="warning" plain @click="handleWithdraw(row.id)">撤回标书</el-button>
    </div>
  </div>
</div>
```

- [ ] **Step 6: Append scoped CSS for bid progress cards**

At the bottom of `MyBids.vue`, add:

```vue
<style scoped>
.bid-progress-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
}

.bid-progress-card {
  padding: 18px;
}

.bid-progress-top,
.bid-progress-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.bid-progress-code {
  color: var(--sp-gray-400);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.bid-progress-title {
  margin: 14px 0;
  color: var(--sp-gray-900);
  font-size: 17px;
  font-weight: 900;
  line-height: 1.4;
}

.bid-progress-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.bid-progress-meta div {
  padding: 10px;
  border-radius: 12px;
  background: var(--sp-gray-50);
}

.bid-progress-meta span {
  display: block;
  color: var(--sp-gray-400);
  font-size: 12px;
}

.bid-progress-meta strong {
  display: block;
  margin-top: 3px;
  color: var(--sp-gray-900);
  font-size: 13px;
}

@media (max-width: 768px) {
  .bid-progress-grid { grid-template-columns: 1fr; }
  .bid-progress-meta { grid-template-columns: 1fr; }
  .bid-progress-actions { align-items: stretch; flex-direction: column; }
  .bid-progress-actions .el-button { width: 100%; }
}
</style>
```

- [ ] **Step 7: Run supplier portal build**

```bash
cd /Users/qihao/Desktop/ERP/water-erp
pnpm --filter supplier-portal build
```

Expected: build completes. If icon components are unresolved, import them from `@element-plus/icons-vue` or replace with globally registered icon string usage consistent with the project.

- [ ] **Step 8: Commit bid progress page**

```bash
git add water-erp/apps/supplier-portal/src/views/bid/MyBids.vue
git commit -m "feat: upgrade supplier bid progress page"
```

## Task 6: Announcement List Upgrade

**Files:**
- Modify: `water-erp/apps/supplier-portal/src/views/announcement/AnnouncementList.vue`

- [ ] **Step 1: Replace page header**

Replace the current `.page-header` block with:

```vue
<div class="sp-page-title-row">
  <div>
    <div class="sp-page-eyebrow">Public Notices</div>
    <h1 class="sp-modern-title">公告公示</h1>
    <p class="sp-modern-desc">集中查看招标公告、中标公示、政策法规和平台通知。</p>
  </div>
</div>
```

- [ ] **Step 2: Replace filter card**

Replace the existing filter card with:

```vue
<div class="sp-filter-panel">
  <el-row :gutter="16" align="middle">
    <el-col :xs="24" :sm="12" :md="8">
      <el-input v-model="search" placeholder="搜索公告标题" prefix-icon="Search" clearable size="large" @keyup.enter="handleSearch" @clear="handleSearch" />
    </el-col>
    <el-col :xs="24" :sm="12" :md="16">
      <div class="sp-chip-group">
        <el-button
          v-for="t in typeOptions"
          :key="t.value"
          :type="activeType === t.value ? 'primary' : 'default'"
          class="sp-chip"
          @click="activeType = t.value; handleSearch()"
        >
          {{ t.label }}
        </el-button>
      </div>
    </el-col>
  </el-row>
</div>
```

- [ ] **Step 3: Upgrade announcement row right-side label**

Inside `.announcement-row-right`, change the date line to:

```vue
<span class="announcement-row-date">{{ dayjs(a.publishDate || a.createdAt).format('YYYY-MM-DD') }}</span>
<el-button link type="primary">查看详情</el-button>
<el-icon style="color: var(--sp-gray-300);"><ArrowRight /></el-icon>
```

- [ ] **Step 4: Update scoped hover styling**

Replace:

```css
.announcement-row:hover { background: var(--sp-gray-50); margin: 0 -24px; padding: 16px 24px; border-radius: 8px; }
```

with:

```css
.announcement-row:hover {
  background: var(--sp-primary-lighter);
  margin: 0 -18px;
  padding: 16px 18px;
  border-radius: var(--sp-radius-md);
}
```

- [ ] **Step 5: Run supplier portal build**

```bash
cd /Users/qihao/Desktop/ERP/water-erp
pnpm --filter supplier-portal build
```

Expected: build completes.

- [ ] **Step 6: Commit announcement page**

```bash
git add water-erp/apps/supplier-portal/src/views/announcement/AnnouncementList.vue
git commit -m "feat: upgrade supplier announcement list"
```

## Task 7: Login Page Brand Upgrade

**Files:**
- Modify: `water-erp/apps/supplier-portal/src/views/auth/Login.vue`

- [ ] **Step 1: Update brand feature copy**

In the login template, replace the three `.sp-login-feature` blocks with:

```vue
<div class="sp-login-feature">
  <span class="sp-login-dot" />
  <div>
    <span class="sp-login-feature-label">招标机会实时触达</span>
    <span class="sp-login-feature-desc">聚合公告、文件下载、投递截止与开标节点</span>
  </div>
</div>
<div class="sp-login-feature">
  <span class="sp-login-dot" />
  <div>
    <span class="sp-login-feature-label">企业档案在线维护</span>
    <span class="sp-login-feature-desc">入驻审核、资质证照、资料变更全流程可追踪</span>
  </div>
</div>
<div class="sp-login-feature">
  <span class="sp-login-dot" />
  <div>
    <span class="sp-login-feature-label">投标进展透明协同</span>
    <span class="sp-login-feature-desc">标书提交、撤回、消息通知和履约评价集中管理</span>
  </div>
</div>
```

- [ ] **Step 2: Change login background CSS**

Replace `.sp-login { ... }` with:

```css
.sp-login {
  min-height: 100vh;
  display: flex;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 18% 18%, rgba(49, 208, 255, 0.24), transparent 26%),
    radial-gradient(circle at 82% 12%, rgba(5, 150, 105, 0.18), transparent 24%),
    linear-gradient(135deg, #031f3d 0%, #042a58 44%, #0756a5 100%);
}
```

- [ ] **Step 3: Upgrade login form wrapper CSS**

Find `.sp-login-form-wrapper` and ensure it includes:

```css
.sp-login-form-wrapper {
  width: min(420px, calc(100vw - 32px));
  padding: 42px;
  border: 1px solid rgba(219, 231, 243, 0.78);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 30px 90px rgba(4, 42, 88, 0.28);
  backdrop-filter: blur(18px);
}
```

If `.sp-login-form-wrapper` already has some of these properties, replace the entire block to avoid duplicate declarations.

- [ ] **Step 4: Upgrade test account hint**

Replace the `.sp-form-test` content with:

```vue
<div class="sp-form-test">
  <strong>演示账号</strong>
  <span>supplier1 / 123456</span>
</div>
```

Then ensure `.sp-form-test` CSS is:

```css
.sp-form-test {
  margin-top: 18px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 14px;
  color: var(--sp-primary-dark);
  background: var(--sp-primary-lighter);
  font-size: 12px;
}
```

- [ ] **Step 5: Run supplier portal build**

```bash
cd /Users/qihao/Desktop/ERP/water-erp
pnpm --filter supplier-portal build
```

Expected: build completes.

- [ ] **Step 6: Commit login page**

```bash
git add water-erp/apps/supplier-portal/src/views/auth/Login.vue
git commit -m "feat: upgrade supplier portal login branding"
```

## Task 8: Run and Browser Verification

**Files:**
- No code changes expected unless verification reveals defects.

- [ ] **Step 1: Build supplier portal**

```bash
cd /Users/qihao/Desktop/ERP/water-erp
pnpm --filter supplier-portal build
```

Expected: build completes with Vite output and no TypeScript/template errors.

- [ ] **Step 2: Confirm 3003 responds**

```bash
curl -I http://localhost:3003/
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 3: Open browser and inspect key pages**

Visit:

- `http://localhost:3003/login`
- Log in with `supplier1 / 123456`
- `http://localhost:3003/dashboard`
- `http://localhost:3003/bids`
- `http://localhost:3003/my-bids`
- `http://localhost:3003/announcements`

Expected:

- Login page uses the upgraded water-brand split layout.
- Shell shows `蜀水云采` and grouped business navigation.
- Dashboard shows hero, today tasks, metrics, opportunities, announcements, and messages.
- Tender opportunity page shows upgraded title, filter panel, stage chips, and opportunity cards.
- Bid progress page shows summary cards and bid cards.
- Announcement page shows upgraded title, filter panel, and clearer list rows.

- [ ] **Step 4: Check browser errors**

Use browser tooling to check console and network errors.

Expected: no new runtime errors caused by the upgrade. Existing API failures should be reported separately if the API is not running.

- [ ] **Step 5: Check responsive layout**

Set browser width to approximately 390px and inspect `/login`, `/dashboard`, `/bids`, and `/my-bids`.

Expected:

- Login stacks cleanly.
- Sidebar is hidden and header remains usable.
- Cards become single-column.
- Buttons do not overflow their cards.

- [ ] **Step 6: Commit verification fixes if any**

If verification required code fixes:

```bash
git add water-erp/apps/supplier-portal/src
git commit -m "fix: polish supplier portal upgrade verification issues"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers the approved design's global design language, shell/navigation, dashboard cockpit, tender opportunities, bid progress, announcements, login branding, and verification. Deep detail/submit/profile pages remain explicitly out of the first implementation pass, matching the design's prioritized/continued scope.
- Placeholder scan: No TBD/TODO placeholders are present. Each implementation task includes exact files, code blocks, commands, and expected outcomes.
- Type consistency: Existing store names and data properties are preserved (`bidStore.projects`, `supplierStore.bidSubmissions`, `stats.profileCompleteness`, `statusInfo.status`). New helpers are local computed values and do not alter shared API contracts.
