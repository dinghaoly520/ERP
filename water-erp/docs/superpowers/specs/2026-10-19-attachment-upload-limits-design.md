# 附件上传统一限制（100MB + 格式白名单 + 多文件）设计

**日期**：2026-10-19　**范围**：:3005 信息发布中心 + 项目管理（含供应商邀请、公告发布配置）全部附件上传点　**状态**：已获用户批准（含追加两处）

## 1. 需求

1. 单文件 ≤ **100MB**（总量/件数不设限）
2. 格式白名单（9 扩展名，大小写不敏感，无扩展名拒绝）：`png jpg jpeg doc docx xls xlsx pdf zip rar`
3. 附件可多项：附件列表类入口支持一次多选批量上传
4. 前后端双层强制（前端提前拦截省流量，后端防直连绕过）

## 2. 后端改动

### 2.1 `POST /api/upload`（upload.controller.ts / upload.service.ts）

- multer 路由上限 50MB → **100MB**（路由级无法按 category 分流）
- 服务层新增校验（写库/落 MinIO 之前）：
  - `announcement`、`contract_document` 两类目：**100MB + 白名单**（本需求覆盖的公告附件、定标审批表、采购文件/邀请函、中标通知书自动 docx 均落这两类目）
  - 其余全部类目：服务层补 **50MB 上限**（保持现状——multer 放宽后不被乘隙），**不加**格式白名单（供应商资质等其他域既有用法不动，如需收口另行立项）
- `contract_document` 为服务端密封类目（UPLOAD_SERVER_SEAL）：校验在密封管线入口执行，先校验后密封
- 错误码：`ATTACHMENT_FILE_TYPE_INVALID`（400，文案列全格式）、`ATTACHMENT_FILE_TOO_LARGE`（400，含实际上限）
- multer 超限 413 文案归一为「单个文件不能超过 100MB」

### 2.2 `POST /api/project-management/:id/stages/:stageKey/attachments`

- multer 500MB → **100MB**；服务层 `addStageAttachment` 加白名单 + 100MB 校验（同 2.1 错误码）
- 覆盖：项目各阶段附件、**供应商邀请（邀请函/回执）**、采购文件编写/正式盖章版、备案表、向导自动上传的公告 docx（docx 在白名单内，自动流不受影响）

### 2.3 解析型入口（`extract-initiation` / `extract-demand`）

- multer 500MB → **100MB**（只对齐大小）；**不套格式白名单**——解析器业务上仅支持 PDF（前端 accept 保持 `.pdf`），放开格式只会让解析必败
- 明确原则：**自由附件上传点套白名单；结构化解析/导入入口保持其业务格式约束**

## 3. 前端改动（apps/web）

### 3.1 共享规则 `lib/upload-rules.ts`（新建）

- `ATTACHMENT_ACCEPT`：`.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.pdf,.zip,.rar`
- `ATTACHMENT_HINT`：`支持 PNG/JPG/Word/PDF/Excel/ZIP/RAR，单个不超过 100MB`
- `validateAttachmentFile(file: File): string | null`：超大小返回「XX 超过 100MB 上限（当前 YY MB）」；格式不符返回列全格式文案；通过返回 null

### 3.2 接入点（accept 属性 + onChange 先校验 toast 报具体原因 + 提示文案统一）

| 组件 | 位置 | 处理 |
|---|---|---|
| `notice/new`、`notice/[id]` AttachmentUploader | 信息发布中心附件 | **改 multiple** 批量上传（逐个校验逐个传）+ accept + 校验 + 提示 |
| `announcement-publish-wizard`（公告附件） | **公告发布配置**（用户点名） | accept + 校验 + 提示（pendingFiles 本就多项） |
| `project-detail-panel` 阶段附件 | 项目管理各阶段 | accept + 校验 + 提示（已 multiple） |
| `supplier/invitation-letter-modal` | **供应商邀请**（用户点名） | accept + 校验 + 提示（回执常为扫描件 png/jpg ✓ 白名单内） |
| `tender-write/notification-letter-dialog` 定标审批表 | 定标 | accept（放开仅 PDF）+ 校验 + 提示 |
| `projects/bid-confirm-panel` 采购文件/邀请函上传 | 开标确认 | accept 放开为全白名单 + 校验；文案「20MB」→100MB 统一 |
| `official-tender-wizard` / `tender-write-modal` / `tender-file-editor-modal` / `direct-filing-dialog` | 采购文件/备案表 | accept + 校验 + 提示 |
| `create-project-dialog` 立项/需求表 | 解析入口 | **仅加 100MB 校验**，accept 保持 `.pdf`（见 2.3） |

自动生成的文件流（向导公告 docx、中标通知书 docx、备案表 docx 上传）不经过选择器，白名单已含 docx，无需改动。

## 4. 错误处理与兼容

- 前端校验失败：toast 具体原因，文件不入列、不清空已选列表
- 后端校验失败：400 + 中文文案（经 HttpExceptionFilter 归一）；413（multer）文案归一
- 存量附件不受影响（校验只对新上传）
- 不动其他门户（供应商注册 10MB 专用轨道、商城、专家端等）

## 5. 测试

- 后端：`upload.service.spec` / controller 用例矩阵（类目 × 大小 × 扩展名，含大小写扩展名、无扩展名、边界 100MB+1）；`project-management` 阶段附件白名单/大小用例
- 前端：tsc + lint（web 无单测基建，规则 util 纯函数可后续补）
- 回归：全量 API 单测

## 6. 决策记录

- 白名单 9 项（用户裁定「按建议」，不加 bmp/gif/webp/csv/7z/txt/wps）
- 多文件：附件列表类放开 multiple；语义单文件点（定标审批表、正式盖章版指针、邀请函正本）保持单选
- `/api/upload` 其余类目维持 50MB：避免本需求外溢改变供应商等其他域行为
