# 工作台任务通知中心 & 任务弹窗重设计

## 概要

将工作台右侧面板从"任务详情 + AI辅助分析"改造为"任务通知中心（KPI + 通知卡片流 + AI智能规划）"，同时将任务详情以模态弹窗形式展示，点击任务列表项或通知中的任务提醒即可打开。

## 动机

- 任务详情长期占用右侧面板空间，大部分时间处于空白或低效利用状态
- 供应商审批、价格审批、资质到期等办公事项分散在不同页面，缺乏统一聚合视图
- 通知中心（铃铛）信息密度低，无法在工作台层面辅助时间规划
- AI 辅助分析需要结合通知内容提供时间规划建议，而非独立运行

## 架构概览

```
工作台 (/work-arrangements)
├── ReminderBanner (不变)
├── WorkbenchOverview (不变)
├── 主内容区
│   ├── 左 40%: SchedulePanel (日历 + 任务列表, 不变)
│   └── 右 60%: TaskNotificationCenter (新增, 替代原 TaskDetailPanel + AiAssistPanel)
│       ├── NotificationKpiBar          — 待审批/待复核/即将到期 三组数字
│       ├── 通知卡片流 (NotificationCard × N) — 按紧急度排序
│       └── AiPlanningPanel             — AI时间规划与建议
└── TaskDetailModal (新增, 模态弹窗, 点击任务时打开)
```

## 模块设计

### 模块一：整体布局重构

**当前布局：**
- 顶部: ReminderBanner → WorkbenchOverview
- 左侧 40%: SchedulePanel（日历 + 任务列表）
- 右侧 60%: TaskDetailPanel（任务详情 + 备注）+ AiAssistPanel（AI辅助分析）

**新布局：**
- 顶部: 不变
- 左侧 40%: SchedulePanel，不变
- 右侧 60%: TaskNotificationCenter，包含 KPI + 通知卡片流 + AI 规划三大区域
- 任务详情以 `TaskDetailModal` 模态弹窗展示，居中覆盖

### 模块二：任务通知中心 (TaskNotificationCenter)

#### 2.1 顶部 KPI 条 (NotificationKpiBar)

三组数字卡片，复用现有通知 API 数据源（与铃铛通知中心同源 /api/notifications）：

| KPI 卡片 | 数据来源 | 点击跳转 |
|---------|---------|---------|
| 📋 待审批 · N项 · 供应商审批 | derivedTodo.supplierPending | /supplier/approval |
| 🏷️ 待复核 · N项 · 价格复核 | derivedTodo.priceReview | /mall-management/approval |
| ⚠️ 即将到期 · N项 · 资质+投标 | derivedTodo.expiringQualifications | /notifications |

- 数字实时反映（复用 `use-notifications` 30秒轮询）
- 三项均清零时显示 "今日待办已清零 ✓"
- 使用 neumorphic 卡片风格（neu-card 类）

#### 2.2 中部通知卡片流 (NotificationCard)

按紧急程度三级排序：紧急 > 重要 > 普通。

每条通知卡片包含：
- 左侧色条标识紧急度（红/橙/蓝）+ 类型标签 + 相对时间
- 标题摘要 + 关键信息行（📎 前缀）
- [查看] 或 [处理] 操作按钮，根据通知类型区分
- 未读状态：左侧小圆点标记
- 最多展示 6-8 条，超出折叠 + "查看全部 X 条"展开按钮
- 任务提醒通知也在卡片流中出现

**通知类型 → 紧急度映射：**
- 紧急：待审批（SUPPLIER_PENDING）
- 重要：价格复核（PRICE_REVIEW）、资质到期（QUALIFICATION_EXPIRING）
- 普通：投标提醒（BID_REMINDER）、系统通知（SYSTEM）、其他

**操作按钮映射：**
- `actionable: true` 的通知 → [处理] 按钮，跳转对应处理页面
- `actionable: false` 的通知 → [查看] 按钮，跳转通知 link
- 任务提醒 → 点击打开 TaskDetailModal

#### 2.3 底部 AI 智能规划区 (AiPlanningPanel)

主动读取通知中心 + 当日日历任务数据，生成时间规划：

**输出内容：**
1. 建议处理顺序（序号 + 事项名称 + 预估耗时）
2. 预估总耗时
3. 推荐时段（基于当日日历空闲时间段）
4. 策略简述（如：上午处理审批效率最高）

**操作：**
- [刷新分析] — 重新请求 AI 分析
- [添加到日历] — 一键在推荐时段自动创建时间块任务

**状态处理：**
- 加载中：脉动动画 + "正在分析你的待办事项..."
- 无待办：AI 输出 "今日无待办事项，可以专注于项目推进"
- 错误：重试按钮 + 错误提示

### 模块三：任务详情弹窗 (TaskDetailModal)

#### 3.1 弹窗外层

