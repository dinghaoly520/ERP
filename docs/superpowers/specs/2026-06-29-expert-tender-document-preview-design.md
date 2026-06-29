# 专家评审页「招标文件」预览 — 设计文档

- 日期：2026-06-29
- 模块：`apps/api/src/expert`、`apps/expert-portal`
- 状态：已批准，待实现

## 背景与动机

专家门户评审向导第 2 步「标书获取」目前只展示各**投标单位**提交的投标文件（技术方案 / 商务文件 / 投标函），**看不到招标文件原文**。专家评标时依赖的"招标要求"是 AI 从招标文件提取的结构化摘要（`AiBidAnalysisTask.requirements` / `tenderText`），无法独立核对原文 —— 尤其 ★号实质性条款等"一票否决"项，摘要若遗漏/失真风险较大。

从"专家独立评审"的合规原则出发，给专家提供招标文件原文预览是必要能力，不是锦上添花。

## 范围

在「标书获取」步骤顶部增加「招标文件」区块，让被分配到项目、且已完成身份核验+回避确认的专家，能以原文 PDF 形式预览该项目的招标文件。

## 现状（调查结论）

- 招标文件模型 `BidDocument`：加密（AES-256-GCM）+ 受控分发，密文存 MinIO，`decryptKey` 经 KMS 信封包裹（`wrapKey`/`unwrapKey` with `KMS_SECRET`）。
- 供应商端已有完整解密下载链路：`BidDocumentService.downloadForSupplier` —— 读 MinIO 密文 → `unwrapKey` → `decryptBuffer` → 明文流式返回。
- **招标文件不走**通用 `/api/upload/files/:id`（那是明文 + `canAccessFile` 对专家只放行投标文件）。需专家专用端点。
- BidProject ↔ 招标文件唯一可靠 FK：`BidDocument.bidProjectId → BidProject.id`（发布招标公告建项目时回填）。
- **数据缺口**：`yndjm-proj-01` 无招标文件（全库仅另外两个项目有）。需补种子才能在该项目演示。

## 设计

### 后端（`apps/api/src/expert`）

新增两个端点，挂在现有 `ExpertController`（`@Roles('bid_expert')`）下：

| 端点 | 作用 |
|---|---|
| `GET /expert/projects/:projectId/tender-document` | 返回 JSON 元信息 `{ title, fileName, fileSize, downloadUrl }` 或 `null` |
| `GET /expert/projects/:projectId/tender-document/download` | 流式返回解密后的明文 PDF（`Content-Disposition: inline`，浏览器内置 viewer 预览） |

**共享鉴权**（抽成 `ExpertService` 私有方法，复用 `getDecryptedDocuments` 的门控模式）：

1. 项目阶段 ∈ `{OPENING, EVALUATING}`，否则 `PROJECT_NOT_ACTIVE`（403）
2. 调用者是该项目 `BidExpert` 且 `signedIn` + `avoidanceConfirmed`，否则 `VERIFICATION_REQUIRED`（403）
3. **专家不走**供应商的 `accessScope` / `requirePayment` 门槛（专家是评审方，被分配即有权）

**定位与解密**：

- `prisma.bidDocument.findFirst({ where: { bidProjectId: projectId } })`；无则元信息端点返回 `null`、下载端点抛 `NOT_FOUND`（404）
- 复用 `apps/api/src/announcement/bid-document.crypto.ts` 的 `unwrapKey(doc.decryptKey, KMS_SECRET)` + `decryptBuffer(ciphertext, rawKey)`
- 保持与供应商端一致的全量 buffer 解密方式（不扩大为流式；原有 TODO 一并保留）

**审计**：下载端点解密成功后写一条 `BidSupervisionLog`（`role='专家'`、`action='招标文件访问'`、`result` 记录 asset id），与投标文件访问日志一致；**不**修改 `BidDocument.downloadCount`（避免污染供应商下载统计）。

**`downloadUrl` 形态**：`/api/expert/projects/:projectId/tender-document/download`（相对路径，前端经 Next.js rewrite 到 4001）。

### 前端（`apps/expert-portal`）

- `lib/types` 的 `ExpertProjectDetail` 增加 `tenderDocument?: { title; fileName; fileSize; downloadUrl } | null`
- 后端 `getProject`（专家项目详情）附带 `tenderDocument` 元信息
- `evaluate/[id]/page.tsx` 中 `step === 'documents'` 区块**最顶部**插入「招标文件」卡片（在"正在加载标书…"与各供应商卡片之前）：
  - 有文件 → 文件名 + 大小 +「预览」按钮 `<a href={tenderDocument.downloadUrl} target="_blank" rel="noopener">`
  - 无文件 → 灰色空状态"本项目暂无招标文件"
- `rel="noopener"`（非 `noreferrer`）：新端点受 AuthGuard 保护，依赖 `portal-cookie` 的 Referer 兜底识别门户 —— 与刚修复的投标文件预览同机制（已验证有效）

## 边界与约束

- 专家可见 ≠ 可下载分发：仅 inline 预览，专家侧无下载计数、无白名单
- 解密内存：沿用全量 buffer（与供应商端一致）
- 阶段门控：仅 OPENING / EVALUATING 可访问（与投标文件获取一致）

## 测试策略

- **后端单元**（扩展 `expert.service.spec.ts`）：
  - 有招标文件 → 元信息端点返回正确字段
  - 无招标文件 → 返回 `null` / 下载端点 404
  - 非本项目专家 → 403
  - 未完成签到/回避 → 403
- **前端手动验证**：标书获取顶部出现卡片；点击「预览」新标签页渲染 PDF；无文件时空状态
- 解密逻辑本身已被供应商端 `bid-document` 覆盖，不重复测

## 验证前置

`yndjm-proj-01` 需补一条招标文件种子（上传一份加密招标文件并回填 `bidProjectId='yndjm-proj-01'`），否则在该项目为空状态；可临时用 `cmqhero-bid-proj01` 验证。

## 非目标（YAGNI）

- 页内 `<iframe>` 内嵌预览（方案 2，收益不抵成本）
- 招标文件 OCR 全文 / 结构化要求展示（形态 A，本次不做）
- 招标文件版本管理 / 多文件（当前模型一公告一招标文件）
- 专家侧下载计数与统计
