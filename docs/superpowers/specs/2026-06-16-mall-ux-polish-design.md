# 电子商城第二轮 UX 极致打磨 — 设计文档

**日期**: 2026-06-16
**范围**: `water-erp/apps/mall`（电子商城门户，port 3003）
**前置**: 第一轮已完成基础交互层（count-up、staggered 入场、spring 弹窗、layoutId 视图切换、滚动感知 Header、水叮当增强）
**目标**: 从"能动"推向"极致"，覆盖性能感知、空状态错误、表格交互、详情分析、预算清单、搜索发现、无障碍、情感化八个维度

---

## 设计基调

`water-erp/.impeccable.md` 定调"工业化精准"——所有动效服务于**确认感**（操作成功了）和**理解感**（这按钮干嘛），不服务于炫技。克制的高光时刻 > 持续的视觉噪音。

## 执行策略：地基优先 + 维度应用

**阶段一**：构建 5 个共享地基模块（解决 8 类缺口的共同根因）
**阶段二**：用地基模块逐维度应用到 A-H

理由：8 类缺口根因高度重合（无骨架屏和无乐观更新都源于缺异步状态管理；空状态不统一和错误无兜底都源于缺四态容器），先建地基再应用，代码不重复、全站一致。

---

## 阶段一：地基模块

### 模块关系图

```
<ErrorBoundary>                        ← 模块5：兜住渲染崩溃
  └─ <StateBoundary status={...}>      ← 模块1：四态容器
       ├─ loading → <TableSkeleton>    ← 模块4：骨架屏
       ├─ empty   → <EmptyState>       ← 第一轮已建 + 模块H增强插画
       ├─ error   → <InlineError>      ← 模块5：行内错误
       └─ success → 内容
            ├─ useOptimisticToggle     ← 模块2：乐观更新
            ├─ useUndoableAction       ← 模块2：撤销
            ├─ useAutoSave             ← 模块2：自动保存
            └─ <LiveRegion>            ← 模块3：无障碍播报
                 ↳ useFocusTrap        ← 模块3：焦点锁定
                 ↳ useReducedMotion    ← 模块3：动画降级
```

### 地基模块 1：`<StateBoundary>` + `useAsyncState`

**解决问题**: 各组件各自处理 loading/empty/error，方式不统一（表格文字、弹窗无加载态、emoji 空状态、错误只 toast）。

**API**:
```tsx
type AsyncStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

const { status, data, error, retry } = useAsyncState(
  () => fetch('/api/catalog').then(r => r.json()),
  { deps: [category, search], keepPreviousData: true }
);

<StateBoundary
  status={status}
  loading={<TableSkeleton rows={6} cols={9} />}
  empty={<EmptyState icon={<PackageOpen />} title="..." action={{...}} />}
  error={{ message: error?.message, onRetry: retry }}
  ariaLabel="采购目录"
>
  <table>...</table>
</StateBoundary>
```

**关键决策**:
1. 状态用枚举（`AsyncStatus`）而非布尔组合——消灭 `loading && !error && data.length === 0` 脆弱判断
2. 骨架屏一等公民——`loading` 接收 ReactNode（骨架组件），强制每场景设计真实骨架
3. 错误内置重试——`{ message, onRetry }` 标准化重试模式
4. 状态切换有 `AnimatePresence` 过渡——loading→success→error 不突兀
5. 无障碍内建——loading `role="status"`、error `role="alert"`
6. `keepPreviousData` 选项——SWR 模式，重新获取时保留旧数据 + 顶部进度条

**应用位置**: 采购目录表格、详情弹窗价格历史、预算清单列表切换、供应商视图、操作记录弹窗、水叮当消息列表

### 地基模块 2：乐观更新 + 撤销栈（三原语）

**解决问题**: 每个操作等服务器返回才更新 UI，体感卡顿；删除不可撤销。

**三原语**:

**`useOptimisticToggle`（收藏场景）**:
```tsx
const toggleFav = useOptimisticToggle({
  current: favoriteIds,
  apply: (next) => setFavoriteIds(next),
  mutate: (id, favorited) => api(`/api/catalog/${id}/favorite`, { method: 'POST' }),
});
// 点击即响应（0ms），失败自动回滚 + error toast
```

**`useUndoableAction`（删除场景）**:
```tsx
const deleteLine = useUndoableAction<BudgetLine[]>({ windowMs: 5000 });
// 删除瞬间消失 → 5s 撤销窗口（toast + 倒计时进度条）
// 撤销 → spring 弹回原位；超时 → 自动保存持久化
```
- 与 `useAutoSave` 协调：删除时抑制自动保存 5s，撤销窗口关闭后才持久化

