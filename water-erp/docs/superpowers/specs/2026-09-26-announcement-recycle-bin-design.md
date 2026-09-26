# 公告回收站体系（隐藏 / 下架 / 恢复）设计

日期：2026-09-26
范围：:3005 公告发布中心 + apps/api 公告域
拍板：回收站可查看+可恢复（B）；全系统公告 UI 不再保留任何删除入口（A）

## 1. 语义定义

| 动作 | 适用状态 | 效果 |
|---|---|---|
| 隐藏 hide | 任意状态（DRAFT/PUBLISHED/ARCHIVED） | 从主列表与公开门户移除，进回收站，status → `HIDDEN` |
| 下架 offline | 仅 `PUBLISHED` | 撤下已上架公告，从主列表与公开门户移除，进回收站，status → `OFFLINE` |
| 恢复 restore | HIDDEN / OFFLINE | 恢复到进回收站前的原状态（`metadata.recycle.from`），清除回收标记 |

- 区别只在动作语义与回收站徽标；两者对公开门户的可见性效果一致（均不可见）。
- 回收站**无清空按钮**，UI 不提供任何永久删除公告的入口。

## 2. 数据模型（需迁移）

- Prisma `AnnouncementStatus` 枚举新增 `HIDDEN`、`OFFLINE`（`apps/api/prisma/schema.prisma`，migrate）。
- 原状态与回收信息存 `metadata.recycle = { from, action, at, by }`：
  - `from`：进回收站前状态（restore 依据）
  - `action`：`'HIDDEN' | 'OFFLINE'`（回收站原因徽标）
  - `at`：进入时间 ISO；`by`：操作人名
  - 后端**合并写入**（保留其余 metadata 键）；restore 后删除该键。
- 操作历史 `announcement_histories.action` 为 String 列，直接扩展 `HIDE` / `OFFLINE` / `RESTORE`，无需迁移。

## 3. API（apps/api/src/announcement）

新端点（角色与公司隔离同 `update`：admin/bid_host/leader/staff + `assertAnnouncementScope`）：

- `POST /announcements/:id/hide` — 任意状态 → HIDDEN；已在回收站（HIDDEN/OFFLINE）→ 409
- `POST /announcements/:id/offline` — 仅 PUBLISHED，否则 409 → OFFLINE
- `POST /announcements/:id/restore` — 读 `metadata.recycle.from`（缺失兜底 DRAFT）恢复并清除标记；非回收态 → 409

三者均写操作历史（HIDE/OFFLINE/RESTORE），复用现有 history.write。

既有端点调整：

- `AnnouncementService.list()`：
  - 无 `status` 参数时默认 `status: { notIn: ['HIDDEN', 'OFFLINE'] }`（主列表不见回收站内容）
  - `status` 支持逗号分隔多值（与 `type` 既有逗号语义一致）；回收站传 `status=HIDDEN,OFFLINE`
- `DELETE /announcements/:id`（硬删除）**保留**，但 UI 全面停用。

## 4. 前端（apps/web）

`src/lib/api/announcement.ts`：

- `AnnouncementStatus` 增加 `'HIDDEN' | 'OFFLINE'`
- 新增 `hideAnnouncement` / `offlineAnnouncement` / `restoreAnnouncement`
- `AnnouncementHistoryAction` 增加 `'HIDE' | 'OFFLINE' | 'RESTORE'`

`(main)/notice/page.tsx`（列表页）：

- 行操作：`删除` → `隐藏`（全部行，带确认）；新增 `下架`（仅 PUBLISHED 行，带确认）
- 批量栏：`删除` → `隐藏`；新增 `下架`（仅对选中项中的 PUBLISHED 生效）
- page-hero 右上角（与"公告历史/新建信息"并排）新增 **回收站** 按钮
- `statusMeta` 补 HIDDEN（已隐藏）/OFFLINE（已下架）映射（编译必需；状态筛选下拉不新增选项，回收站是唯一入口）
- 删除 `remove()`（含 4 秒撤销 toast 的乐观删除逻辑）与 `runBatch('delete')` 分支

新增回收站 Modal（新组件 `src/components/notice/announcement-recycle-modal.tsx`）：

- `listAnnouncements({ status: 'HIDDEN,OFFLINE', ... })` 拉取；15 条/页分页
- 列：标题 / 类型徽标 / 原因徽标（隐藏|下架，取 `metadata.recycle.action`）/ 进入时间（`at`）/ 操作人（`by`）/ 操作：**查看**、**恢复**
- 恢复 → `restoreAnnouncement` → 刷新回收站与主列表；**无清空按钮**
- 查看 → 大 Modal 内嵌 `<iframe src="/notice/{id}">` —— 正常公告详情页原样渲染在窗口中

`(main)/notice/[id]/page.tsx`（详情页）：

- `删除` 按钮 → `隐藏`（status 为 HIDDEN/OFFLINE 时禁用——已在回收站）
- status 为 HIDDEN/OFFLINE 时隐藏"编辑"按钮（只读查看，恢复只走回收站，避免编辑态状态下拉绕过体系）
- `statusLabel/statusTone` 补 HIDDEN/OFFLINE；编辑态状态下拉保持 DRAFT/PUBLISHED/ARCHIVED 三态

`announcement-history-modal.tsx`：action 过滤补 HIDE/OFFLINE/RESTORE 选项与标签。

## 5. 不改动的部分

- 公开门户 / 供应商门户：`publicList` 仅出 PUBLISHED、`getPublic` 拒绝非 PUBLISHED —— 隐藏/下架后列表与直链均自动不可见，零改动。
- 后端 `AnnouncementService.remove()` 硬删除逻辑保留（仅收 UI 入口）。

## 6. 构建与验证

- 迁移：schema 改枚举 → `prisma migrate dev`（枚举扩值）→ `prisma generate`
- 后端：改完须 `rm -rf dist` 全量构建（增量常假成功），重启 :4001
- 前端：`next dev` 热更；`next build` 红若是非 expert 存量类型错误则非本次回归
- 测试：后端单测覆盖 hide/offline/restore 流转 + list 默认排除 + offline 仅发布态；前端按既有视觉验证配方截图验证（列表行操作/批量栏/回收站弹窗/iframe 详情/恢复后回列表）
