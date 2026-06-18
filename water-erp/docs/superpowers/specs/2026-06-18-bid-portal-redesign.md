# 开评标管理端交互重构设计文档

**日期：** 2026-06-18
**状态：** 设计中（待评审）

---

## 1. 背景与问题

当前开评标管理端（`bid-portal`，:3007）存在以下交互问题：

| 问题 | 详情 |
|------|------|
| 流程倒置 | 用户先进页面，后在右上角手动选项目；应该先选项目，再看对应视图 |
| 无共享状态 | 每页独立调用 `useBidProjects()` + `ProjectSelector`，导航即丢失选择；URL `?projectId=X` 被发送但被忽略 |
| 侧边栏破坏上下文 | 点击侧边栏 `router.push(path)` 不带任何项目参数，目标页重新自动选第一个项目 |
| 无阶段过滤 | 所有项目（含 DOWNLOAD/SUBMIT 阶段）无差别出现在各页面下拉框 |
| 重复 API 请求 | `useBidProjects` 和 `ProjectSelector` 各自独立请求 `GET /api/bid/projects` |
| 项目列表不可搜索 | 下拉框是原生 `<select>`，没有搜索/分类/阶段标签 |

## 2. 设计目标

1. **项目优先**：先选项目，再进入工作台查看各子模块
2. **层级清晰**：URL 路由反映项目层级 `/bid/project/[id]?tab=xxx`
3. **快速定位**：全局搜索选择器 + 最近项目，秒级跳转
4. **阶段过滤**：只有 ≥ OPENING 阶段的项目才出现在选择器中
5. **消除冗余**：删除每个页面的独立项目选择逻辑，集中管理项目上下文

## 3. URL 与路由架构

### 新路由表

| 路由 | 页面 | 说明 |
|------|------|------|
| `/bid` | 开评标总览 | 多项目仪表盘表格 + 阶段分布统计（保持现有） |
| `/bid/project/[id]` | 项目工作台 | Tab 容器，默认根据阶段打开对应 Tab |
| `/bid/project/[id]?tab=open` | — | 开标大厅 Tab |
| `/bid/project/[id]?tab=standard` | — | 评分标准 Tab |
| `/bid/project/[id]?tab=supervise` | — | 监督端 Tab |
| `/bid/project/[id]?tab=evaluate` | — | 评标端 Tab |
| `/bid/project/[id]?tab=clarify` | — | 澄清答疑 Tab |
| `/bid/archive` | 归档端 | 多项目归档汇总（保持独立，不依赖项目选择） |

### 路由迁移映射

| 旧路由 | 新路由 |
|--------|--------|
| `/bid` | `/bid`（不变） |
| `/bid/open` | `/bid/project/[id]?tab=open` |
| `/bid/standard` | `/bid/project/[id]?tab=standard` |
| `/bid/supervise` | `/bid/project/[id]?tab=supervise` |
| `/bid/evaluate` | `/bid/project/[id]?tab=evaluate` |
| `/bid/clarifications` | `/bid/project/[id]?tab=clarify` |
| `/bid/archive` | `/bid/archive`（不变） |

## 4. 侧边栏重新设计

### 当前（7 项平铺）
```
📊 开评标总览     📋 评分标准     🔓 开标大厅
🛡 监督端         ✅ 评标端       📦 归档端
💬 澄清答疑
```

### 新设计（精简两级）
```
┌──────────────────────────────────┐
│                                  │
│  ┌────────────────────────────┐  │
│  │ 🔍 输入项目编号或名称... ▼ │  │  ← 全局项目搜索选择器
│  └────────────────────────────┘  │
│                                  │
│  最近访问                        │
│  ● SC-2026-003 供水管网工程     │  ← 点击直接进入工作台
│  ● SC-2026-001 蜀水大坝工程     │
│  ● SC-2026-007 污水处理站       │
│  ─────────────────────────────  │
│  📊 开评标总览                  │  ← 回到多项目仪表盘
│  📦 归档端                      │  ← 独立的归档汇总
│                                  │
└──────────────────────────────────┘
```

### 行为规则
- **全局选择器**始终在侧边栏顶部
- **最近项目**：从 `localStorage` 读取，最多 5 条；无记录时不显示此区域
- **开评标总览**：始终显示，高亮当路由为 `/bid` 时
- **归档端**：始终显示，高亮当路由为 `/bid/archive` 时
- 项目工作台页面（`/bid/project/[id]`）**不**高亮任何侧边栏项
- 项目内导航完全由页面内 Tabs 处理

## 5. 项目工作台页面设计

### 布局结构

```
┌──────────────────────────────────────────────────┐
│  ← 返回总览    SC-2026-001  蜀水大坝供水工程      │
│  阶段：开标中  |  供应商：5家  |  专家：7人        │
├──────────────────────────────────────────────────┤
│  [🔓 开标大厅] [📋 评分标准] [🛡 监督端]         │
│  [✅ 评标端]   [💬 澄清答疑]                     │
├──────────────────────────────────────────────────┤
│                                                    │
│              （当前 Tab 内容区域）                  │
│                                                    │
└──────────────────────────────────────────────────┘
```

