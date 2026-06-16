# 主题 B · 信息感知层 — 设计文档

**日期**：2026-06-16
**门户**：采购管理工作台（web，:3005）
**主题**：B · 信息感知层（6 主题迭代序列的第一项，顺序 B → C → D → A → E → F）
**状态**：已批准，待实现计划

## 背景与目标

web 门户单点功能成熟，但跨模块的**信息感知力**是短板：后端已有完整通知系统（`/api/notifications`、unread-count、资质到期 cron、多渠道分发），前端却**零入口**；MetricCard 是静态快照，看不出走势；异常（资质临期、连续 D 级）要用户主动巡检才能发现。

本主题让系统从"被动展示"转向"主动推送待办"，使用户打开系统第一眼就看到"需要我做什么"。核心价值是**"待办清零"的正反馈节奏**——ERP 后台留住用户的关键。

## 设计决策（经可视化评审确认）

| # | 决策点 | 选定方案 |
|---|---|---|
| 1 | 通知交互模式 | 铃铛 + 下拉面板（即时预览，不离开当前页）|
| 2 | 下拉内容模型 | 「待办 / 全部」分段，可操作通知置顶带深链 |
| 3 | MetricCard 趋势 | 分阶段：先变化量胶囊（localStorage 基线），后 sparkline（后端快照）|
| 4 | 首页待办区布局 | 全宽聚合视图（按模块分组大数字），置于 MetricCard 与 AI 面板之间 |

## 架构总览

三个**感知面**共享一份数据，经三个前端 hook 聚合，主体改动在前端、后端几乎无新增。

```
① 感知面（用户看到的）
   • 头部铃铛 + 下拉       （全局常驻，任意页面）
   • 首页待办区            （首页置顶，模块聚合）
   • 详情页内联告警横幅     （供应商/专家详情页，场景化）
            ↓ 共享 ↓
② 聚合层（前端 hook）
   • useNotifications()   轮询通知 + 待办/信息性分类 + 未读数
   • useTrend()           localStorage 基线 + 「比上次 ±N」
   • useAlerts()          实体级告警（资质临期/D级/负荷）
            ↓
③ 数据源
   ✓ /api/notifications            （已有）
   ✓ /api/notifications/unread-count （已有）
   ✓ /api/supplier/stats           （已有）
   ✓ /api/catalog/admin/stats      （已有，含 pendingApplications）
   ✓ 资质到期 cron                  （已有，SchedulerModule）
   ＋ type → actionable 标注        （新增，通知创建时）
   ○ MetricSnapshot 表 + 每日 cron  （第二阶段，独立 spec）
```

**设计要点**：三个感知面共享 `useNotifications`——铃铛、首页待办区、（部分）内联告警从同一份通知数据派生。改一处，三处生效。

## §1 通知中心组件（`NotificationCenter`）

### 1.1 铃铛
- 位于 AppShell 头部、用户头像左侧。
- Lucide `Bell` 图标。
- 未读 > 0 时右上角红色数字徽标（`>99` 显示 `99+`）。
- 现有侧边栏 badge 轮询（30s）**统一收口**到 `useNotifications`，app-shell 不再各自 fetch。

### 1.2 下拉面板
点击铃铛展开，点击外部关闭（含焦点管理，见 §6 可达性）。

**结构**：
- 顶部：标题「通知」+ 未读数 + 「全部已读」操作。
- **分段标签**：「待办 N」「全部」。
  - **待办**：`actionable: true` 的通知置顶。每条含：
    - 左侧语义色条（按 tone）
    - 类型标签胶囊（如「4天后」「待审核」）
    - 标题 + 副内容 + 相对时间
    - 「去处理 →」深链按钮（用 `link` 字段跳转）+ 「稍后」
    - 已处理的待办半透明折叠在下方分组。
  - **全部**：按时间倒序的全部通知。
- 底部：「查看全部通知 →」跳 `/notifications` 整页（提供完整列表 + 分页，复用下拉的数据 hook）。

### 1.3 类型 → 图标 / 可操作性映射

替换 `packages/shared/constants.ts` 中 `NOTIFICATION_ICON` 的 emoji（违反 .impeccable.md「禁用 emoji 作图标」），改为 Lucide 图标名 + tone + actionable 三元组：

| type | Lucide 图标 | tone | actionable | 深链示例 |
|---|---|---|---|---|
| `SUPPLIER_APPROVED` | `CheckCircle2` | green | 否 | — |
| `SUPPLIER_REJECTED` | `XCircle` | red | 否 | — |
| `SUPPLIER_RETURNED` | `RotateCcw` | orange | 否 | — |
| `BID_PUBLISHED` | `FileText` | blue | 否 | `/notice` |
| `BID_REMINDER` | `Clock` | orange | **是** | 招标项目 |
| `SYSTEM` | `Info` | gray | 视内容 | `link` 字段 |
| `SUPPLIER_PENDING`（新增） | `UserCheck` | blue | **是** | `/supplier/approval` |
| `QUALIFICATION_EXPIRING`（新增） | `AlertTriangle` | orange | **是** | 供应商详情 |
| `PRICE_REVIEW`（新增） | `Tag` | purple | **是** | `/mall-management/approval` |

