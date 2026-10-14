# 移动驾驶舱 :3011 体验打磨（第一轮）设计

- **日期**：2026-10-14
- **状态**：已获用户批准（方案一：零新依赖）
- **基线**：`docs/superpowers/specs/2026-10-13-mobile-portal-3011-design.md`（首建 spec）

## 背景

:3011 首建交付后自审计发现 7 项优化点（原列 8 项，其中「台账统计与列表筛选不一致」经核实为**口径一致**——`/procurements/stats` API 仅收日期+公司，移动端无日期 UI 故仅传公司，与桌面端行为相同，撤销不改）。本 spec 覆盖补齐缺口、移动端手势/动效、数据流去重三类。

## 决策记录

| 决策点 | 结论 |
|--------|------|
| 动效实现路线 | **零新依赖**：CSS keyframes + `prefers-reduced-motion` 尊重；不引入 framer-motion（轻门户避免运行时与包体成本） |
| 下拉刷新 | 自研 `usePullToRefresh` hook（touch 事件，~70 行），不用第三方库（样式需对齐 cgzxui） |
| 用户态 | `(main)/layout` 建 AuthContext，三页消费，删除各自 `fetchCurrentUser` |
| 筛选记忆 | localStorage 单 key `mobile-portal:filters` 分页存；**搜索词不记忆**（瞬态意图） |

## ① 手势与动效（4 项）

1. **下拉刷新** `usePullToRefresh(onRefresh: () => Promise<void>)`：
   - 仅当窗口 `scrollTop === 0` 时响应下拉；拖距阈值 64px 触发，指示器（旋转圆点）随拖距 0→64px 渐进出现，松手未达阈值回弹、达阈值锁定旋转直至 onRefresh resolve
   - 三页接入：数据库=重拉 dashboard、台账=重置回第 1 页重拉（保留筛选）、进展=重拉 stats+insights
2. **入场动效**：`.m-rise` CSS keyframes（translateY(14px)→0 + 淡入，0.36s ease-out-quint）；SectionCard 加 `style={{ animationDelay: ${i*50}ms }}` 阶梯；`@media (prefers-reduced-motion: reduce)` 下 `animation: none` 直显
3. **趋势图触摸优化**：数据点热区从 r=11 圆改**整列全高透明 rect**；`onTouchStart/onPointerDown` 置 `activeIdx` → 高亮竖参考线 + 放大点；`onPointerUp` 触发当日 sheet 下钻
4. **Sheet 退场动画**：BottomSheet 增加 `closing` 态——`onClose` 先置 closing（`m-sheet-down` 240ms 反向动画），动画结束再卸载；期间锁 body scroll

## ② 补齐与数据流（3 项）

5. **项目规模分析**（spec 首建遗漏项补齐）：移植桌面 `dashboard-home.tsx computeSegments`——四桶 小额<10万 / 中小 10-50万 / 中型 50-200万 / 大型>200万（按 `trendSeries[].projects[].budgetLabel` 解析“万/元”字面值）；移动端渲染行列表（标签+区间+比例条+计数/占比），点行 → BottomSheet 下钻该区间项目清单（复用 ProjectRow）；位置：采购方式分布之后
6. **用户态去重**：`src/components/m/auth-context.tsx` 导出 `AuthProvider` + `useAuth()`（`{ user, role }`）；`(main)/layout` 包裹；三页删 `fetchCurrentUser`/`role` state 改 `useAuth()`
7. **筛选记忆**：`readSavedFilters(page)/saveFilters(page, value)`（`lib/filter-store.ts`，try/catch 容错隐私模式）；记忆键：dashboard `{rangeKey, companyId}`、ledger `{statusFilter, methodFilter, companyId}`、progress `{companyId}`；变更即写、挂载读

## ③ 已核实不改

台账统计条仅随公司筛选——与桌面 `/stats` 参数面（日期+公司）一致。

## 范围外（YAGNI）

framer-motion、第三方刷新库、Service Worker 离线缓存、搜索词记忆、桌面端任何改动、API 侧改动。

## 验证

- `tsc` / `next build` / `eslint`（0 error）全绿
- 手动冒烟：下拉刷新三页可用且不误触（页面中部下拉不触发）；卡片入场有阶梯动效且系统减弱动效设置下直显；趋势图手指按列即高亮、松开出 sheet；sheet 关闭有下滑退场；规模分析四桶有数据且下钻正常；登录态切换页面仅 1 次 `/auth/me`（DevTools Network）；筛选刷新后保留
