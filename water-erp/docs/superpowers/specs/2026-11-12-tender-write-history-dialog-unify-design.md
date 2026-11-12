# 独立页采购文件编写·历史记录弹窗对齐项目侧「草稿历史版本」设计

日期：2026-11-12
状态：已批准（用户口头确认，布局选 A「整窗改版为版本框列表」）

## 背景与目标

:3005 有两个采购文件编写入口，历史记录窗口 UI 不一致：

| | 项目侧编写弹窗（`components/projects/tender-write-modal.tsx`，基准，不动） | 独立页 `/tender-write`（`components/tender-write/tender-history-dialog.tsx`，改） |
|---|---|---|
| 每条记录 | 整框可点（label 时间戳 + 点击恢复） | 标题 + 时间 + 「应用 / 删除」按钮 |
| 计数 | `{n}/20` | 无 |
| 底部 | 同步说明句 + 清空历史 + 关闭 | 仅关闭 |
| 版本上限 | 服务端每 (projectId, round) 裁剪 20 条 | 无上限（列表查询默认取 20） |

目标：把独立页历史记录弹窗整窗改版为项目侧同款「草稿历史版本」设计，两者 UI 一致，尽量简洁。

## 改动清单

### 1. 前端 `tender-history-dialog.tsx` 整窗改版（照搬项目侧 markup）

- 头部：`History` 图标（accent 色）+「草稿历史版本」+ `{n}/20`（n>0 时显示，tabular-nums）+ ✕（`neu-btn-xs`）
- 分隔线：`h-px bg-[oklch(0.6 0.04 258 / 0.16)]`
- 空态：「暂无历史版本，请点击『保存当前』创建第一个版本」
- 每条记录 = 整框按钮：`rounded-[12px]`、瓷面底（`oklch(1 0 0 / 0.48)` + inset 高光）、hover ring accent；左列 `createdAt` 格式化为 `2026/11/12 10:42`（`toLocaleString('zh-CN')` 年月日时分），右列「点击恢复」（10px accent 文本）；点击 → 调 `onApply(record)`（现有恢复链路不动）→ 关弹窗 → toast「已恢复 … 版本」
- 底部：同步说明句逐字保留「点击任意版本即可恢复草稿内容。草稿与历史版本已同步至服务器，同一账号在任何设备登录均保持一致。」+「清空历史」（`neu-btn-xs is-danger`，空列表时隐藏）+「关闭」（`neu-btn-soft`）
- 弹窗壳沿用现有 `wb-modal-shell` + 毛玻璃遮罩，宽度沿用项目侧 `max-w-[440px]` 口径

### 2. 后端 `tender-history`（service + controller 两处小改）

- 新增 `DELETE /tender-history?documentType=x`：删除**当前用户**该 documentType 全部记录——恒按 `userId = user.sub` 收口（admin 也不清他人；与列表端 admin 可见全量是两回事，清空是本人操作）。controller 挂与现有路由相同的角色标注。
- `create()` 保存（upsert）后裁剪：每 (userId, documentType) 按 `createdAt desc` 只留最新 20 条，溢出删除——`X/20` 与项目侧 `MAX_VERSIONS=20` 同语义。content-hash 去重 upsert 语义不变。

### 3. api client `lib/api/tender-history.ts`

- 补 `clearTenderHistoryByType(documentType)` → `DELETE /tender-history?documentType=`。

## 口径裁定（用户已批准）

1. **去掉单条「应用 / 删除」按钮**——项目侧无单条删除，只有整框恢复 + 清空历史；照搬以保一致与简洁。
2. **记录标题（保存时的项目名）不再显示**——界面只显时间戳（与项目侧 label 同构）；标题仅作服务端存储字段保留。
3. **同步说明句照抄原文**——历史版本确已上云跨设备一致；但独立页**编辑中的当前草稿仍是 localStorage**（项目侧有 ProjectTenderDraft 上云，独立页无）。补齐草稿上云需新模型 + 防抖推送，超出本次「简洁」范围，不做。

## 测试

- `apps/api/src/tender-history/tender-history.service.spec.ts`（新建或续写）：① 清空端点只删本人该类型记录（他人/他类型不动）；② 连续 create 后每 (userId, documentType) 至多 20 条；③ content-hash 重复保存仍是 upsert 不新增行。
- 前端纯展示改版：`pnpm --filter web lint` + 现有 web 测试回归；弹窗视觉与项目侧并排人工核验。

## 不做的事

- 不改项目侧弹窗（基准不动）。
- 不加独立页当前草稿服务端同步（新模型，另行立项）。
- 不动 TenderDocumentHistory schema（无迁移）。