**`useAutoSave`（预算清单编辑）**:
```tsx
const { status } = useAutoSave({
  data: lines,
  onSave: async (data) => api(`/api/budget/lists/${id}/items`, { method: 'PUT', ... }),
  debounceMs: 700,
  skipRef,
});
// status: 'idle' | 'saving' | 'saved' | 'error'
```
- 保存状态外露（saving 转圈 / saved 绿✓淡出 / error 红色重试）
- 失败自动重试 3 次（指数退避）

**应用位置**: 收藏（表格/卡片/详情）、预算增删（撤销+自动保存）、加入预算（乐观+badge 弹跳）

### 地基模块 3：无障碍基元（5 个）

| 基元 | 作用 |
|---|---|
| `useFocusTrap` | 弹窗焦点锁定 + 关闭归还触发元素 |
| `useDismissable` | Esc/外部点击/焦点归还统一封装 |
| `<LiveRegion>` | 动态变化播报给屏幕阅读器（polite/assertive） |
| `useReducedMotion` | 全局尊重 `prefers-reduced-motion`，CSS+framer-motion 双降级 |
| `useRovingIndex` | 方向键导航（目录树/表格行 WAI-ARIA roving tabindex） |

**应用位置**: 4 弹窗（focusTrap+dismissable）、全站（reducedMotion）、异步区域（LiveRegion）、目录树+表格行（rovingIndex）

### 地基模块 4：骨架屏系统

**原子层**: `<BlockSkeleton w h />`、`<LineSkeleton w="60%" />`、`<CircleSkeleton size={40} />`
**组合层**: `<TableSkeleton rows cols />`、`<CardGridSkeleton count cols />`、`<DetailSkeleton />`、`<StatCardSkeleton />`

**关键决策**:
1. 布局匹配优先——骨架尺寸与真实元素逐像素匹配，加载完成零 CLS
2. Shimmer 扫光（非脉冲）——明确传达"内容流入"而非"卡住了"
3. `@media (prefers-reduced-motion: reduce)` 退化为静态灰色

### 地基模块 5：错误兜底 + 重试（四层）

| 层 | 职责 |
|---|---|
| `<ErrorBoundary>` | 兜住渲染崩溃，不白屏，友好兜底页 + 重新加载 |
| `withRetry()` | 网络错误自动重试（指数退避+抖动），4xx 不重试，5xx 重试 1 次 |
| `<InlineError>` | 行内错误展示 + 重试按钮（接入 `<StateBoundary error>`） |
| 全局 handler | `window.onerror` + `unhandledrejection` → toast |

**错误分类策略**: 网络错误→自动重试3次→InlineError带重试；4xx→显示服务器具体信息不重试；5xx→重试1次→InlineError；渲染崩溃→ErrorBoundary兜底页

---

## 阶段二：维度应用

### 维度 B：空状态与错误处理

- 全站 emoji 清零（`.impeccable.md` 禁止 emoji-as-icons），换 Lucide 图标
- 8 处空状态统一替换为 `<EmptyState>` + Lucide 图标 + 行动按钮（重置/返回/联系）
- 消灭所有 `.catch(() => {})` 静默吞错，全接入 `useAsyncState`
- 错误文案按场景区分（网络/服务器/权限/空/无果），各有恢复路径

### 维度 A：性能感知（6 触点）

1. **Stale-While-Revalidate**：筛选切换保留旧数据 + 顶部进度条 + 新结果 stagger 淡入交叉过渡
2. **表格行布局动画**：`AnimatePresence mode="popLayout"` + `layout`，行增减时其他行 spring 填补
3. **导出全过程反馈**：按钮 spinner + "生成中…" + "已导出" morph
4. **AI 场景流式反馈**：按钮 loading + 新增行 stagger 弹入 + 每行高亮淡出
5. **详情即时打开**：弹窗 spring 弹入同时 chart 区域显示骨架，数据到达后绘制
6. **全局顶部进度条**：任何异步 in-flight 时页面顶部 2px 蓝条

### 维度 C：表格交互（5 增强）

1. **列排序**：参考价/价格变化/更新时间/有效期可排序，`layoutId="sort-arrow"` 弹性滑动 + 行 `layout` 重排
2. **密度切换**：紧凑（40px行高）/ 舒适（56px），localStorage 持久化，行高平滑过渡
3. **行 hover 指示器**：`layoutId="row-accent"` 蓝色 accent 条 spring 跟随
4. **键盘导航**：`useRovingIndex`，↑↓ 移动 + Enter 打开详情，`focus-visible` 焦点环
5. **批量选择**：首列 checkbox + Shift 范围选择 + 底部浮动操作栏（加入预算/对比/清空）

### 维度 D：详情与价格分析（3 增强）

