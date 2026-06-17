# Plan: 专家门户13项差距修复

## Problem Analysis

**核心问题**: 专家门户代码完成度约90%，但因种子数据无活跃项目 + 后端存在4个数据安全/正确性缺陷，当前"登录后一片空壳"。修复目标不是重构架构，而是**以最小改动消除阻断项，使完整评估流程可跑通**。

**真正在优化什么**: 数据正确性 > 安全性 > 功能完整性 > 代码整洁度。这些修复应保持现有代码风格和架构约定，不做过度设计。

## First-Principles Breakdown

挑战几个隐含假设：

1. **种子数据是否需要"真实"数据？** → 不需要。种子数据的唯一目的是让开发者登录后能立即体验完整流程。最小方案：将现有 DOWNLOAD 项目推进到 EVALUATING 并分配专家，而非新建项目。

2. **deleteMany 是必须的吗？** → 不是。Prisma upsert 配合唯一复合索引已覆盖 create/update。deleteMany 是历史遗留，引入笛卡尔积风险且无实际收益。**直接删除，零替代**。

3. **同行评分泄露的修复范围？** → 只影响一个 Prisma include。移除 `experts.scoreRecords`，保留 `experts` 的基本信息（姓名、专业、签到状态等），因为前端需要显示专家在场状态。`myScores` 已单独返回当前专家的评分。

4. **clarifications 端点怎么修最简？** → 当前 `getProject` 的 include 不含 `clarifications`，所以 `listClarifications` 返回 `undefined`。最简修复：在 `getProject` 的 include 中补回 `clarifications`（或在 service 中新建专用方法）。考虑到前端显示澄清列表需要 project 范围内的所有澄清（不是按 supplier 过滤），给 `getProject` 加 `clarifications` include 开销很小（每个项目澄清数通常 <20 条）。

5. **WebSocket 时序问题的本质？** → 通知-写入的顺序不对。但 gateway 注入是 `@Optional()`——如果 gateway 不可用，DB 写入仍成功。所以正确的顺序是：先 DB 写入 → 成功后 gateway 通知。如果 DB 失败抛异常，gateway 不会执行。

## Proposed Approach

**策略**: 按 P0→P1→P2→P3 顺序执行，每批修完即可验证。P0 修完 = 基本可用；P0+P1 = 生产就绪；P0+P1+P2 = 健壮；全部 = 打磨完成。

**关键设计决策**:

| 决策 | 选择 | 理由 |
|------|------|------|
| 种子数据方案 | 修改现有 DOWNLOAD 项目 + 新增 JSON 记录 | 复用已有供应商和文档，减少改动面 |
| deleteMany 处理 | 直接删除，不替代 | upsert 已覆盖，零风险 |
| getProject 同行评分 | 移除 `experts.scoreRecords` include | 最小改动，保留 `experts` 基本字段 |
| 澄清端点 | 在 getProject 中补回 `clarifications` include | 比新建独立 service 方法少改3个文件 |
| DTO @Max(100) | 移除硬上限 | 让 service 的 maxScore 校验成为唯一权威 |

## Alternative Approaches Considered

### 方案A: 新建独立 EVALUATING 项目（vs 修改现有项目）
- **优势**: 不影响现有 DOWNLOAD 项目，数据隔离
- **劣势**: 需新建项目JSON + 文档绑定 + 供应商关联，改动面大
- **选择**: 修改现有 DOWNLOAD 项目，改动 4 个 JSON 文件即可

### 方案B: 用 @ResolveField + 按需查询替代 getProject include
- **优势**: GraphQL 式的按需加载，无过度查询
- **劣势**: NestJS REST 无原生支持，需引入额外库或手动分拆端点
- **选择**: 保持 REST 风格，用多个轻量端点（已有 my-scores 端点），getProject include 只移除敏感的 scoreRecords

### 方案C: 重写整个 expert.service.ts
- **优势**: 一次性解决所有问题
- **劣势**: 风险高、验证成本大、容易引入新 bug
- **选择**: 目标修复，每个 bug 独立改动 1-5 行

## Potential Issues & Edge Cases

