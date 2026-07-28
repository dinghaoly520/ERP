# 招标文件审查 · 知识库按用户隔离 + 共享选项

- 日期：2026-07-28
- 状态：已确认，待实现
- 范围：`apps/api`（knowledge + tender-review 模块）、`apps/web`（tender-review 组件）

## 背景与目标

当前 `KnowledgeBase` 无 `userId`/owner 字段，`GET /api/knowledge` 不按用户过滤 → 知识库**全系统通用**，任何 leader/admin/staff 都能读写全部 KB。审查任务（`ReviewTask`）则已按用户隔离。

目标：
1. **按用户隔离**——每人默认只能看到/使用自己创建的 KB。
2. **共享选项**——KB 可标记为共享；共享后所有人都能「使用」（可见、跑审查、只读看规则），但**编辑维护仅创建者**（+ admin 兜底）。

## 已确认决策（2026-07-28 与用户对齐）

| 决策点 | 选择 |
|--------|------|
| admin 是否兜底维护 | **创建者 + admin**（admin 作为超管可维护任意 KB，防创建者离职死锁） |
| 现有 KB 处置 | **清空重来**（删除现有 1 KB / 7 文件 / 60 向量块 / 390 规则；审查历史 `ReviewTask` 因可空外键 SetNull 而保留） |
| 非创建者对共享 KB 的「使用」边界 | **可见 + 跑审查 + 规则清单只读**（文件管理不可见） |
| 非创建者前端编辑入口 | **直接隐藏**「文件管理/规则管理/删除」 |

## 数据模型变更（`apps/api/prisma/schema.prisma`）

`KnowledgeBase` 增两个字段：
```prisma
model KnowledgeBase {
  id          String   @id @default(cuid())
  name        String
  description String?
  ownerId     String                // 创建者；普通列，不挂 FK（最小改动，不碰 User 模型）
  isShared    Boolean   @default(false)  // 共享：所有人可「使用」，维护仅创建者(+admin)
  isActive    Boolean   @default(true)
  ...  // 其余不变
}
```
> `ownerId` 用普通 `String`、不加 `@relation`，避免改动 `User` 模型 + 跨模型迁移风险。引用完整性由应用层保证（本系统用户不会硬删）。

## 权限矩阵

| 操作 | 谁可做 | 后端校验 |
|------|--------|---------|
| 看（列表 KB / 详情 / 规则清单只读 / 跑审查 execute） | 创建者 **或** `isShared=true` **或** admin | `assertVisible(kbId, user)` |
| 维护（建 KB / 上传删文件 / 提取规则 / 增删改规则 / reindex / 删 KB / 改 KB 信息或共享） | 创建者 **或** admin | `assertEditable(kbId, user)` |

- `assertVisible`：`kb.ownerId === user.id || kb.isShared || user.role === 'admin'`，否则 `ForbiddenException`。
- `assertEditable`：`kb.ownerId === user.id || user.role === 'admin'`，否则 `ForbiddenException`。
- 二者都先 `findUnique`，不存在 → `NotFoundException`。

## 后端改动

### `apps/api/src/knowledge/`
- `knowledge.service.ts`
  - 加 `assertVisible(kbId, user)` 与 `assertEditable(kbId, user)`（集中校验，避免散落）。
  - `findAll(user)`：`where = user.role==='admin' ? { isActive:true } : { isActive:true, OR:[{ ownerId: user.id }, { isShared: true }] }`。
  - `create(dto, user)`：`ownerId = user.id`，`isShared = dto.isShared ?? false`。
  - `findOne(id, user)`：取后 `assertVisible`。
  - `update(id, dto, user)`：**新增**（用于改 name/description/isShared）→ `assertEditable`。
  - `remove(id, user)` / `uploadFile(id, file, user)` / `deleteFile(id, fileId, user)` / `reindex(id, user)`：`assertEditable`（deleteFile 还需校验文件属于该 KB）。
- `knowledge.controller.ts`
  - 各方法加 `@CurrentUser() user`，把 user 传进 service。
  - 新增 `@Patch(':id')` → `update`（owner/admin 改 name/description/isShared）。
  - `@Roles('leader','admin','staff')` 类级保留。
