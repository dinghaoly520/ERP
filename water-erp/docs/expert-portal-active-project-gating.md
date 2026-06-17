# Plan: 专家门户项目可评审性控制

## Problem Analysis

**实际问题**：专家门户展示了专家被分配到的所有项目（包括 `DOWNLOAD`、`SUBMIT`、`ARCHIVED` 阶段的项目），所有项目卡片均可点击进入评审向导，但向导第一步（身份核验）的后端 API 会对非 `OPENING`/`EVALUATING` 阶段的项目返回错误。专家需要逐个点击项目卡片才能发现哪些是"当前可评审的"——这是一个**信息可发现性（discoverability）问题**。

**核心指标**：专家从打开页面到找到可评审项目所需的**认知步骤数**。当前：查看全部项目 → 逐个点击 → 被拒绝 → 退回 → 尝试下一个。目标：仪表盘一眼可见，零次试错。

**这不是权限问题**——后端 RBAC 和 stage gate 是正确的。这是**展示层和导航层的 UX 缺陷**：系统知道哪些项目可评审，但没有在 UI 上传达给用户。

## First-Principles Breakdown

### 拆解到基本元素

1. **项目有三个状态维度**（对专家而言）：
   - Bid 阶段（`stage`）：系统生命周期——`DOWNLOAD → SUBMIT → OPENING → EVALUATING → ARCHIVED`
   - 专家签到状态（`signedIn`）：专家是否已完成身份核验
   - 专家进度（`progress`）：0–100% 评分完成度

2. **"可评审"的定义**：项目处于 `OPENING` 或 `EVALUATING` 阶段。这是唯一真实的约束——后端在这些阶段之外拒绝所有功能操作。

3. **数据已经存在**：`project.stage` 字段在 API 响应中，前端所有组件都能访问到。不需要新的数据库查询或字段。

### 挑战假设

| 假设 | 挑战 |
|------|------|
| "专家需要看到所有已分配项目" | 为什么？历史项目可以作为单独视图访问。仪表盘的首要任务是引导专家到**当前可操作**的项目。 |
| "需要新建 API 端点" | 不需要。现有的 `/expert/projects` 已经返回 `stage`。问题纯粹是前端如何使用已有数据。 |
| "需要后端 stage gate 来保护项目详情" | 后端 gate 是纵深防御的好做法，但核心问题是前端没有正确使用已有信息做路由决策。 |
| "非活跃项目应完全隐藏" | 这走得太远——专家可能需要回顾历史项目。关键是**区分可操作 vs 只读**。 |

### 真实约束

1. **不改数据库 schema**：不需要 migration
2. **不改 bid 管理端**：开标启动流程不变
3. **不引入新的权限模型**：RBAC 保持原样
4. **前端三个页面需要协调改动**：dashboard、projects list、evaluate wizard
5. **后端改动最小化**：仅 `expert.service.ts` 两个方法

## Proposed Approach

### 核心策略：**前端主导 + 后端辅助**

前端是主要改动面——用已有的 `stage` 数据做展示/导航决策。后端在 `getProject` 加一层纵深防御，防止直接 URL 访问绕过前端守卫。

### 三层防护

```
Layer 1 (展示层): Dashboard 只显示活跃项目，项目列表页用视觉差异区分
Layer 2 (导航层): 非活跃项目卡片不可点击进入向导 / 点击弹出概要 Modal
Layer 3 (数据层): getProject API 对非活跃项目返回受限数据或 403
```

### 具体改动

#### A. 仪表盘 `(app)/page.tsx`
- `projects.filter(p => p.project.stage === 'OPENING' || p.project.stage === 'EVALUATING').slice(0, 5)`
- 无活跃项目时显示引导性空状态
- 活跃项目卡片增加阶段微标

#### B. 项目列表 `(app)/projects/page.tsx`
- 筛选标签改为阶段驱动：`可评审` / `待开标` / `已归档` / `全部`
- 双态卡片：活跃项目完整可点击 / 非活跃项目灰色 + 概要 Modal

#### C. 评审向导 `evaluate/[id]/page.tsx`
- `loadProject` 成功后检查 stage，非活跃则 toast + redirect

#### D. API（纵深防御）`expert.service.ts`
- `getProject`：非活跃返回受限数据 + `restricted: true`
- `listProjects`：按活跃状态排序

## Todo List

### Phase 1：后端纵深防御

- [ ] **Task 1**: `listProjects` — 按活跃状态排序（OPENING/EVALUATING 在前）
- [ ] **Task 2**: `getProject` — 非活跃项目返回受限数据 + `restricted: true`

### Phase 2：项目列表页改造

- [ ] **Task 3**: 筛选标签改为阶段驱动 + 双态卡片渲染
- [ ] **Task 4**: 创建概要 Modal 组件

### Phase 3：仪表盘改造

- [ ] **Task 5**: 仪表盘仅展示活跃项目 + 空状态 + 阶段微标

### Phase 4：向导页面守卫

- [ ] **Task 6**: evaluate 页面检查 stage/restricted → toast + redirect

### Phase 5：验证

- [ ] **Task 7**: 端到端验证所有场景

## Success Criteria

1. **零试错**：专家打开仪表盘，一眼看到所有可评审项目
2. **活跃项目可达**：所有 OPENING/EVALUATING 项目可正常进入评审向导
3. **非活跃项目不可达**：DOWNLOAD/SUBMIT/ARCHIVED 项目无法进入评审向导
4. **非活跃项目可见**：历史/待开标项目仍可在项目列表页查看概要信息
5. **URL 直接访问安全**：手动输入 `/evaluate/<non-active-id>` 被后端 + 前端双重拦截
6. **不改动其他门户**：bid 管理端、supplier 门户等功能不受影响
