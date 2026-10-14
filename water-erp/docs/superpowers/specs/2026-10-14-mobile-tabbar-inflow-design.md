# :3011 底部 Tab 栏「应用壳」化设计

- **日期**：2026-10-14
- **状态**：已获用户批准（方案一：in-flow 应用壳）
- **背景**：fixed 底栏在 iOS Safari 被动态工具栏遮盖/键盘顶走/滚动跳动（「会隐藏」），env 安全区内边距叠加 fixed 视口基准抖动（「偏右」）；用户要求固定不隐藏 + 纯白底 + 居中 + 适配。

## 设计

**架构**：`(main)` 根容器改 `flex h-dvh flex-col overflow-hidden`（h-dvh 跟随动态视口）；Tab 栏从 `position:fixed` 改**文档流内**末位 `shrink-0`——结构性钉底，不可能被滚动/工具栏顶走；三 Tab `flex-1` 均分全宽结构性居中。`main` 改内部滚动（`flex-1 overflow-y-auto overscroll-contain`，保留 `max-w-lg` 居中与左右安全区）。

**Tab 栏样式**：纯白底 `oklch(1 0 0)`（去毛玻璃/半透明）+ 顶部发丝线 + 轻微方向性上影 `0 -6px 16px oklch(0.55 0.03 258 / 0.06)`；保留 `env(safe-area-inset-bottom)` 底部与横屏左右 inset；去 z-index（in-flow）。

**下拉刷新适配**：`usePullToRefresh` 滚顶判定改为优先读内部滚动容器——契约：layout 给滚动容器注入 `id="m-app-scroll"`；hook 内 `document.getElementById('m-app-scroll')?.scrollTop ?? window.scrollY`（登录页等 body 滚动场景仍走 window 回退）。

**main 底部留白**：原为 fixed 栏预留的 `pb-[calc(4.75rem+safe-bottom)]` 移除，改 `pb-4` 呼吸。

**键盘语义**：iOS 键盘弹起时 Tab 栏被键盘临时遮住（原生 App 标准行为），收起即回——符合「固定不隐藏」。

## 验证

- `tsc` / `next build` / 红牌零硬性；四页 200
- 编译 CSS：`.m-tabbar` 无 `position: fixed`、含 `oklch(1 0 0)`；根容器 `h-dvh`/`overflow-hidden` 存在
- 真机：滚动任意深度 Tab 栏恒在；键盘收起即回；三 Tab 居中

## 范围外（YAGNI）

登录页（无 Tab 栏）、PWA、横屏侧边栏布局。
