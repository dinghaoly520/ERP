# Supplier Portal Navigation Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated 3004 toolbar/navigation and oversized empty-page composition with eight task-oriented workspaces and compact, accessible page primitives.

**Architecture:** Keep every existing route and API contract. Centralize route ownership in `supplier-menu.ts`, let `AppShell` render one primary navigation plus a contextual route bar, and use local line tabs to isolate platform records from supplier-owned archives. Shared heading and empty-state primitives enforce the dense visual rule across pages.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Lucide, Node test runner through `tsx --test`, CSS.

**Workspace note:** The current `codex/supplier-portal-hardening` branch contains required uncommitted work from the preceding task. Preserve it, do not reset it, and do not create commits that could accidentally include unrelated user changes.

---

### Task 1: Centralize the eight-workspace navigation model

**Files:**
- Modify: `apps/supplier-portal-next/src/components/shell/supplier-menu.ts`
- Create: `apps/supplier-portal-next/src/lib/__tests__/supplier-navigation.test.ts`
- Modify: `apps/supplier-portal-next/src/lib/__tests__/award-letter.test.ts`

- [x] **Step 1: Write the failing navigation contract tests**

Test that regular suppliers receive the exact labels `工作台、项目机会、我的投标、成交履约、供货管理、企业资料、公告中心、异议投诉`, temporary suppliers omit supply/profile workspaces, `/notifications` is absent, and every legacy route resolves to the intended workspace and sub-navigation item.

- [x] **Step 2: Run the focused test and confirm the expected failure**

Run: `pnpm --filter supplier-portal-next exec tsx --test src/lib/__tests__/supplier-navigation.test.ts src/lib/__tests__/award-letter.test.ts`

Expected: FAIL because the current menu still exposes 17 flat entries and has no workspace resolver.

- [x] **Step 3: Implement the minimal workspace model**

Add a `WorkspaceTab` type, optional `tabs` to `MenuEntry`, and pure helpers that perform longest-prefix route matching. Define the exact route groupings from the approved design. Keep the existing `buildMenuItems(isTemporary)` entry point so current consumers remain compatible.

- [x] **Step 4: Run the focused tests**

Run the command from Step 2. Expected: all selected tests PASS.

### Task 2: Remove duplicated toolbar actions and add contextual navigation

**Files:**
- Create: `apps/supplier-portal-next/src/components/shell/supplier-context-nav.tsx`
- Modify: `apps/supplier-portal-next/src/components/shell/app-shell.tsx`
- Modify: `apps/supplier-portal-next/src/components/__tests__/app-shell-accessibility.test.tsx`
- Modify: `apps/supplier-portal-next/src/app/globals.css`

- [x] **Step 1: Write failing shell tests**

Assert that the shell renders `SupplierContextNav`, does not render a standalone `sp-logout-btn`, does not route the account menu to `/profile`, renders logout inside `sp-user-menu`, and does not render menu description text. Assert that contextual navigation uses native links, `aria-current`, and a labelled navigation region.

- [x] **Step 2: Run the shell tests and confirm the expected failure**

Run: `pnpm --filter supplier-portal-next exec tsx --test src/components/__tests__/app-shell-accessibility.test.tsx src/lib/__tests__/supplier-navigation.test.ts`

Expected: FAIL on the duplicate top-bar/sidebar behavior.

- [x] **Step 3: Implement the toolbar and context bar**

Render only the notification bell and company account in the header. Move logout into the account menu, remove its profile shortcut, render only primary labels in the sidebar, add collapsed `title` hints, and insert `SupplierContextNav` before page content. Style the context bar as a flat hairline navigation with horizontal overflow at narrow widths.

- [x] **Step 4: Run the focused tests**

Run the command from Step 2. Expected: all selected tests PASS.

### Task 3: Replace hero cards and oversized empty states with dense primitives

**Files:**
- Modify: `apps/supplier-portal-next/src/components/sp-page-hero.tsx`
- Modify: `apps/supplier-portal-next/src/components/ui.tsx`
- Modify: `apps/supplier-portal-next/src/components/__tests__/accessibility-markup.test.tsx`
- Modify: `apps/supplier-portal-next/src/app/globals.css`

