# 工作台重设计规格 —— 内容架构 · 布局 · 组件

**日期：** 2026-07-06  
**范围：** `apps/web` (:3005) `/work-arrangements` 个人工作台页面  
**设计系统：** cgzxui neumorphic（已 port 至 `apps/web/src/app/globals.css`）

---

## 1. 背景

### 1.1 问题诊断

| # | 问题 | 根因 |
|---|------|------|
| 1 | 界面逻辑不清晰 | 日历与任务列表视觉割裂，右侧多卡片无统一边界，用户不知道"先看哪" |
| 2 | 组件设计不协调 | 大量内联 `style` 绕过 CSS 类，`border-radius` 18/20/22/24px 混用，阴影深浅不一 |
| 3 | 未遵循 cgzxui 风格 | 缺少方向性双影、`inset 0 1px 0` 内高光线、oklch() 色彩空间，三态交互不完整 |

### 1.2 设计约束

- **所有现有功能保留**（10 个模块，不可删减）
- **多角色通用框架**（procurement_staff / leader / admin）
- **核心定位："今日任务驱动"**——日历+任务列表是主角
- **底部必须对齐**，不允许出现空白区域
- **严格遵循 cgzxui**：单一 CSS 源、oklch、方向性双影、三态完整

---

## 2. 内容架构：4 大板块

将现有 10 个模块归纳为 4 个逻辑板块，每板块用统一 neumorphic 卡片包裹：

### 板块 ① 问候横幅 `GreetingBanner`
- 个性化问候 + 时段图标
- AI 诗句/名字赏析（轻量展示）
- AI 每日建议（底部强调条）
- 实时时钟（保留 `LiveClock`，融入卡片）

### 板块 ② 日程规划 `SchedulePanel`
- 月日历（`WorkCalendar`）
- 当日任务列表（`WorkDateTaskList`）
- 未排期任务区域
- 日历与任务列表共处一卡——"选日期→看任务"逻辑内聚

### 板块 ③ 任务详情 `TaskDetailPanel`
- 任务快捷操作按钮（`WorkTaskQuickView` 操作区）
- 任务元信息（截止时间/提醒状态/关联项目）
- 过程记录列表 + 添加记录面板（`WorkTaskNotesPanel`）
- 空态引导"选择一条任务以查看详情"

### 板块 ④ AI 辅助 `AiAssistPanel`
- AI 今日排程（时间块建议，可折叠）
- 具体建议（可折叠）
- 项目简报（仅 leader/admin 可见，底部渲染）

### 板块关系

```
┌──────────────────────────────────────────────────────┐
│  ① 问候横幅（全宽，neu-card-static，轻量紧凑）          │
├─────────────────────────┬────────────────────────────┤
│                         │  ③ 任务详情 (flex-1)        │
│  ② 日程规划 (flex-1)     │  neu-card-static            │
│  neu-card-static         │  · 空态：引导选择任务       │
│  · 月日历                │  · 选中态：快捷操作 + 记录  │
│  · 当日任务列表           ├────────────────────────────┤
│  · 未排期任务             │  ④ AI 辅助 (flex-1)        │
│                         │  neu-card-static            │
│                         │  · AI 时间块建议（可折叠）    │
│                         │  · 具体建议（可折叠）         │
│                         │  · 项目简报 (leader/admin)   │
│  ←── 底部严格对齐 ──────→│                            │
└─────────────────────────┴────────────────────────────┘
```

---

## 3. 布局方案

### 3.1 顶层结构

