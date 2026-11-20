# PMI 附件双轨存储加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PMI 附件本地主轨不变，写入时同步落 MinIO 副本（失败不阻断），全部裸读本地盘的消费点获得「本地→MinIO→404/降级」回退，删除双清，存量回填——容器重建不再等于附件灭失。

**Architecture:** 新共享纯函数工具 `common/attachment-object-store.ts`（minioClient 直连、无 DI，API 与 ai-bid worker 双进程可用）；PMI 服务经私有包装 `ensureAttachmentLocal`（本地 miss 时把 MinIO 副本物化回本地路径再返回路径）统一改造读点；写侧单咽喉点 `persistUploadedFile` 追加 best-effort 副本。

**Tech Stack:** NestJS 11 + Prisma（零 schema 变更）+ minio（既有 `upload/minio.client.ts`）+ jest。

**Spec:** `docs/superpowers/specs/2026-11-20-pmi-attachment-dual-track-design.md`（已批准；本计划与之同行，执行者两份都读）

## Global Constraints

- 「主轨=本地磁盘」裁定不变；**副本失败绝不阻断主轨**（`writeAttachmentCopy` 吞一切错、返 false）。
- 零 Prisma schema 变更；objectKey 即 MinIO 对象键（`project-management/<stored>`，与 FileAsset `uploads/<date>/` 前缀无碰撞）。
- 不新增 npm 依赖（jest ESM allowlist 两份不动）。
- **并行会话协作**（`project-management.service.ts`、`supplier-portal.service.ts` 当日有他人提交/改动）：每个 Task 开工前 `git status --short` 确认工作区无他人未提交改动；本计划给的是**函数锚点**（形如 `rg -n "async getAttachmentFile" src/project-management/project-management.service.ts`），行号以现场为准；**禁 `git add -A`**，只 add 本 Task 文件清单内的路径。
- 验证口径（main 分支 lint 不可用）：`npx tsc --noEmit` + `./node_modules/.bin/jest <spec 路径>` 直跑。
- commit 信息末尾带 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；**不主动 push**（完成后只提醒未推送数）。
- worker 进程改动（plaintext-fetcher）无 watch：本地验证走单测即可，生产随 recreate 生效。

## Review Focus

1. **MinIO 整体宕机**：上传必须仍成功（Task 2 的 false 不抛测试）；本地命中读取不触 MinIO（Task 1 的 local-hit 不调 getObject 断言）。
2. **混轨 objectKey**（非招标成交行=FileAsset MinIO key）：本地 miss → MinIO 命中本体（Task 1 的 minio-hit 用例用 `uploads/...` 形态键）。
3. **双轨皆失**：下载类 404 带 `ATTACHMENT_FILE_MISSING`（Task 3、6）；分析类空文本不抛（Task 4、7）。
4. **getObject 抛非 NoSuchKey 网络错**：吞错 + warn、按 miss 处理不 500（Task 1 显式用例）。
5. **回填脚本幂等**：复跑时 MinIO 已有全 skip、计数为 0（Task 8 的复跑验证步骤）。

---

### Task 1: 共享工具 `attachment-object-store`

**Files:**
- Create: `apps/api/src/common/attachment-object-store.ts`
- Test: `apps/api/src/common/attachment-object-store.spec.ts`

**Interfaces:**
- Produces（后续所有 Task 消费）:
  - `readAttachmentBuffer(objectKey: string): Promise<Buffer | null>` — 本地 `resolve(process.cwd(), 'uploads', objectKey)` stat 命中即读；miss 则 `minioClient.getObject(MINIO_BUCKET, objectKey)` 聚 Buffer；再 miss 返 null。getObject 任何异常按 miss（非 `NoSuchKey` code 打 warn）。
  - `writeAttachmentCopy(objectKey: string, buffer: Buffer, mimeType: string): Promise<boolean>` — `putObject` 成功返 true；任何异常 `logger.warn`（`[attachment-object-store] MinIO 副本失败（不阻断）: <key>`）返 false，绝不抛。
  - `removeAttachmentCopy(objectKey: string): Promise<void>` — `removeObject` best-effort，异常吞（debug 级日志）。

