# 公告「下架」退役 + 回收站单节化 + 删除留痕闭环（:3005）

**裁定日期**：2026-11-16（用户裁定）
**范围**：纯 `apps/web`（:3005）前端改动；后端零改动。

## 背景与裁定

- 「下架」按钮（行内/批量条/详情页三处）全删——UI 不再提供下架入口。
- 「隐藏」点击时的确认弹框（移入回收站、可恢复）已存在，不动。
- 回收站不再分「已隐藏/已下架」两节：只显示隐藏件，行操作 = 查看 + 恢复 + **删除**（新增）。
- 删除 = 永久删除，走现有 `DELETE /announcements/:id` 端点（`BID_IN_PROGRESS` 409 闸门保留），历史留痕已在 controller 层完备（删前快照 + `history.write action:'DELETE'`）。
- 所有动作记入公告历史：HIDE ✓ / RESTORE ✓ / DELETE ✓（既有）；OFFLINE 落档逻辑后端保留但 UI 不再产生新记录。

## 改动清单

| 文件 | 改动 |
|---|---|
| `apps/web/src/app/(main)/notice/page.tsx` | 删行内下架按钮、`takeOffline`、批量条下架按钮、`runBatch` 的 `'offline'` 分支（类型收窄 `'publish' \| 'hide'`）、`offlineAnnouncement` import |
| `apps/web/src/app/(main)/notice/[id]/page.tsx` | 删详情页下架按钮与 handler、`offlineAnnouncement` import |
| `apps/web/src/lib/api/announcement.ts` | 删 `offlineAnnouncement` 封装（消费清零）；新增 `deleteAnnouncement(id)`（`api.delete`） |
| `apps/web/src/components/notice/announcement-recycle-modal.tsx` | 删两节切换/OFFLINE 节 → 单节「已隐藏」；行操作加删除（danger + `useConfirm` 危险确认「永久删除、不可恢复」）；描述/空态文案去「已下架」措辞；删除 409 `BID_IN_PROGRESS` 文案原样透出 |

## 不动项（验证性说明）

- 后端 `offline()` 端点与 OFFLINE 落档保留（无 UI 消费；先例同 DELETE 停用期「后端保留但停用」）。
- 库中存量 OFFLINE 件留库、UI 不可达。
- 全量「公告历史」直查 `announcement_histories`（无外键 join），删除后记录仍可见；前端历史弹窗 DELETE/HIDE/OFFLINE/RESTORE 标签均已存在。
- 下拉筛选「已下线」= 公示期满派生态（PUBLISHED + publicityEnd），与 status OFFLINE 无关，不动。

## 验收

1. 表格行/批量条/详情页无「下架」按钮。
2. 隐藏 → 确认框 → 回收站出现；恢复/删除可用。
3. 删除确认 → 永久删除；关联投标进行中项目 409 文案透出。
4. 公告历史可见 隐藏/恢复/删除 记录。
