# 信息发布中心（/notice）重设计

**日期**: 2026-07-06
**范围**: `apps/web` (:3005) 的 `/notice` 列表页（侧边栏「公告管理 → 信息发布中心」）。`/notice/new` 与 `/notice/[id]` 仅做宽度对齐。
**Phase**: 单次交付（宽度修复 + cgzxui 一致化 + 表格 UI/交互重构 + 批量操作 + 页内排序）。

## 背景与问题

`/notice` 当前存在三类问题：

1. **宽度未随侧栏折叠而扩展** — `notice/page.tsx:65` 写死 `<div className="mx-auto max-w-[1440px]">`。侧栏折叠后外层 `<section>` 已 `flex-1` 撑满，但内容被 1440px 上限锁住并 `mx-auto` 居中，两侧留白。
2. **cgzxui 反模式** — 大量硬编码色 `#064ea2 / #5a6d8a / #18243a / #f0f5ff`、`<select>` 内联 `style backgroundImage`、tab/搜索框/分页按钮全是自定义样式而非 `neu-*` 类，违反 cgzxui「单一 CSS 来源、不写内联样式」第一原则。
3. **表格扁平** — 仅 `hover:bg` 无三态；信息密度低（标题单行、附件 emoji+文字、浏览裸数字）；无外壳卡片；空状态/加载/分页裸样式；无选中、无排序。

## 决策记录（用户已确认）

- **宽度方案 A** — 彻底去掉 `max-w-[1440px]` + `mx-auto`，内容永远填满 AppShell main 区。
- **表格力度 B** — 同结构精修 + 行内信息重构 + 批量操作 + 列排序；**不做**卡片视图切换。
- **批量操作** — 客户端 `Promise.all` 扇出（无新增 API 端点）。
- **排序范围** — 前端页内排序（零 API 改动，仅当前页 15 条生效）。
- **共享基类隔离** — 不动 `.workbench-table`（8 个管理页共用），新能力走新 opt-in 类 `.neu-table` + 数据属性。

## §1 宽度修复

`notice/page.tsx:65` 的 `<div className="mx-auto max-w-[1440px]">` → 去掉 `mx-auto max-w-[1440px]`，改为简单包裹（或删该层 div 让内容直接挂在 Fragment 下）。同步检查 `notice/new/page.tsx`、`notice/[id]/page.tsx` 是否有同样 cap，有则一并去掉。

**验收**：折叠侧栏后表格右侧不再留白；展开时表格收窄仍可读。

## §2 cgzxui 一致性清理

| 现状 | 改为 |
|------|------|
| tab 裸 `border-b` + `bg-[#f0f5ff]` + `text-[#064ea2]` | 新 `.neu-tab-bar` / `.neu-tab` / `.neu-tab.is-active` 三态类 |
| 搜索 input 硬编码 `border/focus/shadow` | `.neu-input` |
| `<select>` 内联 `style backgroundImage` | `.neu-select` |
| 分页裸 `border rounded` 按钮 | `.neu-btn-xs` |
| `typeMap/statusMap` 字面色 | 统一走 `var(--brand)` / oklch token；映射表只留 `tone` 关键字，由 StatusBadge 渲染 |

所有新视觉走 globals.css 新类，**不新增内联 `style`**。

## §3 表格重设计（核心）

### 3.1 外壳
表格包进 `.neu-table-card`（`.neu-card` 变体，凸起卡片 + 内高光 + 双影）。card 内三段：工具栏区（tab + 搜索 + 筛选）→ 表格主体 → 分页栏。tab 栏嵌在卡片顶部内凹 well 里，视觉一体。

### 3.2 表头（内凹 + 可排序）
- 表头深内凹（增强版 `.neu-thead` 风格）。
- 可排序列（类型/状态/浏览量/发布日期）加 `data-sortable` + 点击热区，激活时显示 `ChevronUp/Down` 指示器，三态循环 `asc → desc → none`。
- 不可排序列（标题/附件/操作）无指示器。

### 3.3 行三态
`.neu-table tbody tr`：默认微凸、悬停抬升 `translateY(-1px)` + 远投影、**选中内凹**（`data-selected="true"`）。行点击进详情；操作按钮 `stopPropagation`。