- `dto/knowledge.dto.ts`
  - `CreateKnowledgeBaseDto` 加 `isShared?: boolean`。
  - 新增 `UpdateKnowledgeBaseDto`（`name?`、`description?`、`isShared?`）。

### `apps/api/src/tender-review/tender-review.controller.ts`
注入 `KnowledgeService`（或直接用 Prisma + 本地校验 helper）做属主校验：
- `GET /rules?knowledgeBaseId=`：`assertVisible`（规则清单只读对共享开放）。
- `POST /rules/extract`、`POST /rules`、`PUT /rules/:id`、`DELETE /rules/:id`：按 `dto.knowledgeBaseId`（或 rule→kb）`assertEditable`。
- `POST /review/execute`：`assertVisible`（跑审查属于「使用」）。
- `review/upload`（上传待审文件）不涉及 KB，无需校验。
- 现有「审查任务按用户隔离」逻辑（`GET /review/tasks` admin 全量 / 本人）保持不变。

> 校验 helper 复用 `KnowledgeService.assertVisible/assertEditable`，避免重复实现。tender-review.module 已 import KnowledgeModule（见 `tender-review.module.ts`），直接注入即可。

## 前端改动（`apps/web/src/components/tender-review/`）

- 当前用户：`tender-review-context` 拉 `/api/auth/me` 拿 `{ id, role }`，下发给需要的组件。
- `kb-nav-sidebar.tsx`（KB 列表 + 创建表单）
  - 创建表单增「共享」勾选框（绑 `isShared`），提交带 `isShared`。
  - 列表项：共享 KB 加「共享」徽标。
  - 展开项的操作按钮（文件管理/规则管理/删除）：`kb.ownerId !== me.id && me.role !== 'admin'` 时**隐藏**。
  - 加「切换共享」入口（owner/admin，调 `PATCH /api/knowledge/:id`）——可选，v1 可只留创建时勾选；若加则放在展开项里。
- `rules-panel-compact.tsx` / `rules-panel.tsx`
  - 非创建者且非 admin 时：隐藏「AI 提取 / 新增 / 编辑 / 删除」按钮，规则只读展示。
  - `use-tender-review.ts` 的 `extractFromKb` 等写操作：非 owner 前端直接不调（UI 已隐藏）。

## 迁移与割接

新增迁移 `20260728000000_kb_owner_and_shared/migration.sql`：
```sql
ALTER TABLE "KnowledgeBase" ADD COLUMN "ownerId" text;
ALTER TABLE "KnowledgeBase" ADD COLUMN "isShared" boolean NOT NULL DEFAULT false;
-- 清空重来（用户已确认）：级联清 files/chunks/rules；ReviewTask.knowledgeBaseId 走 SetNull 保留历史
DELETE FROM "KnowledgeBase";
ALTER TABLE "KnowledgeBase" ALTER COLUMN "ownerId" SET NOT NULL;
```
应用方式（规避交互 migrate dev 的 reset 风险）：
```
npx prisma db execute --file <migration.sql> --url "$DIRECT_URL"
npx prisma migrate resolve --applied 20260728000000_kb_owner_and_shared
```
割接影响（已向用户明示、不可逆）：删除现有 1 KB / 7 文件 / 60 向量块 / 390 规则；保留 1 条审查任务（kbId 置空）。数据可通过重新上传 + AI 提取重建。

## 验证计划（跨用户实测）

1. leader 建私有 KB → staff 看不到（`GET /knowledge` 不返回）。
2. leader 建共享 KB → staff 能看到、能 `POST /review/execute`、能 `GET /rules` 只读。
3. staff 试图对 leader 的共享 KB 调 `POST /:id/files`、`/rules/extract`、`DELETE` → 403。
4. staff 在前端：共享 KB 展开项无「文件管理/规则管理/删除」入口；规则面板只读。
5. admin 能维护任意 KB（含别人创建的）。
6. 现有审查历史仍可见（`GET /review/tasks` 本人）。

## 非目标

- 不改 `ReviewTask` 的可见性（已按用户隔离）。
- 不给 `ownerId` 加 FK 约束（应用层保证）。
- 不做 KB 的项目级归属（无 projectId）。
- 不做共享 KB 的「部分可见 / 指定人可见」（二元：私有 / 全员共享）。
