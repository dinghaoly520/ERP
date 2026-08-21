# 进行中项目公告删除禁令 · 设计 Spec

> 日期：2026-08-21
> 状态：已实施（feat/announcement-delete-guard）
> 依据：电子招投标合规审查报告（2026-08-19）P0-4；《电子招标投标办法》第49条（任何单位和个人不得伪造、篡改或者损毁电子招标投标活动信息）、第40/42条（应存档）
> 用户决策（2026-08-21 确认，终审裁定）：**SUBMIT 后禁止删除 + 引导**（409 指引先流标/归档）；DOWNLOAD/ABORTED/ARCHIVED 三态可删且仅解关联（不级联、不重置）；权限面不动。

## 1. 目标

1. 阻断「删除已发布招标公告 → 级联销毁进行中项目开标/评分/评标数据」的旁路（P0-4）；
2. 终审裁定（2026-08-21）：删除公告一律不再级联销毁——DOWNLOAD/ABORTED/ARCHIVED 三态仅解关联（风险备注 + 标书解绑），不重置阶段、不删开标/评标产物、不清理 MinIO；
3. 保留无关联公告删除。

## 2. 闸门语义（announcement.service.ts remove()）

| 关联项目 stage | 删除公告行为 |
|---|---|
| SUBMIT / OPENING / EVALUATING | **409 `BID_IN_PROGRESS`**，error：「该项目已进入投标/开标/评标流程，公告不可删除——请先完成流标或归档后再删除公告」；**任何 deleteMany / removeObject / 公告行删除均不发生**（闸门在事务与清理之前） |
| DOWNLOAD | 可删（仅解关联标书，不级联） |
| ABORTED | 仅解关联，不级联，不重置 |
| ARCHIVED | 仅解关联 + 风险注记 |
| 无关联项目 | 照旧删除 |

- 闸门实现：事务前对关联项目做阶段判定——`SUBMIT/OPENING/EVALUATING` 先抛 409（`ConflictException`）；`DOWNLOAD/ABORTED/ARCHIVED` 走仅解关联路径（风险备注追加 + `bidDocument` 解绑，不重置 stage、不级联、不清理 MinIO）；无 project 走原其余路径。**原 stageReset 级联分支（监督日志/五个 deleteMany/供应商专家复位/密封文件收集与 MinIO 清理）已整体删除——死代码**。
- 权限 `@Roles('admin','leader','staff')` 不变（闸门后删除仍可用）。

## 3. 测试（announcement.service.spec.ts）

1. SUBMIT/OPENING/EVALUATING 三阶段 → `rejects.toMatchObject({ response: { code: 'BID_IN_PROGRESS' } })` 且断言：bidOpeningSession/bidOpeningRecord/bidScoreRecord/bidEvaluationResult/bidInvalidBid 的 deleteMany 零调用、minioClient.removeObject 零调用、announcement.delete 零调用；
2. DOWNLOAD 删除 → 可删且仅解关联（零 deleteMany/零 removeObject，风险备注追加）；
3. ABORTED 删除 → 可删且仅解关联、stage 不变（零 deleteMany/零 removeObject，风险备注追加）——原 H3「级联重置」describe 已删除；
4. ARCHIVED 删除可删（解关联）；
5. 无关联公告可删。

## 4. 文档

CLAUDE.md §Announcement 或运维段追加一句（Bash）：「公告删除规则：关联项目进入 SUBMIT 及以后（SUBMIT/OPENING/EVALUATING）→ 409 BID_IN_PROGRESS，须先流标/归档（P0-4，办法第49条不得损毁）；DOWNLOAD/ABORTED/ARCHIVED 可删且仅解关联（不级联）；SUBMIT+ 409 禁令不变。」

## 5. 验收

- 全量单测绿；冒烟：SUBMIT 项目删公告 409 → 项目归档后删公告成功；ABORTED 项目删公告 200 且开标/评分记录仍在（DB 复核）。
