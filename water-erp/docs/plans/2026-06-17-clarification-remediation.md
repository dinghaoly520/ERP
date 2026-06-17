# Plan: 澄清答疑功能修复方案

## Problem Analysis

### 核心问题

经过全系统排查，澄清答疑功能存在**三层问题**，按严重程度排列：

1. **致命 Bug**：专家门户前端调用错误的 API 端点（`/bid/projects/.../clarifications` 而非 `/expert/projects/.../clarifications`），因 `BidController` 的类级别 `@Roles('admin', 'bid_host', 'procurement_staff')` 不含 `bid_expert`，会导致 **403 Forbidden**

2. **架构缺失**：供应商完全不能发起答疑（提问）——这与中国招投标法的基本要求相悖。投标人（供应商）在投标期间应该能够就招标文件提出书面疑问

3. **数据模型缺陷**：`supplierName` 为纯字符串（非外键）、无 `type` 字段区分澄清/答疑、无公示机制

### 我们优化什么

- **正确性优先**：系统行为必须匹配实际招投标业务流程
- **最小变更**：不重构已有可工作的部分（bid-portal 管理端 CRUD 正常、WebSocket 正常）
- **一致性**：遵循项目现有的 NestJS + Next.js/Vue 3 模式

---

## First-Principles Breakdown

### 去除假设，回归本质

**澄清答疑的本质是什么？** 招投标过程中两方之间的**书面沟通记录**。拆解到最基本要素：

```
一条记录 = 谁发起 + 对哪个项目 + 涉及哪个供应商 + 问了什么 + 回答了什么 + 状态
```

所有复杂功能（类型区分、公示、截止时间、归档）都是这个核心模型的衍生。

### 真正的约束

| 约束 | 类型 | 影响 |
|------|------|------|
| 已有生产数据 | 真实 | 数据模型变更需要 migration，可能影响已有记录 |
| 多角色权限体系 | 真实 | supplier 角色不能访问 bid controller 的端点 |
| 三个前端框架 | 真实 | Next.js (bid/expert) + Vue 3 (supplier)，需分别修改 |
| "供应商需能提问"是法定要求 | 真实 | 必须实现，否则系统不完整 |
| supplierName 弱关联 | 已知债务 | 已有文档记录，本次可以作为增强处理 |

### 什么不需要做

- **不需要** 重构整个 bid 模块
- **不需要** 建设多轮问答嵌套（回复已足够）
- **不需要** 实时推送供应商提问（WebSocket 已存在，可以复用）
- **不需要** 邮件/短信通知（超出范围）

---

## Proposed Approach: 分层修复

选择**渐进式修复**策略：先修 Bug，再补功能，最后加固数据模型。每一层都可以独立交付和验证。

```
Phase 1 (Bug Fix)     → Phase 2 (Supplier QA)  → Phase 3 (Data Model)
   修复专家 403            供应商可以提问             FK + 类型字段
   ~3 files               ~6 files                  ~5 files
```

### 为什么不一次性重做

- Phase 1 解决的是**用户可见的故障**，应该最优先交付
- Phase 2 是**功能补全**，有独立的业务价值
- Phase 3 是**数据质量提升**，可以滞后，不影响功能
- 分层降低回归风险，每层可独立测试

---

## Alternative Approaches Considered

### 方案 A：最小修复（只修 Bug）

只改 expert 前端的两行 API 调用路径。

| 优点 | 缺点 |
|------|------|
| 5 分钟工作量 | 供应商仍无法提问 |
| 零风险 | 系统功能不完整 |
| | 硬编码 `supplierName: '评标委员会'` 未修复 |

**不推荐**：虽然最"简单"，但它解决的只是表面症状，核心功能缺失仍然存在。

### 方案 B：Bug 修复 + 供应商答疑（推荐）

修复 Bug + 添加供应商提问能力 + 加 `type` 字段。

| 优点 | 缺点 |
|------|------|
| 解决 403 和功能缺失两个核心问题 | 需要修改 3 个前端框架 |
| 数据模型变更最小（仅加 1 个字段） | supplierName 弱关联暂时保留 |
| 每层可独立验证 | |

### 方案 C：完整重构

重新设计数据模型（FK 关联、type、publishedAt、deadline、archiveId）+ 全部功能重做。

| 优点 | 缺点 |
|------|------|
| 模型最完整 | 涉及 migration、破坏性变更 |
| 一次性解决所有已知问题 | 风险高、工作量大 |
| | 当前系统用户量小，过度设计不划算 |

