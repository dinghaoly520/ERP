# 进行中项目公告删除禁令 · 设计 Spec

> 日期：2026-08-21
> 状态：已实施（feat/announcement-delete-guard）
> 依据：电子招投标合规审查报告（2026-08-19）P0-4；《电子招标投标办法》第49条（任何单位和个人不得伪造、篡改或者损毁电子招标投标活动信息）、第40/42条（应存档）
> 用户决策（2026-08-21 确认）：**SUBMIT 后禁止删除 + 引导**（409 指引先流标/归档）；DOWNLOAD 维持现有级联复位；权限面不动。

## 1. 目标

1. 阻断「删除已发布招标公告 → 级联销毁进行中项目开标/评分/评标数据」的旁路（P0-4）；
2. 保留 DOWNLOAD 阶段删除公告的既有语义（级联复位无下游数据，H3 注释所述防陈旧数据被棘轮跳步的意图不变）；
3. 保留 ARCHIVED 阶段解关联删除与无关联公告删除。

## 2. 闸门语义（announcement.service.ts remove()）

| 关联项目 stage | 删除公告行为 |
|---|---|
| SUBMIT / OPENING / EVALUATING | **409 `BID_IN_PROGRESS`**，error：「该项目已进入投标/开标/评标流程，公告不可删除——请先完成流标或归档后再删除公告」；**任何 deleteMany / removeObject / 公告行删除均不发生**（闸门在事务与清理之前） |
| DOWNLOAD | 维持现状：级联复位（开标会话/开标记录/评分/评标结果/废标 deleteMany + 供应商/专家复位）+ MinIO 密封文件清理 + 阶段重置 DOWNLOAD + 解关联 |
| ARCHIVED | 维持现状：仅解关联 + 风险注记 |
| 无关联项目 | 照旧删除 |

- 闸门实现：在现有 `if (project)` 块内、`stageReset` 计算处改为三态判定——`SUBMIT/OPENING/EVALUATING` 先抛 409（`ConflictException`）；DOWNLOAD 走原 stageReset=true 分支；ARCHIVED/无 project 走原其余路径。
- 权限 `@Roles('admin','leader','staff')` 不变（闸门后 DOWNLOAD 删除仍可用）。

## 3. 测试（announcement.service.spec.ts）

1. SUBMIT/OPENING/EVALUATING 三阶段 → `rejects.toMatchObject({ response: { code: 'BID_IN_PROGRESS' } })` 且断言：bidOpeningSession/bidOpeningRecord/bidScoreRecord/bidEvaluationResult/bidInvalidBid 的 deleteMany 零调用、minioClient.removeObject 零调用、announcement.delete 零调用；
2. DOWNLOAD 删除回归：级联复位与 MinIO 清理原行为（既有用例保绿）；
3. ARCHIVED 删除可删（解关联）；
4. 无关联公告可删。

## 4. 文档

CLAUDE.md §Announcement 或运维段追加一句（Bash）：「公告删除规则：关联项目进入 SUBMIT 及以后（SUBMIT/OPENING/EVALUATING）→ 409 BID_IN_PROGRESS，须先流标/归档（P0-4，办法第49条不得损毁）；DOWNLOAD 可删并级联复位。」

## 5. 验收

- 全量单测绿；冒烟：SUBMIT 项目删公告 409 → 项目归档后删公告成功。
