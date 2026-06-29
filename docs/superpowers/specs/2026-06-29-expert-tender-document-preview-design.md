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
- 供应商端已有完整解密下载链路：`BidDocumentService.downloadForSupplier`（`bid-document.service.ts:246-279`）—— 读 MinIO 密文 → `unwrapKey` → `decryptBuffer` → 明文 buffer 返回（`streamToBuffer` 全量入内存，**非流式**）。
- **招标文件不走**通用 `/api/upload/files/:id`（那是明文 + `canAccessFile` 对专家只放行投标文件）。需专家专用端点。
- BidProject ↔ 招标文件唯一可靠 FK：`BidDocument.bidProjectId → BidProject.id`（发布招标公告建项目时回填）。
- **数据缺口**：`BidDocument.json` 现有 4 条招标文件（2 条 `bidProjectId=null`，2 条有项目关联：`cmqhf0...`、`cmqhero-bid-proj01`），但**均无可解密密文**（详见「验证前置」）。唯一适合演示的项目是 `cmqhero-bid-proj01`（stage=`EVALUATING`、已分配专家、已有招标文件记录 `cmqhero-bd01`）。注：早期提到的 `yndjm-proj-01` 在种子里不存在，已弃用为目标项目。

## 设计

### 后端（`apps/api/src/expert`）

新增两个端点，挂在现有 `ExpertController`（`@Roles('bid_expert')`）下：

| 端点 | 作用 |
|---|---|
| `GET /expert/projects/:projectId/tender-document` | 返回 JSON 元信息 `{ title, fileName, fileSize, downloadUrl }` 或 `null` |
| `GET /expert/projects/:projectId/tender-document/download` | 返回解密后的明文 PDF buffer（`Content-Disposition: inline`，浏览器内置 viewer 预览） |

**共享鉴权**（抽成 `ExpertService` 私有方法，复用 `getDecryptedDocuments`（`:271-283`）的门控模式；注意该方法**还含 supplier 校验**（`:285-288`），招标文件是项目级、无需 supplier，故抽出的私有方法只含下列「项目阶段 + 专家身份」两段）：

1. 项目阶段 ∈ `{OPENING, EVALUATING}`，否则 `PROJECT_NOT_ACTIVE`（403）
2. 调用者是该项目 `BidExpert` 且 `signedIn` + `avoidanceConfirmed`，否则 `VERIFICATION_REQUIRED`（403）
3. **专家不走**供应商的 `accessScope` / `requirePayment` 门槛（专家是评审方，被分配即有权）

**定位与解密**：

- `prisma.bidDocument.findFirst({ where: { bidProjectId: projectId } })`；无则元信息端点返回 `null`、下载端点抛 `NOT_FOUND`（404）
- 解密复用与供应商端同一套工具：`decryptBuffer` 来自 `apps/api/src/announcement/bid-document.crypto.ts`；**`unwrapKey` / `isWrappedKey` 来自 `apps/api/src/common/crypto/envelope-crypto.ts`**（不是 `bid-document.crypto.ts`——后者只导出 encrypt/decrypt/stream）。必须带兼容分支，与 `BidDocumentService.downloadForSupplier:263-265` 一致：
  ```ts
  const rawKey = isWrappedKey(doc.decryptKey)
    ? unwrapKey(doc.decryptKey, process.env.KMS_SECRET!)
    : doc.decryptKey;
  ```
  不要无条件 `unwrapKey`，否则对未被 KMS 包裹的旧 key 会解密失败。
- 保持与供应商端一致的全量 buffer 解密方式（`streamToBuffer` + `decryptBuffer`，不扩大为流式；`streamToBuffer` 已标 `@deprecated`、`createDecryptStream` 可用，但本次不切换，与供应商端保持一致）。

**审计**：下载端点解密成功后写一条 `BidSupervisionLog`，字段对齐现有写入（`expert.service.ts:580-588` / `:758-766`）——`projectId`、`time: new Date()`、`role: '评审专家'`（与现有一致，非「专家」）、`target: expert.expertName`、`action: '访问招标文件'`、`result: doc.fileAsset.originalName`（或 asset id）、`riskFlag: '无'`；**不**修改 `BidDocument.downloadCount`（避免污染供应商下载统计）。