- [x] **Step 1: Write failing primitive tests**

Render `SpPageHero` and assert it uses `workspace-heading` rather than the legacy `page-hero` card. Render `EmptyState` and assert a compact copy wrapper, status semantics, and a separate optional action region. Add source-level CSS assertions for flat backgrounds, hairline separation, compact padding and responsive wrapping.

- [x] **Step 2: Run the primitive tests and confirm the expected failure**

Run: `pnpm --filter supplier-portal-next exec tsx --test src/components/__tests__/accessibility-markup.test.tsx`

Expected: FAIL because current primitives still emit the large card/centered empty-state structure.

- [x] **Step 3: Implement the compact primitives**

Change the heading markup to a semantic `header` with a compact main/aside structure. Preserve heading levels, optional actions and statistics children. Change empty-state markup to a compact icon/copy/action row and add responsive CSS without gradients, glow pseudo-elements, large radii or elevation shadows.

- [x] **Step 4: Run the primitive tests**

Run the command from Step 2. Expected: all selected tests PASS.

### Task 4: Merge platform records and supplier-owned archives through local tabs

**Files:**
- Modify: `apps/supplier-portal-next/src/app/(main)/contracts/page.tsx`
- Modify: `apps/supplier-portal-next/src/app/(main)/frameworks/page.tsx`
- Modify: `apps/supplier-portal-next/src/components/own-archives-panel.tsx`
- Modify: `apps/supplier-portal-next/src/components/ui.tsx`
- Modify: `apps/supplier-portal-next/src/styles/pages/objections.css`
- Modify: `apps/supplier-portal-next/src/lib/__tests__/contract-forms.test.ts`
- Create: `apps/supplier-portal-next/src/lib/__tests__/dense-workspace-layout.test.ts`

- [x] **Step 1: Write failing page-composition tests**

Assert that both pages define a two-value view state, render accessible line-style tabs, and render `OwnArchivesPanel` only in the archive branch. Assert that `OwnArchivesPanel` uses the shared compact empty state and supports an embedded flat mode. Keep existing contract-status and proof behavior assertions.

- [x] **Step 2: Run the focused tests and confirm the expected failure**

Run: `pnpm --filter supplier-portal-next exec tsx --test src/lib/__tests__/contract-forms.test.ts src/lib/__tests__/dense-workspace-layout.test.ts src/components/__tests__/accessibility-markup.test.tsx`

Expected: FAIL because both data domains are currently rendered simultaneously.

- [x] **Step 3: Implement the local views**

Use `SpTabs` with a new `line` variant. Contract labels are `平台合同 / 企业自存档案`; framework labels are `入围协议 / 企业自存档案`. Refactor early error returns so the archive view remains reachable when the platform list fails. Render `OwnArchivesPanel` in embedded mode and keep upload/edit/delete/file behavior intact.

- [x] **Step 4: Run the focused tests**

Run the command from Step 2. Expected: all selected tests PASS.

### Task 5: Full verification and visual acceptance

**Files:**
- Verify all files above; no new production behavior.

- [x] **Step 1: Run the complete supplier portal suite**

Run: `pnpm --filter supplier-portal-next test`

Expected: all tests PASS with zero failures.

- [x] **Step 2: Run static verification**

Run: `pnpm --filter supplier-portal-next exec tsc --noEmit`

Run: `pnpm --filter supplier-portal-next build`

Expected: both commands exit 0.

- [x] **Step 3: Inspect the running portal**

Verify `/dashboard`, `/contracts`, `/frameworks`, `/profile/ukey` and `/notifications` at 390×844, 768×1024 and 1280×900. Confirm one H1, no document-level horizontal overflow, all legacy subroutes reachable, only one compact empty state per contract/framework view, and no standalone logout or duplicate message sidebar item.

- [x] **Step 4: Check diff integrity**

Run: `git diff --check`.

Expected: exit 0 with no whitespace errors.