```html
<div class="flex min-h-full flex-col gap-4">          <!-- 页面根 -->
  <ReminderBanner />                                   <!-- 固定提醒，逻辑不变 -->

  <!-- ① 全宽问候横幅 -->
  <GreetingBanner class="neu-card-static" />

  <!-- 双栏主体：底部严格对齐 -->
  <div class="grid flex-1 gap-4 xl:grid-cols-[0.40fr_0.60fr]">
    <!-- ② 左列日程规划 -->
    <SchedulePanel class="neu-card-static flex flex-col" />

    <!-- 右列：flex-col 两卡片均分，自然与左列等高 -->
    <div class="flex flex-col gap-4">
      <!-- ③ 任务详情 -->
      <TaskDetailPanel class="neu-card-static flex-1" />
      <!-- ④ AI 辅助 -->
      <AiAssistPanel class="neu-card-static flex-1" />
    </div>
  </div>

  <!-- Modal/Drawer（挂根节点，避免 containment 裁剪） -->
  <WorkTaskEditorDrawer />
  <HistoryDrawer />
</div>
```

### 3.2 高度对齐机制

- 左列日程规划：日历年固高 ~340px，任务列表 `flex-1 overflow-y-auto` 撑满剩余
- 右列包裹容器 `flex flex-col`，两 `flex-1` 自动均分高度
- 左列日历支持**折叠**以平衡极端高度差（任务少时展开、任务多时折叠）
- 右列卡片内容不足时用 `min-h-0` + 空态填充保证视觉不塌缩

### 3.3 响应式降级

- `< xl`：切换为单列堆叠，顺序：问候 → 日程 → 任务详情 → AI 辅助
- 日历在窄屏自动折叠为极简模式

---

## 4. 组件设计规范

### 4.1 公共原则（cgzxui 硬约束）

| 规则 | 说明 |
|------|------|
| 单一 CSS 源 | 绝不在 TSX 写 `style={{ boxShadow/background/border }}`，全部用 globals.css 类名 |
| 色彩空间 | 全部 `oklch()`，禁止 `rgba()` / 裸 hex 阴影色 |
| 方向性双影 | 光源左上方：暗影投右下 `2px 2px`，亮高光留左上 `-1px -1px` |
| 内高光线 | 所有卡片/容器必含 `inset 0 1px 0 oklch(1 0 0 / 0.7)` |
| 三态完整 | 默认凸起 → hover 抬升 → active 内凹，漏任何一态即 bug |
| reduced-motion | `@media (prefers-reduced-motion: reduce)` 关闭所有动画 |
| 圆角统一 | 外壳卡片 `rounded-[18px]`，内嵌元素 `rounded-[14px]` |

### 4.2 类名速查（已存在于 globals.css）

| 类名 | 用途 | 三态 |
|------|------|------|
| `.neu-card-static` | 板块外壳卡片（非交互容器） | 默认凸起无 hover |
| `.neu-card` | 内嵌交互子卡片 | 默认凸起 → hover 抬升 |
| `.neu-btn-primary` | 主要操作按钮 44px | 默认 → hover 抬升 → active 内凹 |
| `.neu-btn-soft` | 次要链接按钮 | 同上 |
| `.neu-btn-xs` | 行内紧凑按钮 12px | 同上 |
| `.neu-input` | 内凹输入框 44px | focus 环 |
| `.neu-icon-well` | 内凹图标容器（空态） | 静态 |
| `.neu-thead` | 内凹表头背景 | 静态 |

**web :3005 已有完整 port**，无需新增类名。TSX 只需引用这些类。

### 4.3 板块 ① GreetingBanner（问候横幅）

**定位：** 全宽 `neu-card-static`，紧凑情感层，引导用户进入工作状态。

