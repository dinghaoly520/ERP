# 3005 AppShell 去框化 + 引入首页顶栏

**日期**：2026-07-03
**应用**：`apps/web`（采购管理工作台 :3005）
**范围**：`AppShell` 外层骨架（左侧工具栏 + 右侧内容区），不含内层页面内容

## 背景

当前 `AppShell`（`apps/web/src/components/app-shell.tsx`）在 `flow-page` 背景上并排两个
`rounded-[24px]` 重玻璃盒：左 `<aside>`（`panel-surface chromatic-glass glass-calm glass-float`）
+ 右 `<main>`（同样重玻璃盒）。视觉上是"两个组件框拼接"，与公开门户首页（:3002）那种
"内容浮在背景之上"的感觉不符。

## 目标

拆掉两个外层硬框；引入首页（:3002）风格的浅青顶栏；让工具栏与内容区直接落在背景上。

## 决策（已与用户确认）

| 维度 | 决定 |
|------|------|
| 工具栏 | 去重玻璃盒，留**极淡层次**（`bg-white/25` + 右侧细竖线 + `rounded-[16px]` + 无重阴影） |
| 内容区 | **完全开放**：去掉 `<main>` 的 panel 类，内层卡片/`SectionCard`/表格直接浮在 `flow-page` 背景上 |
| 顶栏 | 新增首页风格顶栏：全宽、贴顶、`h-[68px]`、底色 `#e2f5f6`、底部青色流动光线 |
| 顶栏品牌文字 | 「智慧水发·采购中心」（工作台身份，非"四川水发集团"） |
| 顶栏内容 | 左：logo + 品牌文字；中：空（不放假搜索框）；右：`AppUserActions`（从工具栏搬来） |
| 工具栏品牌卡 | **去掉**（顶栏已有品牌，避免重复），工具栏顶部只留折叠按钮 |
| 背景 | 保留 `flow-page` + `flow-glow`；`ambient-grid` 网格调淡一档 |
| 间距 | 顶部间距去掉（顶栏贴顶、内容紧贴顶栏下方）；左右下保留留白 |

## 改动清单

### 1. 新建 `apps/web/src/components/workbench/top-bar.tsx`
- 复刻首页顶栏视觉（跨 Next 应用，不直接 import 公开门户）
- 左：`/procurement-brand-logo.png` + 「智慧水发·采购中心」
- 右：`<AppUserActions layout="header" />`
- 底色 `#e2f5f6`，底部 1px 青色流光线（`header-edge-flow` 动画）

### 2. 改 `apps/web/src/components/app-shell.tsx`
- 顶部插入 `<TopBar />`
- `<aside>`：移除 `panel-surface chromatic-glass glass-calm glass-float rounded-[24px]`，
  换极淡层 + `rounded-[16px]` + 右侧细竖线；`sidebar-sheen` 调淡
- 去掉工具栏顶部品牌卡，改放折叠按钮；导航容器内层白盒去掉
- `<main>`：移除 `panel-surface panel-lens chromatic-glass glass-calm glass-float rounded-[24px]`、
  `FlowBackdrop`、竖向光带、顶部高光发丝 → 透明无底
- 外层去掉顶部 padding，保留左右下 padding

### 3. 改 `apps/web/src/app/globals.css`
- 移植 `@keyframes header-edge-flow`
- `.ambient-grid::before` 网格透明度调淡
- `.sidebar-sheen::after` 色晕调淡
- 视需要补充顶栏 / 工具栏极淡层样式

### 4. 不改
- 内层页面组件（DashboardHome 卡片、SectionCard、表格、UnifiedHeader 内容）
- 移动端横向胶囊导航逻辑
- 登录 / 路由 / 权限

## 验证

- `/dashboard`（驾驶舱，落地页）实机截图：内容卡片落背景后是否清晰、顶栏是否稳定
- 折叠/展开工具栏、分组折叠行为正常
- 移动端（窄屏）顶栏 + 胶囊导航正常