- [ ] **Step 1: 写失败测试** `attachment-object-store.spec.ts`

  jest.mock `'../upload/minio.client'`（`minioClient: { getObject, putObject, removeObject }` 均 jest.fn()）与 `'node:fs/promises'`（`requireActual` 透传，仅 `stat`/`readFile`/`writeFile` 可按用例覆写）。五个用例：
  1. `readAttachmentBuffer 本地命中 → 返回 buffer 且不调 minioClient.getObject`（stat mock 返 `{ isFile: () => true }`）
  2. `本地 miss + MinIO 命中 → 聚合流返 buffer`（getObject 返 'data'/'end' 可推流；键用 `'uploads/2026-11-20/x.pdf'` 形态覆盖混轨）
  3. `本地 miss + getObject 抛 code:'NoSuchKey' → 返 null 不抛`
  4. `getObject 抛网络错（无 code）→ 返 null 不抛且 logger.warn 被调`
  5. `writeAttachmentCopy putObject 抛错 → 返 false 不抛`；`removeAttachmentCopy removeObject 抛错 → resolve 不抛`

- [ ] **Step 2: 跑测确认失败**

  Run: `./node_modules/.bin/jest src/common/attachment-object-store.spec.ts`
  Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** `attachment-object-store.ts`

  纯函数模块，仅 import `minioClient, MINIO_BUCKET`（`../upload/minio.client`）、`stat/readFile`（`node:fs/promises`）、`resolve`（`node:path`）、`Logger`（`@nestjs/common`）。流聚 Buffer 用 data/end/error 三事件 Promise（与 `storage.service.ts:35` download 同款）。文件头注释一段：双轨制说明 + 指回 spec 路径。

- [ ] **Step 4: 跑测确认通过**

  Run: `./node_modules/.bin/jest src/common/attachment-object-store.spec.ts`
  Expected: PASS（5 用例全绿）

- [ ] **Step 5: Commit**

  ```bash
  git add src/common/attachment-object-store.ts src/common/attachment-object-store.spec.ts
  git commit -m "feat(api): PMI 附件双轨共享工具 attachment-object-store（本地→MinIO 回退/副本写入/副本删除）"
  ```

---

### Task 2: 写侧双写 `persistUploadedFile`

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts`（锚点 `rg -n "private async persistUploadedFile" src/project-management/project-management.service.ts`）
- Test: `apps/api/src/project-management/project-management.service.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 `writeAttachmentCopy(objectKey, buffer, mimeType)`。
- Produces: `persistUploadedFile` 行为不变（返回 `{ absolutePath, attachment }`），副作用追加 MinIO 副本。

- [ ] **Step 1: 写失败测试**

  在 spec 追加 describe `'persistUploadedFile MinIO 副本双写'`：`jest.mock('../common/attachment-object-store', ...)` 提供 `writeAttachmentCopy: jest.fn()`（`removeAttachmentCopy`/`readAttachmentBuffer` 空实现占位，后续 Task 复用同 mock 工厂）。**复用本文件既有 `makeService()` 工厂**（:490 附近，已带 prisma/documentParser/fs 系列 mock——`writeFile` 已 mock，不真实落盘）。两用例（`(service as any).persistUploadedFile(file, prefix)` 直调私有；`file` 用 `{ originalname: '测试.pdf', buffer: Buffer.from('x'), mimetype: 'application/pdf', size: 1 }`）：
  1. 副本成功（mockResolvedValue true）→ 返回值 objectKey 形如 `project-management/<ts>-<prefix>-测试.pdf`；断言用**返回值里的 objectKey**（含 Date.now() 不可预知）：`expect(writeAttachmentCopy).toHaveBeenCalledWith(result.attachment.objectKey, file.buffer, file.mimetype)`，恰一次
  2. 副本失败（mockResolvedValue false）→ **不抛**，返回值照常