- 半透明深色遮罩: `bg-black/40 backdrop-blur-sm`
- 弹窗居中，最大宽度 640px，最大高度 85vh，内滚动
- 入场动画: Framer Motion scale + fade（`scale: [0.95→1], opacity: [0→1]`）
- 关闭方式: 点击遮罩 / Esc键 / 右上角关闭按钮
- 关闭时（有状态变更）: Toast提示 → 刷新左侧任务列表 → 刷新右侧通知中心

#### 3.2 弹窗内容

**头部（渐变背景，随状态变色）：**
- 状态圆点 + 中文状态名 +（完成/取消时标题加删除线）
- 任务标题（大号粗体）
- 任务描述（灰色单行省略）
- 关闭按钮（右上角）
- 背景色: 进行中=蓝调、受阻=橙调、完成=绿调、取消=灰调

**信息卡网格（2×2 neumorphic card）：**
- ⏰ 截止时间 / 🔔 提醒状态 / 📂 关联项目 / 📅 创建时间

**操作栏（neumorphic 按钮，按当前状态智能显示）：**
- ▶ 开始处理 / ✓ 标记完成 / ⛔ 标记受阻 / ↩ 恢复处理 / ✕ 取消任务 / ⏰ 延后提醒
- 已完成任务的按钮 group 使用 muted 样式
- [+ 添加记录] 右对齐

**过程记录（折叠面板）：**
- 默认展开最近 3 条，超量折叠，标题显示总条数
- 每条: 类型图标（进展📝/心得💡/记录📋）+ 时间戳 + 内容
- 底部输入框支持在弹窗中新增记录

### 模块四：交互流程与数据联动

#### 4.1 任务 → 弹窗触发路径

```
点击任务列表项 ──────────────→ TaskDetailModal
点击通知卡片中"任务提醒" ──→ TaskDetailModal  
浏览器通知点击（提醒到点）──→ TaskDetailModal

弹窗内操作任务 → Toast → 关闭 → 刷新 tRPC task list + notification 轮询
弹窗无操作关闭 → 仅关闭
```

#### 4.2 AI 规划 → 日历联动

```
[📌 添加到日历]
  → 在推荐时段创建"AI_SCHEDULED"时间块任务
    · 类型: AI_SCHEDULED
    · 标题: 事项名称
    · 时长: 预估耗时
    · 关联通知ID（可回溯）
  → 刷新日历视图
  → Toast: "已添加 N 个事项到今日日程"
  → 通知卡片标记 "📌 已安排"
```

#### 4.3 通知处理流程

```
[查看] → navigate(通知.link)
[处理] → navigate(通知对应处理页面)
处理后返回工作台 → 通知中心自动刷新
```

#### 4.4 状态同步

| 数据 | 来源 | 刷新策略 |
|------|------|---------|
| 通知列表 + KPI | use-notifications hook | 30秒轮询 + 操作后手动刷新 |
| 任务列表 | fetchTasks API | 弹窗操作后刷新、切日期刷新 |
| AI 分析 | 后端 AI 接口（新增） | 手动触发"刷新分析" |
| 日历视图 | 任务列表 + AI时间块 | 随任务列表刷新 |

## 文件变更计划

| 操作 | 文件 | 说明 |
|------|------|------|
| **新建** | `components/work-arrangements/task-notification-center.tsx` | 右侧面板主组件（含 KPI+通知流+AI规划布局） |
| **新建** | `components/work-arrangements/notification-kpi-bar.tsx` | KPI 三条统计卡片组件 |
| **新建** | `components/work-arrangements/notification-card.tsx` | 单条通知卡片组件 |
| **新建** | `components/work-arrangements/ai-planning-panel.tsx` | AI 时间规划建议面板 |
| **新建** | `components/work-arrangements/task-detail-modal.tsx` | 任务详情弹窗（含头部+信息网格+操作栏+过程记录） |
| **修改** | `components/work-arrangements/work-arrangements-page.tsx` | 右侧面板替换、弹窗开关逻辑、通知数据传递 |
| **删除** | `components/work-arrangements/task-detail-panel.tsx` | 被 TaskNotificationCenter 替代 |
| **删除/重构** | `components/work-arrangements/work-task-quick-view.tsx` | 功能迁移至 TaskDetailModal |
| **保留复用** | `components/work-arrangements/work-task-notes-panel.tsx` | 过程记录，被弹窗内部引用 |

## 设计约束

- 通知数据源复用现有 `/api/notifications` 和 `use-notifications` hook，不再新增通知 API
- KPI 统计复用 derivedTodo 结构的 `supplierPending`/`priceReview`/`expiringQualifications`
- UI 风格遵循 `[[cgzxui design system]]` 的 neumorphic 设计规范
- AI 分析对接后端新增接口（TBD 具体端点），前端先做界面 + 交互，数据接入后续对接
- Chairman 视图（`WorkArrangementsPageChairman`）本次不做变动，仅重构普通用户版
- 左侧 SchedulePanel 不做任何改动