### 顶部信息条
- **返回按钮**：`← 返回总览` — `router.push('/bid')`，浏览器后退也应回到 `/bid`
- **项目信息**：`{projectCode} — {name}`，从 Context 获取
- **元数据行**：阶段（带颜色标签）、供应商数量、专家数量

### Tab 导航
- 5 个 Tab：开标大厅、评分标准、监督端、评标端、澄清答疑
- 当前 Tab 以 `?tab=xxx` 反映在 URL（使用 `useSearchParams` 或 `router.replace`）
- 切换 Tab 不触发整页刷新 — 纯客户端切换 `<TabPanel>`
- WebSocket 连接在项目工作台挂载时建立，在所有 Tab 间共享，离开工作台时断开

### 默认 Tab 逻辑
| 项目阶段 | 默认 Tab |
|----------|----------|
| `OPENING` | `open`（开标大厅） |
| `EVALUATING` | `evaluate`（评标端） |
| `ARCHIVED` | `archive`（或直接跳转到归档端） |
| 其他 | `open`（开标大厅） |

### 阶段不匹配时的 Tab 呈现
当项目阶段不满足 Tab 所需阶段时（如项目是 OPENING 阶段，用户切换到评标端 Tab），不显示空白页面，而是显示引导提示：

> "评标尚未开始。当前项目阶段：开标中。请等待开标完成后进入评标阶段。"

各 Tab 的阶段要求（参考 `STAGE_LABEL` 状态机）：
- **开标大厅**：≥ OPENING
- **评分标准**：≥ OPENING（评分标准可在开标前预设）
- **监督端**：≥ OPENING
- **评标端**：≥ EVALUATING
- **澄清答疑**：≥ OPENING

## 6. 全局项目选择器

### 搜索下拉面板

```
┌─────────────────────────────────┐
│  🔍 蜀水                         │  ← 输入过滤
├─────────────────────────────────┤
│  ● SC-2026-001 蜀水大坝工程      │
│    [开标中]                       │  ← 阶段标签
│  ● SC-2026-005 蜀水新区供水      │
│    [评标中]                       │
│  ─────────────────────────      │
│  未找到更多匹配项目               │
└─────────────────────────────────┘
```

### 技术细节
- **数据源**：`GET /api/bid/projects?stage[]=OPENING&stage[]=EVALUATING&stage[]=ARCHIVED`
- **搜索过滤**：前端 `includes` 匹配项目编号和名称（大小写不敏感）
- **防抖**：输入 300ms 防抖（若项目数 < 100 也可直接本地过滤）
- **键盘导航**：↑↓ 移动高亮，Enter 选中，Esc 关闭
- **加载态**：`正在加载项目列表...`
- **空态**：`暂无可操作的项目`（当无 ≥ OPENING 项目时）
- **错误态**：`加载失败，点击重试`

### 最近项目
- **存储**：`localStorage` key = `bid-recent-projects`
- **数据结构**：`[{ id, projectCode, name, accessedAt }]`
- **更新时机**：每次进入 `/bid/project/[id]` 时写入（或更新 `accessedAt`）
- **最大条数**：5
- **排序**：按 `accessedAt` 降序
- **悬停 tooltip**：显示完整名称（当名称过长时）
- **移除支持**：悬停时右侧出现 × 按钮，可移除单条记录

## 7. 数据流与状态管理

### React Context：`BidProjectProvider`

```tsx
// 在 (dashboard)/layout.tsx 中包裹所有子页面
<BidProjectProvider>
  <AppShell>
    {children}
  </AppShell>
</BidProjectProvider>
```

```ts
// 类型定义
interface BidProjectContextValue {
  // 从 URL path 提取，工作台页面非空
  projectId: string | null;
  // 项目详情（含阶段、供应商数、专家数等）
  project: BidProjectDetail | null;
  // 加载态
  isLoading: boolean;
  // 错误
  error: string | null;
  // 重新获取
  refetch: () => void;
}
```

### 数据流时序

```
用户点击总览表格行 / 侧边栏最近项目 / 搜索选中
  │
  ▼
router.push('/bid/project/SC-001?tab=open')
  │
  ▼
BidProjectProvider 检测到 useParams().id 变化
  │
  ▼
useEffect([id]) → GET /api/bid/projects/${id}
  │
  ├─ 成功 → setProject(data) → 所有 Tab 通过 useContext 读取
  │
  └─ 失败 → setError(msg) → 页面显示错误 + 重试按钮
  │
  ▼
写入 localStorage 最近项目
```

### API 请求优化

| 优化项 | 前 | 后 |
|--------|----|----|
| 项目列表请求数 | 每个子页面 2 次（`useBidProjects` + `ProjectSelector`） | 仅在全局选择器展开 / 总览页请求 |
| 项目详情请求数 | 每页 1 次（各页独立 `useEffect([projectId])`） | 整个工作台 1 次（Provider 集中请求） |
| 选择器过滤 | 无（全量返回） | API 端阶段过滤，减少无效数据传输 |