新增的三个 type 需在**通知创建处**（supplier 审批入口、资质到期 cron、catalog 审批入口）补发。

### 1.4 待办生命周期与已读行为

**关键区分**：通知的 `isRead`（用户看过）≠ `resolvedAt`（待办已被处理）。两者独立。

- **`isRead`**：用户打开下拉或点「去处理」即标记已读，控制铃铛红点。
- **`resolvedAt`**：待办**对应的动作完成**时由后端写入，控制是否留在「待办」分段。

**待办生命周期**：
1. 后端创建 actionable 通知（如 `SUPPLIER_PENDING`），`resolvedAt = null`。
2. 通知出现在「待办」分段（无论是否已读）。
3. 用户完成动作（如审批通过该供应商）→ 后端在动作服务中 `UPDATE Notification SET resolvedAt = now() WHERE type='SUPPLIER_PENDING' AND link 指向该实体`。
4. 该通知从「待办」分段移除，在「全部」分段中以半透明「已处理」态保留（审计轨迹）。

**模型变更**（后端，小迁移）：`Notification` 增加可空字段 `resolvedAt DateTime?`。nullable，无需回填。

**分段过滤规则**：
- 「待办」 = `actionable == true && resolvedAt == null`
- 「全部」 = 全部通知，`resolvedAt != null` 的渲染为半透明「已处理」

**已读操作**：整页 `/notifications` 支持单条已读 + 批量已读；下拉内点条目或「去处理」标记单条已读。

## §2 数据与实时性

- **轮询**：30s，与现有侧边栏徽标一致，统一到 `useNotifications` 单一 hook。
- **WebSocket**：后端已有 bid 事件 WS 基建；通知实时推送**留作未来增强**，本期不引入（避免过度工程）。
- **actionable 判定**：前端维护 `ACTIONABLE_TYPES` 集合为准；后端通知创建时同步打 `actionable` 标记作双保险（后端标记为后续优化，不阻塞本期）。
- **localStorage 趋势基线**：键 `erp:trend:<userId>:<metricKey>`，每次首页加载写入当日值；`useTrend` 对比最近一次**不同值**计算「比上次 ±N」。仅首页 MetricCard 使用。

## §3 MetricCard 趋势（分阶段）

### 第一阶段（本期）
- `MetricCard` 新增可选 props：`trendDirection: 'up-good' | 'up-bad' | 'neutral'` 与 `trendValue: number`。
- 渲染 `TrendChip` 胶囊：「比上次 +N」，语义着色（up-bad→红 `#e74c3c`，up-good→绿 `#11a874`，neutral→灰 `#8a99ad`），配方向箭头。
- 数据来自 `useTrend`（localStorage 基线）。

### 第二阶段（后端 MetricSnapshot 表就绪后，独立 spec）
- 后端新增 `MetricSnapshot` 表 + 每日 cron 快照关键计数（supplier pending/approved、catalog review、announcement published、expert active）。
- `MetricCard` 叠加 7 日 sparkline（1.5px 细线，语义色，无填充或极淡填充）。

### 语义着色规则（关键约束）
每张卡必须声明 `trendDirection`，颜色按**语义**而非方向：

| 指标 | trendDirection | 含义 |
|---|---|---|
| 待审批 / 待审核 / 价格待复核 | `up-bad` | ↑ = 积压增多 = 坏 |
| 黑名单 / 已停用 | `up-bad` | ↑ = 坏 |
| 资质即将到期 | `up-bad` | ↑ = 坏 |
| 已入库 / 已发布 / 可用专家 | `up-good` | ↑ = 好 |
| 总数 / 本月更新 | `neutral` | 无好坏 |

## §4 首页待办队列（`DashboardTodoPanel`）

- **位置**：`/dashboard`，MetricCard 行与 `DashboardAiPanel` 之间，全宽。
- **内容**：按模块聚合的待办卡片，横向排列：
  - 供应商审批 `N`（tone blue）→「去审批 →」`/supplier/approval`
  - 资质到期 `N`（tone orange）→「查看 →」
  - 价格复核 `N`（tone purple）→「去复核 →」`/mall-management/approval`
  -（可扩展其他模块待办）
- **数据源**：`useNotifications` 的待办集合按模块归类，**与现有 stats API 的 pending/review 双源校验取大值**（确保不漏，因通知可能未及时生成）。
- **空状态**：「今日待办已清零」+ Lucide `CheckCircle2` 图标 + 鼓励文案（正反馈）。
- **粒度**：聚合视图（大数字），不展开逐条——逐条明细留给铃铛下拉和列表页。

## §5 异常主动浮现（内联告警）

在**详情页顶部**插入场景化告警横幅，复用现有 `supplier/[id]` 的 `returnReason`/`rejectReason` 横幅模式，提取为通用 `AlertBanner` 组件。

| 页面 | 告警内容 | 数据来源 |
|---|---|---|
| 供应商详情 `/supplier/[id]` | 资质临期（见下分级）、近 3 次评价均分 < 60 预警、黑名单/停用状态 | `useAlerts(supplierId)` 查询资质 + 评价 |
| 专家详情 `/expert/[id]` | 连续 2 次 D 级评价、退库预警、负荷过载（同时参与 > 3 个未归档项目） | `useAlerts(expertId)` 查询评价 + 分配 |