**结构：**
```
┌─ neu-card-static ────────────────────────────────────────────┐
│ [时段图标] 张宏董事长，早上好 ─────────── [LiveClock 实时时钟] │
│ 名字赏析（金色渐变文字，AI 生成，低频出现）                      │
│ ┌─ AI 每日建议（左侧 3px 强调色条）───────────────────────────┐ │
│ │ 今天有 5 项任务待处理，建议优先处理供应商资质审核...          │ │
│ └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**关键改动：**
- 移除 `WorkbenchOverview` 中所有 `style={{ background, border, etc }}` 内联样式
- 改用 `neu-card-static` 承载外壳
- 卡片内排版用 Tailwind utility（padding/gap/font），不用内联 style
- 左侧强调色条保留（AI 建议区左侧 3px），但用 Tailwind `border-l-[3px]` 替代内联 style
- 时段色调信息通过 CSS 变量 `--greeting-accent` 驱动（由 TSX 设置一次，CSS 消费）

**CSS 变量驱动方案（替代内联渐变背景）：**
- `LiveClock` 颜色跟随——TSX 设 `--lc-*` 变量，CSS 消费（现有逻辑，保持不变）
- 问候卡片背景：`neu-card-static` 默认背景已足够，不做彩色渐变
- AI 建议强调条：`border-l-[3px]` Tailwind + `border-[var(--greeting-accent)]`

### 4.4 板块 ② SchedulePanel（日程规划）

**定位：** 左列主卡片，"选日期→看任务"一体。

**结构：**
```
┌─ neu-card-static flex flex-col ──────────────────────────────┐
│ ┌─ 标题栏 ──────────────────────────────────────────────────┐ │
│ │ 7月6日 周日 · 3项任务          [+ 新建] neu-btn-xs        │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─ 月日历 WorkCalendar ────────────────────────────────────┐ │
│ │ （现有日历组件，阴影体系重构为 oklch 方向性双影）           │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ─── neu-thead 风格分割线 ─────────────────────────────────── │
│ ┌─ 当日任务列表 flex-1 overflow-y-auto ─────────────────────┐ │
│ │ [TaskCard] 供应商A资质到期审核    紧急  [← 左边框强调色]   │ │
│ │ [TaskCard] 专家库更新季度评审      高                     │ │
│ │ [TaskCard] 采购公告定稿发布        中                     │ │
│ │ ─── 未排期任务 ───                                       │ │
│ │ [TaskCard] 系统迁移方案评审        中   未排期              │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**关键改动：**
- `WorkCalendar`：移除 `style={{ background, border, boxShadow }}` 内联样式，日历年外壳用 `neu-card` 替代
- `WorkDateTaskList` 的 `TaskCard`：保留紧急度左边框+渐变色方案，但外壳改为 `neu-card`（hover 抬升）
- 日历与任务列表之间的分割线：Tailwind `border-t border-[var(--border-soft)]` 微妙分割
- 标题栏"新建"按钮：`neu-btn-xs`

### 4.5 板块 ③ TaskDetailPanel（任务详情）

**定位：** 右上卡片，完整的"选中任务—查看—操作—记录"交互面板。