1. **可折叠分区**：价格信息+趋势默认展开，其余折叠，localStorage 持久化，折叠态显示摘要
2. **交互式价格图**：`pathLength` 绘制动画 + 鼠标 hover 十字线 + 参考价基准虚线 + 极值标注 + 触摸支持
3. **多物资对比**：批量选 2-4 项 → 对比弹窗（属性×物资矩阵），最优值绿标，首列 sticky，每列可加预算

### 维度 E：预算清单体验（4 增强）

1. **删除撤销**：`useUndoableAction` 5s 窗口，行滑出+toast+撤销弹回
2. **数量三模式**：点击 ± / 长按连续增减（加速）/ 直接输入（点击数字变 input）
3. **自动保存指示器**：`useAutoSave` status 外露，预算按钮 + 弹窗副标题双位置显示 saving/saved/error
4. **拖拽排序**：framer-motion `Reorder.Group` + 手柄 + spring 让位 + 已转换清单禁用

### 维度 F：搜索与发现（4 增强）

1. **`/` 全局快捷键**：任意位置按 `/` 聚焦搜索框（忽略输入框内），badge 提示
2. **搜索历史**：localStorage 8 条，聚焦+空时显示历史 chip 横排 + 清除
3. **实时联想**：debounce 120ms，分组（物资/供应商/分类），高亮匹配子串，↑↓键盘导航，物资项可直接打开详情
4. **最近浏览**：localStorage 6 项，聚焦+空时显示最近物资 chip，点击打开详情

### 维度 G：无障碍落地（4 块）

1. **弹窗闭环**：4 弹窗接入 focusTrap + dismissable + `aria-modal` + `aria-labelledby` + 背景内容 `aria-hidden`
2. **LiveRegion 应用**：目录结果数、预算保存、批量选择数、错误状态全部播报
3. **键盘导航**：目录树 WAI-ARIA Tree（↑↓←→Enter/Home/End）+ 表格行 rovingIndex + `aria-sort` + 行 `aria-label`
4. **对比度+焦点环+ARIA 审计**：`#8a96aa→#6a7890` 正文灰、全局 `*:focus-visible` 焦点环、搜索框 combobox 角色、装饰图标 aria-hidden、所有操作按钮 aria-label

### 维度 H：情感化设计（3 增强，不含新手引导）

1. **插画式空状态**：`<EmptyIllustration>` — Lucide 图标 + 虚线圆环（20s旋转）+ 浮动点 + 径向阴影，6 种变体，单色蓝灰，极慢极轻动画
2. **成功庆祝**：加入预算（按钮 morph + 确认光环）、生成询价单（全屏 SuccessOverlay 仪式）、导出完成（文件图标飞出）
3. **上下文 tooltip**：`<Tooltip>` 包装器（hover/long-press/focus 触发，500ms 延迟，自动定位），覆盖密度/视图/排序/导出/AI 场景/预警等 11 处控件

---

## 实施顺序

```
地基阶段（阶段一）
  1. interactions/ 扩展：useAsyncState, StateBoundary, 骨架原子+组合
  2. interactions/ 扩展：useOptimisticToggle, useUndoableAction, useAutoSave
  3. interactions/ 扩展：useFocusTrap, useDismissable, LiveRegion, useReducedMotion, useRovingIndex
  4. interactions/ 扩展：ErrorBoundary, withRetry, InlineError, 全局 error handler
  5. globals.css：shimmer keyframe、reduced-motion 全局规则、focus-visible 全局规则

维度应用（阶段二，按依赖顺序）
  B → 空状态错误（验证地基1+4+5，最快见效）
  A → 性能感知（地基1+2+4 应用到表格/弹窗/导出）
  C → 表格交互（排序+密度+批量，改动最大）
  D → 详情分析（可折叠+交互图+对比弹窗）
  E → 预算清单（撤销+长按+自动保存+拖拽）
  F → 搜索发现（快捷键+历史+联想+最近浏览）
  G → 无障碍落地（全站接入基元+对比度修复）
  H → 情感化（插画系统+成功庆祝+tooltip）
```

## 验收标准

- [ ] 无任何 `.catch(() => {})` 静默吞错
- [ ] 无任何 emoji 传达信息（装饰性 aria-hidden 的除外）
- [ ] 所有异步区域有骨架屏（非文字加载）
- [ ] 所有弹窗有 focus trap + Esc 关闭 + 焦点归还
- [ ] `prefers-reduced-motion: reduce` 下无任何持续动画
- [ ] 表格可排序、可切密度、可批量选择、可键盘导航
- [ ] 预算删除可撤销、数量可长按/输入、自动保存有指示器、可拖拽排序
- [ ] 搜索有 `/` 快捷键、历史、联想、最近浏览
- [ ] 详情分区可折叠、价格图可交互、支持多物资对比
- [ ] 正文颜色对比度 ≥ 4.5:1（WCAG AA）
- [ ] 构建通过（`pnpm --filter mall build`）