**资质临期分级**（仅 `validTo` 存在且距到期 < 90 天时显示横幅）：

| 距到期 | 严重度 | tone | 文案前缀 |
|---|---|---|---|
| 已过期 (< 0 天) | 紧急 | red | 「已过期」 |
| < 7 天 | 紧急 | red | 「即将过期」 |
| 7–30 天 | 警告 | orange | 「即将到期」 |
| 30–90 天 | 提醒 | orange（淡） | 「注意到期」 |

告警按严重度排序（红 > 橙 > 灰），多条可折叠。

## §6 可达性（预留）
- 下拉面板：焦点陷阱（Tab 不外泄），Esc 关闭，`aria-expanded` / `aria-live`。
- 铃铛：`aria-label="通知 (N 条未读)"`。
- 图标按钮统一补 `aria-label`（顺带修复全站）。

## §7 组件清单与文件结构

### 新增组件（`components/workbench/`）
- `notification-center.tsx` — 铃铛 + 下拉面板
- `dashboard-todo-panel.tsx` — 首页待办区
- `alert-banner.tsx` — 详情页内联告警横幅（通用）
- `trend-chip.tsx` — MetricCard 趋势胶囊

### 新增 hooks（`lib/hooks/`）
- `use-notifications.ts` — 轮询 + 待办/信息性分类 + 未读数 + 全部已读/单条已读
- `use-trend.ts` — localStorage 基线读写 + delta 计算
- `use-alerts.ts` — 实体级告警查询

### 新增页面
- `app/(dashboard)/notifications/page.tsx` — 整页通知（列表 + 分页 + 批量已读），复用 `useNotifications`

### 修改
- `components/app-shell.tsx` — 头部加 `<NotificationCenter />`；移除内联 badge 轮询逻辑（收口到 `useNotifications`）；侧边栏 badge 改读 hook 数据
- `components/workbench/metric-card.tsx` — 加 `trendDirection` / `trendValue` props + 渲染 `TrendChip`
- `app/(dashboard)/dashboard/page.tsx` — MetricCard 行声明 `trendDirection`；插入 `<DashboardTodoPanel />`
- `app/(dashboard)/supplier/[id]/page.tsx` — 顶部加 `AlertBanner`
- `app/(dashboard)/expert/[id]/page.tsx` — 顶部加 `AlertBanner`
- `packages/shared/src/constants.ts` — `NOTIFICATION_ICON` 重构为 `{ icon: string, tone: string, actionable: boolean }` 映射
- **后端**：
  - Prisma schema：`Notification` 增 `resolvedAt DateTime?`（nullable，新迁移）
  - 通知创建处（supplier 注册入口、资质到期 cron、catalog 申请提交入口）— 补发新增 type 通知（`SUPPLIER_PENDING` / `QUALIFICATION_EXPIRING` / `PRICE_REVIEW`），写 `link` 指向对应实体/页面
  - 动作完成处（`approve/reject/returnSupplier`、`reviewCatalogApplication`、资质续期）— 写 `resolvedAt = now()` 关联清除待办（按 `type` + `link` 匹配）

## §8 范围边界（YAGNI — 本期不做）

- ❌ WebSocket 实时推送（留作未来增强）
- ❌ 后端 `MetricSnapshot` 表 + sparkline（第二阶段，独立 spec）
- ❌ 通知偏好设置（邮件/站内信开关）
- ❌ 通知分组免打扰
- ❌ 推送/邮件渠道的前端开关

这些属于"做了更好但非感知层核心"，留给后续主题或独立迭代。

## 验收标准

1. 头部铃铛显示真实未读数（来自 `/api/notifications/unread-count`），30s 自动刷新。
2. 点击铃铛展开下拉，含「待办/全部」分段；待办项有「去处理 →」深链，点击后跳转对应页面并标记已读。
3. 首页 MetricCard 行下方出现待办聚合区，数字与铃铛待办分段一致（双源校验取大值）。
4. 至少 5 张 MetricCard 显示语义着色的「比上次 ±N」胶囊（首次访问无基线时优雅降级为不显示）。
5. 供应商/专家详情页对临期资质/D 级等情况显示顶部告警横幅。
6. `/notifications` 整页可查看全部通知、批量已读、分页。
7. 全站无 emoji 作图标（通知类型全部 Lucide）。
8. 下拉面板支持 Esc 关闭、焦点陷阱、aria 标注。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 通知 type 在创建处未补发，待办区为空 | 双源校验：待办区同时读 stats API 的 pending/review，取大值兜底 |
| localStorage 基线首次访问无数据 | `useTrend` 无基线时返回 `null`，TrendChip 不渲染（优雅降级）|
| 后端 `actionable` 标记未同步 | 以前端 `ACTIONABLE_TYPES` 集合为唯一真相源，后端标记仅作优化 |
| 下拉与整页状态不同步 | 共享同一 `useNotifications` hook，状态单一来源 |