**结论：选择方案 B**，它解决了核心问题，同时保持变更范围可控。

---

## Todo List

### Phase 1 — Bug Fix（紧急）

- [ ] **Task 1.1**: 修复专家前端 API 调用路径
  - 文件：`apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`
  - 行 283：`/bid/projects/${projectId}/clarifications` → `/expert/projects/${projectId}/clarifications`
  - 行 290：`/bid/projects/${projectId}/clarifications` → `/expert/projects/${projectId}/clarifications`

- [ ] **Task 1.2**: 修复专家发起澄清时的硬编码值
  - 文件：同上，行 290
  - `supplierName: '评标委员会'` → 应从项目的 suppliers 列表中选择
  - 需要添加一个供应商选择下拉框（类似 bid-portal 的做法）

- [ ] **Task 1.3**: 修复 expert DTO — 匹配前端实际发送的字段
  - 文件：`apps/api/src/expert/dto/create-expert-clarification.dto.ts`
  - 当前 DTO 只有 `question` 和 `supplierName`，需要检查 expert service 的 `createClarification` 方法是否正确处理

- [ ] **Task 1.4**: 验证 Phase 1
  - 确认专家登录后能正常加载澄清列表
  - 确认专家能成功发起澄清
  - 确认 WebSocket 实时推送仍然正常

### Phase 2 — 供应商发起答疑（重要）

- [ ] **Task 2.1**: 数据库 migration — 添加 `type` 字段
  - 文件：`apps/api/prisma/schema.prisma` → `BidClarification` model
  - 添加：`type String @default("clarification")`（值为 `clarification` | `question`）
  - 执行 `prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`

- [ ] **Task 2.2**: 更新共享类型
  - 文件：`packages/shared/src/types.ts` → `BidClarification` interface
  - 添加：`type: string`

- [ ] **Task 2.3**: 添加供应商提问 API 端点
  - 文件：`apps/api/src/supplier-portal/supplier-portal.controller.ts`
  - 新增：`POST /supplier-portal/bid-projects/:id/questions`
  - 文件：`apps/api/src/supplier-portal/supplier-portal.service.ts`
  - 新增：`createQuestion(supplierId, projectId, dto)` 方法
  - 新增 DTO：`apps/api/src/supplier-portal/dto/create-question.dto.ts`
  - 行为：自动从认证信息填充 `issuer` 和 `supplierName`，`type` = `'question'`

- [ ] **Task 2.4**: 供应商门户前端 — 添加提问 UI
  - 文件：`apps/supplier-portal/src/views/bid/BidDetail.vue`
  - 在"澄清答疑"标签页中添加"我要提问"表单
  - 输入框：问题内容（textarea）
  - 提交按钮，调用新增的 API 端点

- [ ] **Task 2.5**: 管理端适配 — 区分澄清/答疑显示
  - 文件：`apps/bid-portal/src/app/(dashboard)/bid/clarifications/page.tsx`
  - 表格中显示 type 标签（"澄清"/"答疑"）
  - 创建表单可选 type

- [ ] **Task 2.6**: 验证 Phase 2
  - 供应商可提交问题
  - 管理员可在管理端看到供应商的问题并回复
  - 回复后供应商可见

### Phase 3 — 数据模型加固（可选，可延后）

- [ ] **Task 3.1**: supplierName 弱关联改为 supplierId FK
  - schema 变更：添加 `supplierId` 字段关联 `BidSupplier` 或 `Supplier`
  - 需要评估对已有数据的影响
  - 保持 `supplierName` 作为冗余字段（读性能优化）

- [ ] **Task 3.2**: 添加数据迁移脚本
  - 为已有记录回填 `type` 字段

---

## Success Criteria

| 标准 | 验证方法 |
|------|----------|
| 专家能查看和创建澄清 | 专家登录 → 进入评标页 → 打开澄清面板 → 看到列表 → 发起澄清 → 成功 |
| 专家发起澄清不返回 403 | 检查 Network 面板，确认调用 `/expert/projects/.../clarifications` |
| 供应商能提交问题 | 供应商登录 → 进入项目详情 → 澄清答疑标签 → 填写提问 → 提交成功 |
| 管理端能看到供应商的问题 | 管理端 → 澄清答疑页 → 看到供应商提问（type=question）→ 可回复 |
| 已有功能不回退 | 管理端 CRUD 正常、WebSocket 推送正常、供应商只读列表正常 |
