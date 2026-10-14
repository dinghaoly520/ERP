# :3011 屏幕尺寸适配实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 四项屏幕适配——iOS 聚焦缩放修复、平板舒适宽度、横屏刘海安全区、小屏网格降级。

**Architecture:** 纯 CSS/类名级修改（globals.css + layout.tsx + 三页输入/网格类），零依赖零后端。

**Tech Stack:** Tailwind v4 arbitrary values + `@layer components` 内 `.m-input/.m-tabbar/.m-sheet-panel`。

**Spec:** `docs/superpowers/specs/2026-10-14-mobile-viewport-adaptation-design.md`

## Global Constraints

- `.m-input` 基础字号 **16px**，实例上不得再有 `<16px` 字号覆写
- 内容容器 `mx-auto w-full max-w-lg`；顶栏/Tab 栏保持全宽
- 安全区用 `env(safe-area-inset-left/right)` 且与既有 padding 取大者
- 提交只 add `water-erp/apps/mobile-portal` + 本计划文件

---

### Task 1: 四项适配（单任务交付）

**Files:**
- Modify: `apps/mobile-portal/src/app/globals.css`（m-input 字号 / m-tabbar·m-sheet-panel 安全区）
- Modify: `apps/mobile-portal/src/app/(main)/layout.tsx`（header/main 安全区 + max-w-lg）
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx`（删 2 处输入字号覆写 + 结果构成 gap 断点）
- Modify: `apps/mobile-portal/src/app/(main)/ledger/page.tsx`（删 2 处覆写 + 汇总网格断点）
- Modify: `apps/mobile-portal/src/app/(main)/progress/page.tsx`（删 1 处覆写）

- [ ] **Step 1: globals.css**

`.m-input` 的 `font-size: 15px;` → `font-size: 16px; /* iOS：<16px 聚焦触发 Safari 自动缩放 */`

`.m-tabbar` 增加（既有 `padding-bottom` 保留）：

```css
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
```

`.m-sheet-panel` 的 padding 行改为：

```css
  padding: 12px max(1rem, env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
```

- [ ] **Step 2: (main)/layout.tsx**

header 类 `px-3.5` → `pl-[max(0.875rem,env(safe-area-inset-left))] pr-[max(0.875rem,env(safe-area-inset-right))]`

main 类 `px-3.5` → `mx-auto w-full max-w-lg px-[max(0.875rem,env(safe-area-inset-left))]`（右侧同 header 双侧处理：`pr-[max(0.875rem,env(safe-area-inset-right))]`）

- [ ] **Step 3: 三页输入覆写与网格断点**

dashboard：
- `m-input h-10 min-w-0 flex-1 px-2 text-[13px] tabular-nums` → `m-input h-10 min-w-0 flex-1 px-2 tabular-nums`（×2 date）
- `m-input mb-0 h-10 w-full text-[13px] font-medium` → `m-input mb-0 h-10 w-full font-medium`（select）
- 结果构成 `grid grid-cols-3 gap-2` → `grid grid-cols-3 gap-1.5 min-[360px]:gap-2`（仅「结果构成」卡那一处，其余 grid-cols-3 不动）

ledger：
- `m-input h-11 w-full text-[14px] pl-10` → `m-input h-11 w-full pl-10`（搜索）
- `m-input mb-3 h-10 w-full text-[13px] font-medium` → `m-input mb-3 h-10 w-full font-medium`（select）
- 汇总 `grid grid-cols-4 gap-1.5 text-center` → `grid grid-cols-2 gap-1.5 text-center min-[360px]:grid-cols-4`

progress：
- `m-input mb-3 h-10 w-full text-[13px] font-medium` → `m-input mb-3 h-10 w-full font-medium`

- [ ] **Step 4: 验证**

```bash
pnpm --filter mobile-portal exec tsc --noEmit
pnpm --filter mobile-portal build
# 编译 CSS 断言：.m-input font-size 16px；max-w-lg / min-[360px] 工具类存在
bash scripts/check-cgzxui-redcards.sh --files apps/mobile-portal/src | grep 硬性
# 页面冒烟 200
```

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/mobile-portal/src water-erp/docs/superpowers/plans/2026-10-14-mobile-viewport-adaptation.md
git commit -m "feat(mobile-portal): 屏幕尺寸适配——iOS 聚焦缩放(16px)/平板 max-w-lg/横屏安全区/小屏网格断点"
```

## Self-Review

spec 四项 ↔ Step 1(①③的一部分) 2(②③) 3(①④) 全覆盖；无占位符；类名前后一致（m-input/m-tabbar/m-sheet-panel/max-w-lg/min-[360px]）。