- [ ] **Step 2: 跑测确认失败**（现状无副本调用 → 用例 1 断言失败）

  Run: `./node_modules/.bin/jest src/project-management/project-management.service.spec.ts -t "MinIO 副本双写"`
  Expected: FAIL

- [ ] **Step 3: 实现**

  `persistUploadedFile` 内 `await writeFile(absolutePath, file.buffer);` 之后追加：

  ```ts
  const copied = await writeAttachmentCopy(attachment.objectKey, file.buffer, file.mimetype);
  if (!copied) this.logger.warn(`[persistUploadedFile] MinIO 副本失败（不阻断）: ${attachment.objectKey}`);
  ```

  （`attachment` 字面量在 return 前已构造——先抽出局部变量再 return；顶部加 import。）

- [ ] **Step 4: 跑测确认通过**

  Run: `./node_modules/.bin/jest src/project-management/project-management.service.spec.ts`
  Expected: PASS（新 describe 绿 + 既有全绿——本文件 mock 了 util，不影响其它 describe）

- [ ] **Step 5: Commit**

  ```bash
  git add src/project-management/project-management.service.ts src/project-management/project-management.service.spec.ts
  git commit -m "feat(api): persistUploadedFile 追加 MinIO 副本双写（失败仅告警不阻断主轨）"
  ```

---

### Task 3: 读侧下载/文本四点 + `ensureAttachmentLocal` 包装

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts`（锚点：`async getAttachmentFile`、`async getAttachmentTextContent`、`private async readAttachmentText`）
- Test: `apps/api/src/project-management/project-management.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `readAttachmentBuffer`。
- Produces: `private async ensureAttachmentLocal(objectKey: string): Promise<string | null>` — 本地 `resolve(cwd,'uploads',objectKey)` stat 命中返绝对路径；miss 则 `readAttachmentBuffer(objectKey)`（内部会再探本地，廉价），null 返 null，有 buffer 则 `mkdir(dirname(filePath), { recursive: true })`（**父目录可能不存在**——新 clone/新容器无 uploads/）后 `writeFile` 物化回本地路径，返该路径。Task 4 消费。

> **审查裁定（2026-11-20 严格审查）**：`readAttachmentText`（:7445）**不重构、`this.storage` 注入不删**——它是唯一本就有「本地→MinIO」回退的读点，重构仅省 6 行重复；而 storage 是构造**位置参数**（spec `makeService()` 第 6 参传 `storage as never`），删注入=改构造签名连锁 spec 工厂，风险≫收益。spec §5.3 对应行已同步修订。

- [ ] **Step 1: 写失败测试**

  describe `'附件读取本地→MinIO 回退'`（util mock 同 Task 2 工厂，`readAttachmentBuffer: jest.fn()`；复用 `makeService()` 与其 fs mock）：
  1. `getAttachmentFile`：prisma mock `attachment.findUnique` 返行 + `readAttachmentBuffer` null → 抛 `NotFoundException`，响应体含 `code: 'ATTACHMENT_FILE_MISSING'`、`error: '附件文件缺失（本地与对象存储均未找到），请重新上传'`
  2. `getAttachmentFile`：`readAttachmentBuffer` 返 Buffer → 返回 `{ buffer, mimeType, fileName }`（ensureAttachmentLocal 物化：`writeFileMock` 被调 + `readFileMock` 返该 buffer）
  3. `ensureAttachmentLocal` 直测：本地 miss（`stat` mock 返 null）+ `readAttachmentBuffer` 返 Buffer → 返回物化路径且 `mkdirMock`/`writeFileMock` 被调；`readAttachmentBuffer` null → 返 null 且不写盘

- [ ] **Step 2: 跑测确认失败**

  Run: `./node_modules/.bin/jest src/project-management/project-management.service.spec.ts -t "本地→MinIO 回退"`
  Expected: FAIL