### 3.4 列重构

| 列 | 重设计 |
|----|--------|
| ☐ 选择（新增首列） | 24px checkbox，表头全选 |
| 标题 | 两行：上行标题（粗）+ 置顶 chip + 招标公示未上传招标文件警告 chip；下行 meta 副本（发布日期 · 关联项目编号 · summary 前 40 字），灰色小字 |
| 类型 | StatusBadge，tone 化 |
| 状态 | StatusBadge，tone 化 |
| 附件/招标文件 | chip 组：`📎 N` + `🔒 招标文件`（付费加 `(¥)` 角标），无则 `—` |
| 浏览 | `tabular-nums` 等宽数字 |
| 操作 | `.neu-btn-xs`，hover 才显色 |

### 3.5 空状态 / 加载
- 空：`.neu-icon-well` + `FileText` 图标 + 「暂无信息」+ 主按钮。
- 加载：`TableSkeleton`，列宽对齐新结构（含 checkbox 占位）。

## §4 批量操作

- 勾选 ≥1 行 → 表格卡片顶部滑入 `.neu-batch-bar`（玻璃条 + 双影 + 内高光）：「已选 N 条」+ `.neu-btn-xs` 发布/归档/删除 + 取消选择。
- 执行：`Promise.all` 扇出 → 发布=`PUT status=PUBLISHED`、归档=`PUT status=ARCHIVED`、删除=`DELETE`（删除前 `confirm`）。每条独立成败，toast 汇总「成功 X / 失败 Y」。
- 完成：清空选中、`load()` 刷新、batch-bar 滑出。
- 跨页选中不保留（切页清空）；全选只选当前页。

## §5 排序

- 前端页内排序：`[...data.items].sort(comparator)` 发生在 render 前。
- 可排序：发布日期（默认降序）、浏览量、类型、状态。
- 指示器：激活列 `ChevronUp/Down` 14px；非激活可排序列 hover 显淡色 `ChevronsUpDown`。
- 切 tab/状态/搜索/页码时清空 sort。
- 未来全量排序：给 `GET /announcements` 加 `sort` query，前端只改 `listAnnouncements` 入参（本期不做）。

## §6 新增 CSS 类（`apps/web/src/app/globals.css`）

| 新类 | 用途 | 三态 |
|------|------|------|
| `.neu-tab-bar` | tab 容器（内凹 well） | — |
| `.neu-tab` / `.is-active` | 类型 tab | 凸起/抬升/内凹 |
| `.neu-table-card` | 表格外壳卡片 | 凸起（不 hover 抬升，避免抖） |
| `.neu-table` | 新表格基类（不碰 `.workbench-table`） | — |
| `.neu-table tbody tr` / `[data-selected]` | 行 | 凸/抬升/内凹选中 |
| `.neu-table th[data-sortable]` / `[data-sort]` | 可排序表头 | — |
| `.neu-checkbox` | 新拟态 checkbox（泛化 `.login-remember__checkbox`） | 凸/按下/勾选 |
| `.neu-batch-bar` | 批量操作浮条 | 玻璃 + 双影 |

全部走 oklch token、方向性双影、含 `@media (prefers-reduced-motion: reduce)` 降级。

**不动**：`.workbench-table`、`.neu-btn-*`、`.neu-card`、`.neu-input/select`、`.neu-thead`、StatusBadge 组件。

## 影响面

- **改动文件**：`notice/page.tsx`（大改）、`notice/new/page.tsx` + `notice/[id]/page.tsx`（仅去 cap）、`globals.css`（追加 ~6 类块）。
- **零影响**：其他 7 个用 `.workbench-table` 的管理页、共享组件、API。
- **无 Prisma 迁移、无 API 改动**。

## 验收（视觉，截图为准）

1. 折叠侧栏后表格填满，无右侧留白。
2. tab/input/select/分页 全 neu 化，无硬编码色。
3. 表格卡片凸起 + 行三态（悬停抬升 / 选中内凹）。
4. 排序指示器工作（发布日期默认降序）。
5. 勾选后批量操作条滑入，发布/归档/删除可执行并 toast 汇总。
6. 附件列 chip 化、浏览列等宽数字、标题两行结构。
7. 空状态 neu-icon-well。