**结构：**
```
┌─ neu-card-static flex flex-col ──────────────────────────────┐
│ ┌─ 标题行 ──────────────────────────────────────────────────┐ │
│ │ [状态圆点] 供应商A资质到期审核  [进行中] [高]  [编辑 neu-btn-xs] │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─ 信息网格：3列 neu-card 小格 ──────────────────────────────┐ │
│ │ ┌ 截止时间 ────┐ ┌ 提醒状态 ────┐ ┌ 关联项目 ────┐        │ │
│ │ │ 7月10日 14:00 │ │ 未设置提醒    │ │ 2026采购计划  │        │ │
│ │ └──────────────┘ └──────────────┘ └──────────────┘        │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─ 操作按钮行 ──────────────────────────────────────────────┐ │
│ │ [开始处理 neu-btn-primary.is-success]                     │ │
│ │ [标记完成 neu-btn-soft.is-success]                        │ │
│ │ [标记受阻 neu-btn-soft.is-danger]                         │ │
│ │ [延后提醒 neu-btn-soft]  [添加记录 neu-btn-soft]           │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─ 过程记录 (flex-1 overflow-y-auto) ───────────────────────┐ │
│ │ [记录卡片 neu-card] 进展：已完成初步审核...  7/6 10:30     │ │
│ │ [记录卡片 neu-card] 心得：供应商资质齐全...  7/5 16:20     │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─ 添加记录面板（可折叠） ──────────────────────────────────┐ │
│ │ [类型选择 neu-btn-soft 组] [neu-input 文本] [提交 neu-btn-primary] │
│ └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│ 空态（无选中任务时）：                                          │
│ ┌─ neu-icon-well ───────────────────────────────────────────┐ │
│ │  选择一条任务后，这里会显示快捷处理信息                       │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**关键改动：**
- 移除 `WorkTaskQuickView` 中所有内联 `style={{ border, background, etc }}`
- 任务标题行、信息网格、操作按钮行、记录列表：统一用 neu-* 类名承载
- 状态徽章：保留颜色语义，但用 Tailwind 排版 + CSS 变量色值，不加 neumorphic shadow（文字级元素不加阴影）
- 空态：`neu-icon-well` 内凹图标槽 + 引导文字
- 操作按钮颜色语义：通过 `.is-success` / `.is-danger` 变体实现

### 4.6 板块 ④ AiAssistPanel（AI 辅助）

**定位：** 右下卡片，所有 AI 生成内容统一收纳，按折叠面板组织。

**结构：**
```
┌─ neu-card-static flex flex-col ──────────────────────────────┐
│ ┌─ 标题行 ──────────────────────────────────────────────────┐ │
│ │ [Sparkles] AI 今日排程   [AI 安排 neu-btn-xs] [历史 neu-btn-xs] │
│ └──────────────────────────────────────────────────────────┘ │
│                                                                │
│ ▼ AI 今日排程（默认展开，可折叠）                               │
│ ┌─ neu-card ────────────────────────────────────────────────┐ │
│ │ ┌ 09:00-11:00 深度工作期 ────────────────────────────┐    │ │
│ │ │ 处理供应商A资质到期审核... 关联任务 3 条               │    │ │
│ │ └────────────────────────────────────────────────────┘    │ │
│ │ ┌ 14:00-16:00 协作沟通期 ────────────────────────────┐    │ │
│ │ │ 专家库更新季度评审... 关联任务 2 条                    │    │ │
│ │ └────────────────────────────────────────────────────┘    │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                                │
│ ▼ 具体建议（默认展开，可折叠）                                  │
│ ┌─ neu-card ────────────────────────────────────────────────┐ │
│ │ [Lightbulb] 【供应商管理】本周有 3 家供应商资质即将到期...   │ │
│ │ 【专家管理】季度评审截止日期临近...                         │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                                │
│ ▼ 项目简报（仅 leader/admin，默认展开，可折叠）                 │
│ ┌─ neu-card ────────────────────────────────────────────────┐ │
│ │ [Lightbulb] 项目简报内容...                                │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**关键改动：**
- `WorkbenchPlanningPanel` 的 `panel-surface panel-lens` 外层改为 `neu-card-static`
- 时间块卡片：`neu-card`（hover 抬升，点击选中高亮）
- 具体建议/项目简报内容区：`neu-card`
- 折叠面板用 `<details>` + `<summary>` 实现（零 JS），或受控 `useState` + 动画
- AI 安排/历史按钮：`neu-btn-xs`
- 移除内联 `style={{ background, border }}`，全部改用 CSS 类

---

## 5. 色彩与阴影迁移清单

### 5.1 需要移除的内联 style（全量清单）

| 组件 | 文件 | 移除项 |
|------|------|--------|
| WorkbenchOverview | `workbench-overview.tsx` | 所有 `style={{ background, border, etc }}` 约 8 处 |
| WorkCalendar | `work-calendar.tsx` | 外容器 `style={{ background, border, boxShadow }}`，日期 cell `bgStyle` |
| WorkDateTaskList | `work-date-task-list.tsx` | TaskCard 的 `urgencyStyle.card` 渐变色（迁移至 CSS class） |
| WorkTaskQuickView | `work-task-quick-view.tsx` | 所有容器的 `className` 中间带 `border/background` 的 Tailwind 裸写 |
| WorkbenchPlanningPanel | `workbench-planning-panel.tsx` | `panel-surface panel-lens` → `neu-card-static`，子卡片裸样式 |
| ReminderBanner | `reminder-banner.tsx` | 背景渐变的 `style` → CSS class |

### 5.2 新增 CSS 类（写入 globals.css）