- [ ] **Step 3: 实现**

  1. 新增私有 `ensureAttachmentLocal`（接口见上）；`getAttachmentFile`/`getAttachmentTextContent` 的 `const filePath = resolve(...)` 行改为 `const filePath = await this.ensureAttachmentLocal(attachment.objectKey); if (!filePath) throw new NotFoundException({ error: '附件文件缺失（本地与对象存储均未找到），请重新上传', code: 'ATTACHMENT_FILE_MISSING' });`（getAttachmentTextContent 后续 readFile 走物化路径）。
  2. `readAttachmentText` 与 `this.storage` 注入**保持原样**（见上方审查裁定）。

- [ ] **Step 4: 跑测确认通过**

  Run: `./node_modules/.bin/jest src/project-management/project-management.service.spec.ts`
  Expected: PASS 全绿

- [ ] **Step 5: Commit**

  ```bash
  git add src/project-management/project-management.service.ts src/project-management/project-management.service.spec.ts
  git commit -m "feat(api): 附件下载/文本读取接本地→MinIO 回退，双失 404 ATTACHMENT_FILE_MISSING"
  ```

---

### Task 4: 分析/派生读端（analyzeProject×2、直谈识别、归档源、docx×4）

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts`（锚点：`rg -n "resolve\(process.cwd\(\), 'uploads', (att|attachment|oldAttachment)\.objectKey\)" src/project-management/project-management.service.ts`——执行日实扫，预计 8 处剩余：analyzeProject 两处 `filePath = resolve(...)` 传 `extractFileTextWithOcr`；直谈识别循环 `this.extractFileText(resolve(...))`；归档导出 `srcPath`；**docx 家族四处** `filePath/oldPath = resolve(...)` 后 `readFile`——段落解析、替换 docx 读旧件、html 转换、patch 读旧件（锚点 `const oldPath = resolve`，readFile 作 hash 校验+patch 基底））

**Interfaces:**
- Consumes: Task 3 `ensureAttachmentLocal(objectKey)`。

- [ ] **Step 1: 写失败测试**

  describe `'分析/派生读端 MinIO 回退'`：
  1. `extractFileTextWithOcr` 改 Buffer 签名后：传 Buffer + `parseWithOcr` mock 返文本 → 返回文本（截 8000）
  2. analyzeProject 附件双失（`ensureAttachmentLocal` 经 util mock 返 null 路径）→ 该附件 `extractedText` 为 `''`，**不抛**（维持静默降级）
  3. docx 解析点（`saveAttachmentParagraphs` 所在方法，锚点 `JSZip.loadAsync` 前的 filePath 读取）双失 → `NotFoundException` 带 `ATTACHMENT_FILE_MISSING`

- [ ] **Step 2: 跑测确认失败**

  Run: `./node_modules/.bin/jest src/project-management/project-management.service.spec.ts -t "分析/派生读端"`
  Expected: FAIL

- [ ] **Step 3: 实现（逐锚点）**

  1. `extractFileTextWithOcr` 签名改 `(buffer: Buffer, mimeType, fileName)`（删内部 readFile；catch→'' 语义保留）；两个 analyzeProject 调用点改 `const buffer = await readAttachmentBuffer(attachment.objectKey); const extractedText = buffer ? await this.extractFileTextWithOcr(buffer, attachment.mimeType, attachment.fileName) : '';`
  2. 直谈识别循环：`const filePath = await this.ensureAttachmentLocal(att.objectKey); if (!filePath) continue;` 后原样传 `this.extractFileText(filePath, ...)`
  3. 归档导出 srcPath：`const srcPath = await this.ensureAttachmentLocal(att.objectKey); if (!srcPath) continue;`（原 `catch { skip }` 语义保留）
  4. docx 家族四处（段落解析/替换旧件/Html 转换/patch 旧件）：`filePath = resolve(...)`（或 `oldPath =`）→ `= await this.ensureAttachmentLocal(<objectKey>); if (!filePath) throw new NotFoundException({ error: '附件文件缺失（本地与对象存储均未找到）', code: 'ATTACHMENT_FILE_MISSING' });`——patch 点的 hash 校验/`ConflictException('文件已被他人修改...')` 逻辑原样保留，只换文件来源。

- [ ] **Step 4: 跑测确认通过 + 全文件锚点复扫**

  Run: `./node_modules/.bin/jest src/project-management/project-management.service.spec.ts && rg -n "resolve\(process\.cwd\(\), 'uploads', (att|attachment|oldAttachment)\.objectKey\)" src/project-management/project-management.service.ts`
  Expected: 测试 PASS；rg 剩余行**只有 deleteAttachment 的 `filePath = resolve(...)`（专服务于 unlink，Task 5 处理）与两处内联 unlink（6617 批量、8034 替换旧件）**——其余附件读点清零

- [ ] **Step 5: Commit**

  ```bash
  git add src/project-management/project-management.service.ts src/project-management/project-management.service.spec.ts
  git commit -m "feat(api): analyzeProject/直谈识别/归档源/docx 读端接 MinIO 回退（物化本地）"
  ```

---

### Task 5: 删侧双清

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts`（**⚠️ 内联锚点 `rg -n "unlink\(resolve\(process.cwd\(\), 'uploads'"` 只能扫到 2/4**——另两处是变量形态。四处全清单（按方法定位，执行日实扫核对）：
  1. 阶段批量删除循环：内联 `await unlink(resolve(process.cwd(), 'uploads', att.objectKey))`
  2. `deleteAttachment`（`async deleteAttachment(projectId, attachmentId)`）：`const filePath = resolve(...)` → `unlink(filePath)`
  3. 替换旧件（`replaceAttachmentWithText`）：内联 `try { await unlink(resolve(..., oldAttachment.objectKey)); } catch {}`
  4. patch 旧件清理：`rg -n "unlink\(oldPath\)"` 定位（8298 `oldPath` 同族））