**`downloadUrl` 形态**：`/api/expert/projects/:projectId/tender-document/download`（相对路径，前端经 Next.js rewrite 到 4001）。

### 前端（`apps/expert-portal`）

- `packages/shared/src/types.ts` 的 `ExpertProjectDetail`（`extends BidProjectDetail`，约 `:184`）增加 `tenderDocument?: { title; fileName; fileSize; downloadUrl } | null`。`apps/expert-portal/src/lib/types.ts` 只是 re-export；改完**必须 `pnpm --filter @water-erp/shared build`**。
- 后端 `getProject`（专家项目详情）附带 `tenderDocument` 元信息。注意 `getProject` 有两条返回路径（`expert.service.ts:168-194` 的 restricted 分支 vs `:203` 的 active 分支）：招标文件门控要求 OPENING/EVALUATING，**只在 active 分支附带**，restricted 分支不带（或返 `null`）。
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
- **Controller 层 happy path**（解密用 mock）：验证下载端点返回 `Content-Disposition: inline` + `Content-Type: application/pdf` + PDF buffer，作为响应契约守卫。
- **前端手动验证**：标书获取顶部出现卡片；点击「预览」新标签页渲染 PDF；无文件时空状态（依赖「验证前置」先就绪）。
- 解密逻辑本身已被供应商端 `bid-document` 覆盖，不重复测。

## 验证前置（已定方案）

⚠️ 现有招标文件种子全部不可解密（`seed.ts:106-134` 只为 hero 投标文件生成密文 + 上传 MinIO，从不处理 `BidDocument`；`cmqhero-bd01` 的 `decryptKey` authTag 仅 14 字节，格式非法）。决定**扩展 `seed.ts`** 修复演示用的一条，不新建独立脚本。

**目标**：仅 `cmqhero-bid-proj01`（唯一 stage=`EVALUATING` + 已分配专家 + 已有招标文件记录 `cmqhero-bd01` 的项目）。其余 3 条假种子不处理（关联项目无专家评审场景，YAGNI）。

**实现**（仿 `ensureBidFiles()` 的幂等模式，新增 `ensureTenderFiles()`，在 `main()` 末尾 `ensureBidFiles` 之后调用）：

1. 新增 `prisma/scripts/gen-tender-pdf.py`（仿 `gen-bid-pdf.py`，reportlab + STSong-Light）→ 生成含 **★号实质性条款**（资质/工期/最高限价）、评标办法、技术要求的招标文件 PDF 到 `/tmp/seed-pdf/tender-hero.pdf`；
2. `readFileSync` → plaintext buffer；
3. `encryptBuffer(plaintext)` → `{ ciphertext, decryptKey }`；
4. `minioClient.putObject(MINIO_BUCKET, 'seed/hero/bid-doc-2026-hero1.pdf', ciphertext, …)`——**复用现有 `cmqhero-file-bd01.key`**，无需新建 FileAsset；
5. `wrapKey(decryptKey, KMS_SECRET)` 包裹 → `prisma.bidDocument.update('cmqhero-bd01', { decryptKey: wrapped })`；
6. `prisma.fileAsset.update('cmqhero-file-bd01', { sha256, size: ciphertext.length })`。

`createMany` 先写 JSON 占位 `decryptKey`，运行时 update 成真实包裹值——与 `ensureBidFiles` 更新 sha256 同套路，幂等。python3/reportlab 不可用时跳过（不阻塞 seed）。

**验证**：跑完 seed 后用 `unwrapKey + decryptBuffer` 解密 `cmqhero-bd01` 做一次性校验，确认成功（加密逻辑本身已被供应商端覆盖，不另写单测）。

## 非目标（YAGNI）

- 页内 `<iframe>` 内嵌预览（方案 2，收益不抵成本）
- 招标文件 OCR 全文 / 结构化要求展示（形态 A，本次不做）
- 招标文件版本管理 / 多文件（当前模型一公告一招标文件）
- 专家侧下载计数与统计