`neu-card-static`、`neu-card`、`neu-btn-*`、`neu-input`、`neu-icon-well` 已存在，**无需新增类名**。

可能需要补充的微调：
- `.workbench-greeting-accent` — AI 建议左侧色条（消费 `--greeting-accent` 变量）
- `.workbench-task-urgency-CRITICAL` / `HIGH` / `MEDIUM` / `LOW` — 任务卡片左边框色（迁移自内联 style）

### 5.3 三态覆盖检查

每个交互元素上线前必须验证：

| 状态 | 视觉 | 实现 |
|------|------|------|
| 默认 | 凸起，内高光线可见 | `.neu-card` / `.neu-btn-*` 默认样式 |
| hover | 抬升 1-4px，阴影加深 | `:hover` 伪类 |
| active | 内凹，阴影反转 | `:active` 伪类 |
| disabled | 透明度降低，无交互 | `:disabled` 伪类 |
| reduced-motion | 动画禁用 | `@media (prefers-reduced-motion)` |

---

## 6. 组件拆分方案

### 现有文件 → 目标结构

| 现有文件 | 处理方式 |
|---------|---------|
| `work-arrangements-page.tsx` | 重构为容器组件，只负责状态管理+布局编排 |
| `workbench-overview.tsx` | 重构 → 板块 ① `GreetingBanner`，移除内联 style |
| `work-calendar.tsx` | 重构 → 移除内联 style，改用 CSS 类 |
| `work-date-task-list.tsx` | 重构 → 移除内联 style |
| `work-task-quick-view.tsx` | 重构 → 板块 ③，整合 `WorkTaskNotesPanel` |
| `work-task-notes-panel.tsx` | 合并入板块 ③ |
| `workbench-planning-panel.tsx` | 重构 → 板块 ④ `AiAssistPanel` |
| `project-brief-card.tsx` | 合并入板块 ④ |
| `reminder-banner.tsx` | 轻度重构，移除内联 style |
| `work-task-editor-drawer.tsx` | 保留，轻度 neumorphic 化 |
| `history-drawer.tsx` | 保留，轻度 neumorphic 化 |

---

## 7. 实施策略

### Phase 1：定义新组件骨架（不破坏现有页面）
1. 创建 4 个新板块组件（GreetingBanner / SchedulePanel / TaskDetailPanel / AiAssistPanel）
2. 新组件引用旧组件的逻辑，但包裹在 `neu-card-static` 外壳中
3. 新布局容器（`work-arrangements-page-v2.tsx`）先不替换路由

### Phase 2：逐个重构子组件（消除内联 style）
1. 重构 `WorkCalendar` → 阴影体系 neu-* 化
2. 重构 `WorkDateTaskList` → 任务卡片 neu-* 化
3. 重构 `WorkTaskQuickView` → 操作按钮/状态/记录 neu-* 化
4. 重构 `WorkbenchPlanningPanel` → 外壳+子卡片 neu-* 化

### Phase 3：组装 & 对齐验证
1. 4 大板块组件与布局容器组装
2. 验证双栏底部对齐（屏幕截图对比）
3. 验证三态交互（hover/active/disabled）
4. 验证 reduced-motion 降级

### Phase 4：路由切换 & 清理
1. page.tsx 切换到新页面实现
2. 移除旧代码
3. 验证 loading / error / empty 全状态

---

## 8. 成功标准

- [ ] 4 大板块各有统一的 `neu-card-static` 外壳，视觉边界清晰
- [ ] 所有内联 `style` 已移除（仅保留 CSS 变量设置如 `--greeting-accent`）
- [ ] 所有交互元素（按钮/链接/子卡片）完整三态：raised → lift → inset
- [ ] 所有阴影使用 oklch() 方向性双影，含内高光线
- [ ] 双栏底部严格对齐，无空白区域
- [ ] 响应式 `< xl` 单列降级正常
- [ ] 无 console error，TypeScript 编译通过
- [ ] 视觉截图验证：与 cgzxui 风格一致