1. **种子数据变更后需 `pnpm db:seed` 重跑** — seed 是 TRUNCATE CASCADE，会清空所有数据。需提醒开发者在修复后重跑 seed。
2. **deleteMany 删除后，旧评分残留** — 如果之前有评分记录但新提交不包含该项，记录会保留。但这正是期望行为：专家应该看到所有已提交的评分，而不是被隐式删除。
3. **getProject 移除 scoreRecords 后前端是否受影响** — 前端 evaluate 页面使用的评分数据来自 `myScores`（在 `loadProject` 中 hydrate 到 `scores` state），不依赖 `project.experts[].scoreRecords`。LiveStatusBoard 只读 `expertName`/`signedIn` 等基本字段。**验证后再提交。**
4. **clarifications include 回归** — 需要确认 `getProject` 之前是否有 `clarifications` include、何时移除的。如果是故意移除（性能优化），则需要评估当前方案是否合理。
5. **WebSocket 通知时序** — NestJS 的 `@Optional()` 注入意味着 gateway 可能为 null。修复时需要用可选链 `this.gateway?.notify(...)`。

## Todo List

### P0 阻断级（修完 = 可跑通完整流程）

- [ ] **P0-1: 种子数据——创建活跃评估场景**
  - 修改 `apps/api/prisma/seed-data/BidProject.json`: DOWNLOAD 项目 stage 改为 EVALUATING
  - 修改 `apps/api/prisma/seed-data/BidSupplier.json`: 该项目的2家供应商 decryptStatus 改为 SUCCESS, submitStatus 改为 '已提交'
  - 修改 `apps/api/prisma/seed-data/BidExpert.json`: 新增3条记录（wangjg/liuxm/chenzq 分配到该项目），signedIn=false, avoidanceConfirmed=false, progress=0
  - 新增 `apps/api/prisma/seed-data/BidScoreItem.json`: 为该项目的 projectId 创建5条评分项（资质/符合/商务/技术/价格）
  - 删除 `apps/api/prisma/seed-data/BidScoreRecord.json` 中该3位专家在 ARCHIVED 项目的30条记录（避免混淆），或保持不变（历史数据不影响新评估）

- [ ] **P0-2: 修复 submitScores 笛卡尔积 deleteMany**
  - 文件: `apps/api/src/expert/expert.service.ts` ~322行
  - 操作: 删除整个 `this.prisma.bidScoreRecord.deleteMany(...)` 调用块
  - 保留: `this.prisma.$transaction([...dto.scores.map(upsert)])` 
  - 验证: 调用 `POST /expert/projects/:id/scores` 两次（第二次修改部分分数），确认无数据丢失且只更新了目标记录

- [ ] **P0-3: 修复 getProject 泄露同行评分**
  - 文件: `apps/api/src/expert/expert.service.ts` getProject 方法
  - 操作: 在 `experts` include 中移除 `scoreRecords: { include: { scoreItem: true } }`
  - 保留: `experts: true`（或保留基本字段如 id/expertName/signedIn/major）
  - 验证: 专家A调用 `GET /expert/projects/:id`，确认响应中 `experts[].scoreRecords` 不存在

- [ ] **P0-4: 修复 getStatistics 空字符串泄露**
  - 文件: `apps/api/src/expert/expert.service.ts` ~61-68行
  - 操作: 在 `const expertName = ...` 之后加 `if (!expertName) return [];`，包裹 recentActivity 查询
  - 验证: 模拟无项目分配的专家调用 statistics 端点，确认 recentActivity 为空数组

### P1 数据安全/公平性（修完 = 生产就绪）

- [ ] **P1-1: submitScores scoreItem 查询加 projectId 过滤**
  - 文件: `apps/api/src/expert/expert.service.ts` ~291行
  - 操作: `where: { id: { in: scoreItemIds }, projectId }`
  - 额外: 如果查到的 items 数量 < scoreItemIds 数量，说明有跨项目注入，应抛 ForbiddenException
  - 验证: 构造请求用其他项目的 scoreItemId，确认 403

- [ ] **P1-2: getReport/confirmReport/getMyScores 补前置校验**
  - 文件: `apps/api/src/expert/expert.service.ts`
  - 操作: 在 `getMyScores`(~399行)、`getReport`(~432行)、`confirmReport`(~503行) 方法开头添加与 `submitScores` 一致的校验块:
    ```typescript
    if (!expert.signedIn) throw new ForbiddenException('请先完成身份核验');
    if (!expert.avoidanceConfirmed) throw new ForbiddenException('请先完成利益冲突回避');
    ```
  - 验证: 未签到专家调用这些端点，确认 403

### P2 改善体验