**Interfaces:**
- Consumes: Task 1 `removeAttachmentCopy(objectKey)`。

- [ ] **Step 1: 写失败测试**

  describe `'附件删除 MinIO 副本双清'`：`makeService()` 起（`deleteAttachment` 两个闸 `assertStageAttachmentMutable`/`assertAttachmentNotFrozen` 所涉 prisma 查询一并 mock 放行；**若闸门 mock 过重，退而直测批量删除循环点**——同断言粒度）→ 断言 `removeAttachmentCopy` 被以该 objectKey 调用一次；本地 unlink 仍被调（既有）。

- [ ] **Step 2: 跑测确认失败**

  Run: `./node_modules/.bin/jest src/project-management/project-management.service.spec.ts -t "MinIO 副本双清"`
  Expected: FAIL

- [ ] **Step 3: 实现**

  四处本地 `unlink`（含 try/catch 吞错形态）之后各追加一行 `await removeAttachmentCopy(<objectKey>);`。**只处理附件 objectKey 的 unlink**——缓存/工件路径（tender-text-cache、`uploads/archive`、docx 工件）的 unlink 不动。

- [ ] **Step 4: 跑测确认通过**

  Run: `./node_modules/.bin/jest src/project-management/project-management.service.spec.ts`
  Expected: PASS 全绿

- [ ] **Step 5: Commit**

  ```bash
  git add src/project-management/project-management.service.ts src/project-management/project-management.service.spec.ts
  git commit -m "feat(api): 附件删除点补 MinIO 副本 best-effort 双清"
  ```

---

### Task 6: supplier-portal 谈判下载主轨回退

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（锚点：`rg -n "主轨：PMI 阶段附件" src/supplier-portal/supplier-portal.service.ts`，裸 readFile 在其后）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `readAttachmentBuffer(objectKey)`（buffer 语义，不经物化）。

- [ ] **Step 1: 写失败测试**（⚠️ 此两文件会话开始时他有未提交改动——开工前 `git status` 确认已提交）

  describe `'谈判文件下载附件轨回退'`：prisma `attachment.findUnique` 返行（objectKey 命中 keys 闸）+ `readAttachmentBuffer` null → 抛 `NotFoundException` 带 `ATTACHMENT_FILE_MISSING`；返 Buffer → mock res 断言 `Content-Disposition` 与 `res.end(buffer)` 被调。