### 删除的代码

- `src/hooks/use-bid-projects.ts` — 不再需要（每个页面独立的项目列表 + 选择状态）
- `src/components/project-selector.tsx` — 重构为新的全局搜索组件
- 每个子页面的 `<ProjectSelector>` 渲染 — 不再需要
- 每个子页面的 `useBidProjects()` 调用 — 不再需要

### 新增的代码

- `src/components/global-project-search.tsx` — 全局搜索下拉
- `src/components/recent-projects.tsx` — 最近项目列表
- `src/contexts/bid-project-context.tsx` — 项目 Context Provider
- `src/app/(dashboard)/bid/project/[id]/page.tsx` — 项目工作台容器
- `src/app/(dashboard)/bid/project/[id]/components/project-header.tsx` — 顶部信息条
- `src/app/(dashboard)/bid/project/[id]/components/project-tabs.tsx` — Tab 导航
- `src/lib/storage.ts` — localStorage 工具函数（最近项目读写）

## 8. API 变更

### `GET /api/bid/projects` — 新增阶段过滤参数

**当前：**
```
GET /api/bid/projects
→ 返回所有项目
```

**新：**
```
GET /api/bid/projects?stage[]=OPENING&stage[]=EVALUATING&stage[]=ARCHIVED
→ 返回指定阶段的项目列表

参数：
  stage[]  Query  string[]  可选  按阶段过滤，多选。不传则返回全部
```

**Controller 变更** (`bid.controller.ts`):
```ts
@Get('projects')
listProjects(@Query('stage') stage?: string | string[]) {
  const stages = stage
    ? (Array.isArray(stage) ? stage : [stage])
    : undefined;
  return this.bidService.listProjects(stages);
}
```

**Service 变更** (`bid.service.ts`):
```ts
listProjects(stages?: string[]) {
  const where = stages?.length
    ? { stage: { in: stages } }
    : {};
  return this.prisma.bidProject.findMany({
    where,
    select: { id: true, projectCode: true, name: true, stage: true },
    orderBy: { updatedAt: 'desc' },
  });
}
```

## 9. 归档端

归档端保持独立路由 `/bid/archive`，不依赖项目选择：

- 显示所有项目归档状态汇总表格（项目编号、名称、归档状态、缺失项、操作）
- 无需先选项目 — 批量查看、批量操作
- 每个项目行的"查看详情"按钮 → 跳转到 `/bid/project/[id]?tab=archive`（可选：未来在项目工作台中添加归档 Tab）
- 侧边栏"归档端"高亮

## 10. 总览页（开评标总览）维持

`/bid` 页面基本保持不变：

- 多项目表格 + 阶段分布统计
- 表格行点击 → `router.push('/bid/project/${id}')`
- 表格中"操作"列按钮 → 跳转到对应工作台 Tab
- 无需 ProjectSelector
- 侧边栏"开评标总览"高亮

## 11. 边界情况与错误处理

| 场景 | 处理 |
|------|------|
| 项目 ID 不存在 | Provider 返回 error，页面显示"项目不存在" + 返回总览按钮 |
| 项目阶段 < OPENING | 不应出现（选择器已过滤），若通过 URL 直接访问则显示"项目尚未进入开评标阶段" |
| 网络错误 | 显示"加载失败，点击重试"，保留上次成功数据 |
| 最近项目指向已删除项目 | 进入工作台后 API 返回 404 → 从 localStorage 移除该条 |
| 无可用项目 | 选择器显示"暂无可操作的项目"，总览页为空提示 |
| Tab 快速切换 | 已加载的项目详情跨 Tab 复用以避免 loading 闪烁 |
| 浏览器后退 | `/bid/project/[id]` → `/bid` 正常回退 |

## 12. 实施概要

| 阶段 | 内容 |
|------|------|
| Phase 1 | API：`GET /api/bid/projects` 新增阶段过滤 |
| Phase 2 | 新建 Context + Provider + localStorage 工具 |
| Phase 3 | 新建项目工作台容器（`/bid/project/[id]`）+ Tab 组件 |
| Phase 4 | 重构侧边栏：全局选择器 + 最近项目 + 精简导航 |
| Phase 5 | 重构总览页（表格行点击 → 工作台链接） |
| Phase 6 | 归档端路由确认 + 调整 |
| Phase 7 | 清理：删除旧 `useBidProjects`、`ProjectSelector`、旧路由页面 |
| Phase 8 | 测试：功能遍历 + 边界情况验证 |

## 13. 未涉及范围

- 专家门户（`:3006`）— 本次不修改
- 供应商门户（`:3004`）— 本次不修改
- 采购管理工作台（`:3005`）— 本次不修改
- AI 辅助评标模块 — 本次不修改（后续可作为评标端 Tab 内的子功能）