- [ ] **P2-1: 修复 listClarifications 返回 undefined**
  - 文件: `apps/api/src/expert/expert.service.ts` getProject 方法
  - 操作: 在 `bidProject.findUnique` 的 include 中补回 `clarifications: { orderBy: { createdAt: 'desc' } }`
  - 验证: 前端 evaluate 页面点击"澄清答疑"按钮，确认列表正常加载（不报错）

- [ ] **P2-2: WebSocket 通知移到 DB 写入之后**
  - 文件: `apps/api/src/expert/expert.service.ts`
  - 操作: 在 `signIn`(~144行)、`confirmAvoidance`(~168行)、`confirmReport`(~515行) 三个方法中，将 `this.gateway?.notifyAggregate(...)` / `this.gateway?.notifyExpertPresence(...)` 移到 `await this.prisma.bidExpert.update(...)` 之后
  - 验证: 断网模拟 DB 写入失败，确认 gateway 通知未发送

- [ ] **P2-3: 移除 BatchScoreDto 静态 @Max(100)**
  - 文件: `apps/api/src/expert/dto/batch-score.dto.ts`
  - 操作: 删除 `score` 字段上的 `@Max(100)` 装饰器，保留 `@Min(0)` 和 `@IsNumber()`
  - 或改为 `@Max(9999)` 作为安全网，让 service 的 maxScore 成为业务权威
  - 验证: 提交 score=150 的请求（scoreItem 的 maxScore=200），确认 DTO 层不拦截

### P3 锦上添花

- [ ] **P3-1: 空 scores 数组校验**
  - 文件: `apps/api/src/expert/expert.service.ts` submitScores 方法
  - 操作: 在方法开头加 `if (!dto.scores || dto.scores.length === 0) throw new BadRequestException('评分列表不能为空');`
  - 验证: 提交空 scores 数组，确认 400

- [ ] **P3-2: supplierName 审计日志验证**
  - 文件: `apps/api/src/expert/expert.service.ts` submitScores 写入审计日志处
  - 操作: 用 `activeSupplierRecord.supplierName`（已查询到）替代 `dto.supplierName`，或移除 DTO 中的 supplierName 字段
  - 如果从 DTO 移除，需同步修改 batch-score.dto.ts（supplierName 改为可选或移除，确认前端传值不变）
  - 验证: 审计日志中的 supplierName 与数据库一致

- [ ] **P3-3: 前端 useEffect 依赖优化**
  - 文件: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`
  - 操作: 
    - `loadProject` 的 `useCallback` 依赖数组中移除 `activeSupplier`，改为用 ref 存储
    - 拆分为 `loadProject()` (仅加载项目，不依赖 activeSupplier) 和 `syncActiveSupplier()` (设置默认供应商)
    - `useEffect(() => { loadProject(); }, [loadProject])` 只在 projectId 变化时触发
  - 验证: 在 evaluate 页面切换供应商不触发完整项目重新加载，Network 面板无额外的 `/expert/projects/:id` 请求

- [ ] **P3-4: WebSocket 实时事件集成**
  - 前端已连接 WebSocket 并接收事件（`useExpertWebSocket`），但事件仅追加到 `liveEvents` 数组用于 LiveStatusBoard 展示
  - 操作: 
    - 当收到 `signed_in` 事件时，自动刷新项目数据（其他专家签到影响在场状态）
    - 当收到 `report_confirmed` 事件时，在评分页显示 toast 提示
    - 当收到 `decrypt_status` 变化时，自动刷新文档列表
  - 验证: 两个浏览器分别登录不同专家，一人签到后另一人的 evaluate 页面实时更新

## Success Criteria

1. **完整流程可跑通**: 使用种子账号 wangjg 登录 → 看到活跃项目 → 完成身份核验（手机验证+签到+保密+回避）→ 查看标书 → AI辅助评标 → 打分提交 → 确认报告。全流程无报错。
2. **API 响应正确**: `GET /expert/projects/:id` 不再泄露同行评分；`GET /expert/statistics` 在无项目时不泄露监督日志。
3. **评分数据安全**: 重复提交评分不丢数据（无笛卡尔积误删）；跨项目 scoreItemId 被拒绝。
4. **澄清可用**: 前端澄清面板正常加载和发送。
5. **种子数据可重置**: `pnpm db:seed` 后数据状态一致，所有外键约束满足。