- [ ] **Step 2: 跑测确认失败**

  Run: `./node_modules/.bin/jest src/supplier-portal/supplier-portal.service.spec.ts -t "附件轨回退"`
  Expected: FAIL

- [ ] **Step 3: 实现**

  主轨 `const buffer = await readFile(resolve(process.cwd(), 'uploads', attachment.objectKey));` 改为 `const buffer = await readAttachmentBuffer(attachment.objectKey); if (!buffer) throw new NotFoundException({ error: '附件文件缺失（本地与对象存储均未找到）', code: 'ATTACHMENT_FILE_MISSING' });`——位于 FILE_NOT_IN_CONFIG 闸之后、FileAsset 兼容轨之前。

- [ ] **Step 4: 跑测确认通过**

  Run: `./node_modules/.bin/jest src/supplier-portal/supplier-portal.service.spec.ts`
  Expected: PASS 全绿

- [ ] **Step 5: Commit**

  ```bash
  git add src/supplier-portal/supplier-portal.service.ts src/supplier-portal/supplier-portal.service.spec.ts
  git commit -m "feat(api): 供应商端谈判文件下载附件轨接 MinIO 回退，双失 404"
  ```

---

### Task 7: ai-bid worker plaintext-fetcher 主轨回退

**Files:**
- Modify: `apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.ts`（锚点：`rg -n "主轨：PMI 阶段附件" src/ai-bid-analysis/services/plaintext-fetcher.service.ts`，裸 readFile 在其后）
- Test: `apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `readAttachmentBuffer(objectKey)`。

- [ ] **Step 1: 写失败测试**

  describe `'采购文件主轨回退'`：
  1. attachment 行命中 + 本地 miss + MinIO 命中（`readAttachmentBuffer` 返 buffer）→ 返回 `{ buffer, fileName }`
  2. attachment 行命中 + 双失（null）→ **不返回主轨结果、落 FileAsset 兼容轨**：mock FileAsset 行返回其 buffer（覆盖 spec 已有的兼容轨 mock 方式）
  3. 主轨与兼容轨皆无 → 返 null

- [ ] **Step 2: 跑测确认失败**

  Run: `./node_modules/.bin/jest src/ai-bid-analysis/services/plaintext-fetcher.service.spec.ts -t "主轨回退"`
  Expected: FAIL

- [ ] **Step 3: 实现**

  `const buffer = await fs.promises.readFile(path.resolve(process.cwd(), 'uploads', att.objectKey)); return { buffer, fileName: att.fileName };` 改为：

  ```ts
  const buffer = await readAttachmentBuffer(att.objectKey);
  if (buffer) return { buffer, fileName: att.fileName };
  // 本地与 MinIO 双失 → 落下方 FileAsset 兼容轨继续（不 return null）
  ```

  即主轨 if 块只在拿到 buffer 时 return，双失时自然落到既有 FileAsset 查询。

- [ ] **Step 4: 跑测确认通过**

  Run: `./node_modules/.bin/jest src/ai-bid-analysis/services/plaintext-fetcher.service.spec.ts`
  Expected: PASS 全绿

- [ ] **Step 5: Commit**

  ```bash
  git add src/ai-bid-analysis/services/plaintext-fetcher.service.ts src/ai-bid-analysis/services/plaintext-fetcher.service.spec.ts
  git commit -m "feat(api): AI worker 采购文件主轨接 MinIO 回退，双失落 FileAsset 兼容轨"
  ```

---

### Task 8: 存量回填脚本

**Files:**
- Create: `apps/api/scripts/backfill-attachment-minio.ts`（惯例仿 `scripts/fix-filename-mojibake.ts`：头注释块含病理/范围/用法、`new PrismaClient()` 直连、dry-run 默认、`--execute` 真传；无 jest 测试，验证=实跑）

**Interfaces:**
- Consumes: Task 1 `writeAttachmentCopy` 的判定口径（但脚本用 `statObject` 预检避免重复上传）。

- [ ] **Step 1: 实现脚本**

  全表扫 `Attachment`（不分工轨）：本地 stat 命中 + MinIO `statObject` 抛错（不存在）→ **待回填**（`--execute` 时 putObject 本地 buffer，contentType=mimeType）；本地命中 + MinIO 已有 → skip；本地 miss + MinIO 已有 → healthy；**两边皆无 → 不可恢复清单**（打印 id/fileName/objectKey/所属项目，预期含 `室内绿植服务谈判文件.pdf` 那行）。输出四类计数 + 明细（dry-run 与 execute 同格式）。逐行处理 try/catch，单行失败不中断、末尾汇总。

- [ ] **Step 2: dev 库 dry-run 验证**

  Run: `npx tsx scripts/backfill-attachment-minio.ts`
  Expected: 78 行 `pmi_track` 首跑应全部落「待回填」（本地命中+MinIO 无）或「不可恢复」（本地也丢）——**skip≈0**（Attachment 键从未写过 MinIO，首次不可能 skip）；两类计数之和=扫描总数。（dev 金仓 54321，.env 已配）

- [ ] **Step 3: execute + 幂等复跑验证（Review Focus #5）**

  Run: `npx tsx scripts/backfill-attachment-minio.ts --execute && npx tsx scripts/backfill-attachment-minio.ts`
  Expected: 第一遍待回填计数>0 且上传成功；第二遍待回填=0、全 skip——幂等坐实。

- [ ] **Step 4: Commit**

  ```bash
  git add scripts/backfill-attachment-minio.ts
  git commit -m "feat(api): Attachment 存量 MinIO 副本回填脚本（dry-run 默认/幂等/不可恢复清单）"
  ```

---

### Task 9: 生产 runbook 文档 + 文档收口

**Files:**
- Create: `docs/ops/pmi-attachment-volume-mount-runbook.md`
- Modify: `docs/superpowers/specs/2026-11-20-pmi-attachment-dual-track-design.md`（状态行）
- Modify: `CLAUDE.md`（谈判读端口径行，**必须走 Bash 改**——ARS 守卫拦 Edit/Write）

- [ ] **Step 1: 写 runbook** `docs/ops/pmi-attachment-volume-mount-runbook.md`

  六段操作单（生产机 10.60.14.14 执行，权威 compose 在生产机、桌面拷贝同步）：
  1. **先救文件**（顺序铁律）：`docker exec <api> ls /app/apps/api/uploads/` 盘点 → 有文件则 `docker cp <api>:/app/apps/api/uploads/project-management /home/<user>/uploads-rescue-$(date +%m%d)/`
  2. **挂卷**：生产 compose api 服务 volumes 增 bind mount `<宿主目录>:/app/apps/api/uploads`，`docker compose up -d` 重建；救援文件回拷宿主目录
  3. **部署含本计划的镜像**（recreate api + ai-worker）
  4. **回填**：⚠️ tsx 是 devDependency、生产镜像（water-erp/Dockerfile / backend/Dockerfile.api 构建）多半不含——给两条路径：a) B 机宿主/打包机有代码+Node 时，env 指生产（KingBase 10.60.1.10 + 生产 MinIO endpoint/凭证）跑 `npx tsx scripts/backfill-attachment-minio.ts`；b) `docker run --rm` 临时 node 镜像挂载 scripts + prod env 直跑。先 dry-run 复核再 `--execute`
  5. **验证**：`docker inspect` Mounts 确认卷；下载既有附件 200；`docker compose up -d --force-recreate api` 后再下载仍 200（副本轨生效证明）
  6. **不可恢复清单**：交用户找回原始文件走 UI 重传（旧附件行可删）

- [ ] **Step 2: 收口文档**

  spec 状态行改「已实施（2026-11-20）」；CLAUDE.md「谈判采购文件读端口径」节的 `refFileKeys=PMI 阶段附件主轨·本地 uploads/ 磁盘` 改为 `refFileKeys=PMI 阶段附件主轨·本地 uploads/ 磁盘 + MinIO 副本双轨（2026-11-20，spec docs/superpowers/specs/2026-11-20-pmi-attachment-dual-track-design.md）`——用 `Bash` 的 python/sed 改（勿用 Edit）。

- [ ] **Step 3: 终验**

  Run: `npx tsc --noEmit && ./node_modules/.bin/jest src/common/attachment-object-store.spec.ts src/project-management/project-management.service.spec.ts src/supplier-portal/supplier-portal.service.spec.ts src/ai-bid-analysis/services/plaintext-fetcher.service.spec.ts`
  Expected: tsc 零错 + 四 spec 全绿

- [ ] **Step 4: Commit**

  ```bash
  git add docs/ops/pmi-attachment-volume-mount-runbook.md docs/superpowers/specs/2026-11-20-pmi-attachment-dual-track-design.md
  git commit -m "docs: PMI 附件挂卷生产操作单 + 双轨 spec 收口"
  ```
  （CLAUDE.md 改动单独 `git add CLAUDE.md && git commit -m "docs: CLAUDE.md 谈判文件读端口径补双轨注记"`）

---

## Self-Review 记录

- **Spec 覆盖**：写侧（Task 2）/读侧 PMI 全点（Task 3、4）/supplier-portal+worker（Task 6、7）/删侧（Task 5）/回填（Task 8）/runbook（Task 9）——spec §5.1-5.7 逐节有任务对应。expert:1191 与 bid-document:132 按裁定不动 ✓。
- **类型一致性**：`readAttachmentBuffer`（Buffer 语义，Task 6/7 直用）vs `ensureAttachmentLocal`（路径物化语义，仅 PMI 服务内，Task 3 产 4 消）已分清 ✓。
- **行号漂移风险**：全部锚点化 + 执行日实扫 ✓（该文件当日已有并行提交实录）。
- **比例**：代码块仅出现在签名/关键三行处，无正文转写 ✓。

## 严格审查修订记录（2026-11-20，对实际代码逐条核验后）

1. **【砍】Task 3 原「`readAttachmentText` 重构 + 删 `this.storage` 注入」**：storage 是构造**位置参数**（spec `makeService()` 第 6 参），删注入=改构造签名连锁 spec 工厂；而该方法本就是唯一已有本地→MinIO 回退的读点，重构仅省 6 行。裁定：不动，spec §5.3 同步修订。
2. **【改】Task 2/3 测试 FS 策略**：spec 已有 `makeService()` 工厂带全套 prisma/documentParser/fs mock——原「真实落盘+清理」指示作废，改复用工厂（不真实写盘）。`uploads/` 已确认在根 .gitignore:20。
3. **【改】Task 4 docx 读点 3→4 处**：漏了 patch 流 `const oldPath = resolve(...)`（hash 校验+patch 基底读）；四处全列，patch 的 `ConflictException` 逻辑保留。
4. **【改】Task 5 锚点正则漏检**：内联 `unlink(resolve(...))` 只匹配 2/4；另两处变量形态（`unlink(filePath)`/`unlink(oldPath)`）按方法名枚举补全。
5. **【改】Task 8 首跑预期**：Attachment 键从未写过 MinIO，首跑 skip≈0、全落「待回填/不可恢复」，两类计数和=总数。
6. **【改】Task 9 回填执行路径**：tsx 是 devDependency 生产镜像多半没有——改双路径（宿主 env 指生产跑 / 临时容器跑），附 env 清单要求。
7. **【补】Task 3 `ensureAttachmentLocal` 加 `mkdir recursive`**：物化路径父目录（uploads/project-management/）在新容器可能不存在。
8. **【补】Task 4 复扫断言措辞**：完成后 rg 剩余应为 deleteAttachment 服务行+两处内联 unlink，非「读点清零」一刀切。
