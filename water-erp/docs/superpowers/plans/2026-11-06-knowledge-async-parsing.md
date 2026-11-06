# 知识库文件解析异步化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 知识库文件上传收件即返回 202，解析（pdf-parse/OCR/分块/嵌入）移入 BullMQ 后台消费，状态与进度可见、失败可重试、同库 sha256 去重。

**Architecture:** `POST /knowledge/:id/files` 只做 MinIO 落盘 + 建 `KnowledgeFile(status=PARSING)` + 入队（payload 仅 fileId）；新 `knowledge-parse` 队列由**既有 ai-bid worker 进程**消费（2026-11-06 裁定：不另起进程），processor 下载对象→解析→按 OCR 批次回写进度→READY/FAILED。前端轮询展示。

**Tech Stack:** NestJS 11 + Prisma + BullMQ（Redis :6380）+ MinIO；前端 Next.js 16（apps/web 两个面板）。

**Spec:** `water-erp/docs/superpowers/specs/2026-11-06-knowledge-async-parsing-design.md`（含当日四点裁定与实现层裁定——worker 并入 ai-bid、PARSING 不可检索、轮询、同库去重）

## Global Constraints

- 上传响应时间与文件大小/页数/OCR 时长**完全解耦**（验收：118MB <5s 返回 202）。
- **禁止把文件 buffer 塞进 BullMQ payload**——传 `{fileId}` 引用，worker 自行从 MinIO 取。
- 遵守 CLAUDE.md 并行会话协作约定：`git add` 只加明确路径（禁 `-A`）；schema 改动必须附迁移且提交前 `npx prisma validate`；共享高危文件 `schema.prisma`/`app.module.ts` 仅在对方工作区干净时修改。
- TS 无 `esModuleInterop`：CJS 函数导出包用 `import x = require('pkg')`（现有代码已如此）。
- 新路由必须带角色标注——retry 端点继承 controller 级 `@Roles('leader','admin','staff')` 即可，勿留裸路由。
- CLAUDE.md 的编辑用 Bash（ARS 守卫拦 Edit/Write）。
- 验证命令：单测 `cd water-erp/apps/api && ./node_modules/.bin/jest <path>`（jest 二进制在 apps/api/node_modules/.bin，根 .bin 没有；main 上 lint 不可用走 jest 直跑）；前端 `pnpm --filter web exec tsc --noEmit`。
- 主库已切**金仓 localhost:54321**（.env 注释里的 pgbouncer:6432/:5432 是陈旧注释，勿信）；迁移 DDL 须保持标准 PG 语法（ADD COLUMN/UPDATE/CREATE INDEX 均兼容）。

## Review Focus

1. **并发重复上传同一文件**（双击/两个标签页）→ 必须单行单任务：sha256 同库检查 + BullMQ `jobId=fileId` 双保险（Task 4 测试）。
2. **解析中删除文件** → processor 查无此行必须 no-op，不得复活行/不得报错占死队列（Task 3 测试）。
3. **嵌入服务宕机**（既有降级语义，2026-11-03 §4.2）→ READY + indexed:false，**不是** FAILED——文件已解析成功，降级语义不可回退（Task 3 测试）。
4. **OCR 服务持续失败** → 3 次指数退避重试后落 FAILED(error)，且 FAILED 行可经 retry 端点复活（Task 3+4 测试）。
5. **存量行（迁移前数据）** → 回填 READY，规则提取/检索立即可用，不得因新增 status 过滤而集体失踪（Task 1 迁移回填 + Task 5 过滤，Task 7 冒烟复核）。

---

### Task 1: Prisma schema + 迁移（KnowledgeFile 异步状态字段）

**Files:**
- Modify: `water-erp/apps/api/prisma/schema.prisma:3281`（KnowledgeFile model）
- Create: `water-erp/apps/api/prisma/migrations/20261106000000_knowledge_file_async_status/migration.sql`

**Interfaces:**
- Produces: `KnowledgeFile` 新字段——`status String @default("PARSING")`、`totalPages Int?`、`processedPages Int @default(0)`、`error String?`、`indexed Boolean @default(true)`、`sha256 String?`；值域 `PARSING|READY|FAILED`（字符串字面量，不入 packages/shared）。后续任务按此名取用。

- [ ] **Step 0: seed 快照补状态字段（代码审查发现的回归点）**

`water-erp/apps/api/prisma/seed-data/KnowledgeFile.json` 每行加 `"status": "READY"`（快照行均已预解析、自带 content）。**不加则 `db:seed` 清库重灌后全部文件成 PARSING**——schema 默认值对 seed 直接插入生效，Task 5 的 READY 过滤将跳过全部种子文件、检索全空。

- [ ] **Step 1: 编辑 schema.prisma KnowledgeFile model，加六字段**

在 `chunkCount` 与 `isActive` 之间插入上述字段（`@default` 精确如上）。`@@index([knowledgeBaseId])` 后追加 `@@index([knowledgeBaseId, sha256])`（去重查询用）。

- [ ] **Step 2: `npx prisma validate` 通过**

Run: `cd water-erp/apps/api && npx prisma validate`
Expected: `The schema ... is valid.`（校验失败时 generate 会静默失败——CLAUDE.md 教训）

- [ ] **Step 3: 生成迁移并手写回填**

Run: `cd water-erp/apps/api && npx prisma migrate dev --create-only --name knowledge_file_async_status`

**金仓兜底（主库已切 localhost:54321）**：若 `--create-only` 因 shadow database 在金仓上报错，改用 `npx prisma migrate diff --from-schema-datasource --to-schema-datamodel --script` 生成 SQL，手工创建迁移目录放入（diff 无需 shadow DB；status 已核干净）。
编辑生成的 SQL：列定义照常（`status TEXT NOT NULL DEFAULT 'PARSING'` 等），**追加回填**：

```sql
UPDATE "KnowledgeFile" SET "status" = 'READY', "indexed" = true;
```

（存量行已解析完；indexed 无法跨向量库 join 推导，统一 true，重建索引按钮可纠偏。）同文件追加 sha256 复合索引 `CREATE INDEX ... ON "KnowledgeFile"("knowledgeBaseId", "sha256")`（若 diff 未生成）。

- [ ] **Step 4: 应用迁移（非交互路径）**

Run: `cd water-erp/apps/api && npx prisma db execute --file prisma/migrations/20261106000000_knowledge_file_async_status/migration.sql && npx prisma migrate resolve --applied 20261106000000_knowledge_file_async_status && npx prisma generate && npx prisma migrate status`
Expected: resolve `marked as applied`；status 无 pending；generate 成功。

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/api/prisma/schema.prisma water-erp/apps/api/prisma/migrations/20261106000000_knowledge_file_async_status/ water-erp/apps/api/prisma/seed-data/KnowledgeFile.json
git commit -m "feat(knowledge): KnowledgeFile 增异步解析状态字段（status/进度/error/indexed/sha256）+ 存量回填 READY + seed 快照补 status"
```

### Task 2: OCR 进度回调（ocrPdf onProgress → DocumentParser 穿透）

**Files:**
- Modify: `water-erp/apps/api/src/local-ai/ocr.service.ts`（`ocrPdf`/`ocrPdfUncached`/`ocrPdfBatched`）
- Modify: `water-erp/apps/api/src/knowledge/services/document-parser.service.ts`（`parse`/`parseWithOcr`/`parsePdf`/`parsePdfWithOcr` 增选参）
- Test: `water-erp/apps/api/src/local-ai/ocr.service.spec.ts`

**Interfaces:**
- Produces: `ocrPdf(buffer: Buffer, maxPages?: number, onProgress?: (processed: number, total: number) => void): Promise<OcrResult>`；`DocumentParserService.parse(buffer: Buffer, mimeType: string, fileName?: string, onProgress?: (processed: number, total: number) => void): Promise<string>`。Task 3 的 processor 按此签名传入。
- 约束：`onProgress` **不入 cacheKey**（函数非数据）；缓存命中路径不回调（结果已就绪，进度无意义）。

- [ ] **Step 1: 写失败测试（加进 ocr.service.spec.ts 既有「恒定批次」describe）**

复用该文件 `mockRecordingFetch`/大文件 fixture（构造超 `LARGE_FILE_THRESHOLD_MB` 的 buffer 触发 `ocrPdfBatched`，100 页 → 3 批）。断言：

```ts
const events: Array<[number, number]> = [];
await svc.ocrPdf(big, 0, (p, t) => events.push([p, t]));
expect(events[0]).toEqual([0, 100]);            // 页数探测后先报总数
expect(events.map((e) => e[0])).toEqual([0, 40, 80, 100]); // 每批累加
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/apps/api && ../../node_modules/.bin/jest src/local-ai/ocr.service.spec.ts`
Expected: FAIL（ocrPdf 不接受第三参 / events 空）

- [ ] **Step 3: 实现**

`ocrPdfBatched(buffer, maxPages, onProgress)`：页数探测得 `effectivePages` 后调 `onProgress?.(0, effectivePages)`；每批完成 `allPages.push` 后调 `onProgress?.(allPages.length, effectivePages)`。`ocrPdf`/`ocrPdfUncached` 加选参向下穿透（`ocrPdfSingle` 分支完成后回调一次 `(processedPages, pageCount)`）。document-parser：`parse`/`parseWithOcr` 尾参穿透到 `parsePdf`/`parsePdfWithOcr` 的 `ocrPdf` 调用（稀疏回退与乱码恢复两处 OCR 调用都传）。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS（含既有用例全绿——缓存用例验证 onProgress 不影响缓存键）

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/api/src/local-ai/ocr.service.ts water-erp/apps/api/src/local-ai/ocr.service.spec.ts water-erp/apps/api/src/knowledge/services/document-parser.service.ts
git commit -m "feat(ocr): ocrPdf/parse 增 onProgress 回调——批次粒度进度供知识库异步解析回写"
```

### Task 3: knowledge-parse 队列 + processor（并入 ai-bid worker）

**Files:**
- Create: `water-erp/apps/api/src/knowledge/queues/knowledge-queue.module.ts`
- Create: `water-erp/apps/api/src/knowledge/queues/knowledge-parse.processor.ts`
- Create: `water-erp/apps/api/src/knowledge/queues/knowledge-parse.processor.spec.ts`
- Modify: `water-erp/apps/api/src/knowledge/knowledge.module.ts`（import 队列模块）
- Modify: `water-erp/apps/api/src/ai-bid-analysis-worker.module.ts`（import KnowledgeModule + provider processor）

**Interfaces:**
- Consumes: Task 1 字段；Task 2 `parse(buffer, mime, fileName, onProgress)`；既有 `StorageService.download(objectKey): Promise<Buffer>`、`TextSplitterService.split`、`EmbeddingService.embed`、`VectorSearchService.insertChunks/deleteByFileId`。
- Produces: 队列名常量 `KNOWLEDGE_PARSE_QUEUE = 'knowledge-parse'`（export 自 knowledge-queue.module.ts）；processor 类 `KnowledgeParseProcessor`；job 数据 `{ fileId: string }`；job opts（入队方 Task 4 用）：`{ jobId: fileId, attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: true }`——死信可见性走 DB，不依赖 BullMQ failed 集。`@Processor(KNOWLEDGE_PARSE_QUEUE, { concurrency: Math.max(1, Number(process.env.KNOWLEDGE_PARSE_CONCURRENCY) || 1), lockDuration: 900_000 })`（opts 写法镜像 `bidder.processor.ts:35-38` 先例；478 页扫描件实测 ~12min，lockDuration 15min 容忍——短了会被判 stalled 无限重试）。

**代码审查发现的必修项（并入本任务）：**
1. **KnowledgeModule 移除残留的 `AuthModule` import**——模块内仅 `import type { AuthenticatedUser }` 与 `@CurrentUser` 装饰器引用（type-only/纯参数装饰器，不需 AuthModule providers）；不移除则 worker 引 KnowledgeModule 会拖进 AuthModule→NotificationModule（WS 网关）/VerificationModule，在无 HTTP 上下文的 `createApplicationContext` worker 进程里有实例化风险。API 侧守卫是全局 APP_GUARD（AppModule），移除无影响。
2. **降级路径分块落库 guard**：`VectorSearchService.validateVector(undefined)` 会抛 TypeError（`for...of undefined`）——现有同步降级路径里 insertChunks 实际静默失败、分块从未照存（2026-11-03 注释「分块照存」与现实不符）。processor 须显式 guard：`embeddings.length !== textChunks.length` 时**跳过** insertChunks 并 info 级日志（行为与现状等价，仅日志降噪）；不改 VectorSearchService（超本计划范围）。

- [ ] **Step 1: 写失败测试（processor spec，全 mock：prisma/storage/parser/splitter/embedding/vectorSearch）**

用例与断言（job 对象 mock `{ data: { fileId }, attemptsMade, opts: { attempts } } as Job`）：

```ts
it('PARSING → READY：下载→解析→分块→嵌入→落 content/chunkCount/indexed:true → 插向量')
it('嵌入失败 → READY + indexed:false（降级语义，非 FAILED）')
it('progress 回调 → update 写 processedPages/totalPages')
it('行不存在（已删除）→ no-op：无 update、无 insert、不抛')
it('解析抛错且非末次尝试 → rethrow 原错误、不写 FAILED')
it('解析抛错且末次尝试(attemptsMade>=attempts) → update status=FAILED + error 消息、不 rethrow')
it('行 status 非 PARSING（如 READY 旧 job 重复）→ no-op')
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/apps/api && ../../node_modules/.bin/jest src/knowledge/queues/knowledge-parse.processor.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`knowledge-queue.module.ts`：`BullModule.registerQueue({ name: KNOWLEDGE_PARSE_QUEUE })`，export `[BullModule]`（照 AiBidQueueModule 模式）。`KnowledgeModule` imports 加它、**移除 AuthModule**（见必修项 1）。processor `extends WorkerHost`（照 tender.processor.ts 模式）：`process()` = 查行（无/非 PARSING → return）→ `storage.download(objectKey)` → `parser.parse(buf, mimeType, fileName, (p, t) => prisma.knowledgeFile.update({ where: { id }, data: { processedPages: p, ...(t ? { totalPages: t } : {}) } }))` → split → embed（catch → `embeddings=[]; indexed=false`）→ `update status READY, content, chunkCount, indexed` → `embeddings.length === textChunks.length` 时才 `vectorSearch.insertChunks(...)`（必修项 2 的 guard；写入失败仅 log 不翻 FAILED——文件已 READY 可 reindex）→ catch 外层按 attempts 定 FAILED/rethrow（FAILED 的 error 存 `err.message` 截断 500 字符）。Worker module：imports 加 `KnowledgeModule` **与 `KnowledgeQueueModule`**（processor 所在模块作用域需 queue provider 可见——照 AiBidAnalysisWorkerModule 直接 import AiBidQueueModule 先例），providers 加 `KnowledgeParseProcessor`。

- [ ] **Step 4: 跑测试确认通过 + 全量单测回归**

Run: `cd water-erp/apps/api && ./node_modules/.bin/jest src/knowledge/ && ./node_modules/.bin/jest src/local-ai/ocr.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/api/src/knowledge/ water-erp/apps/api/src/ai-bid-analysis-worker.module.ts
git commit -m "feat(knowledge): knowledge-parse 队列 processor——后台解析/进度回写/READY-FAILED 状态机，并入 ai-bid worker"
```

### Task 4: 上传改 202 + sha256 同库去重 + retry 端点

**Files:**
- Modify: `water-erp/apps/api/src/knowledge/knowledge.service.ts`（uploadFile 重写 + retryFile 新增；注入 `@InjectQueue(KNOWLEDGE_PARSE_QUEUE) parseQueue: Queue`）
- Modify: `water-erp/apps/api/src/knowledge/knowledge.controller.ts`（uploadFile 加 `@HttpCode(HttpStatus.ACCEPTED)`；新增 `POST :id/files/:fileId/retry`）
- Rewrite: `water-erp/apps/api/src/knowledge/knowledge-upload-degrade.spec.ts` → `water-erp/apps/api/src/knowledge/knowledge-upload-async.spec.ts`（旧契约测试整体重写，git rm 旧文件）

**Interfaces:**
- Consumes: Task 3 的 `KNOWLEDGE_PARSE_QUEUE` 与 job opts。
- Produces: `uploadFile` 返回 `KnowledgeFile & { deduplicated?: boolean }`（HTTP 202）；`retryFile(kbId, fileId, user)` 返回更新后行（FAILED→PARSING 重入队；非 FAILED 抛 `BadRequestException('仅解析失败的文件可重试')`）。响应不再含瞬态 `indexed` 布尔（降级标志已持久化在行上）。

- [ ] **Step 1: 写失败测试（新 spec，mock 同旧 degrade spec 风格 + queue.add mock）**

用例：

```ts
it('上传 → 建 PARSING 行 + sha256 落列 + queue.add({fileId}, {jobId:fileId, attempts:3, removeOnFail:true})，不调 parser/embedding')
it('同库同 sha256 已 PARSING → 返回既有行 deduplicated:true，不建行不入队')
it('同库同 sha256 已 READY → 同上')
it('同库同 sha256 已 FAILED → 复用该行重置 PARSING/error/进度并重新入队（不建新行）')
it('retryFile：FAILED 行 → 重置+入队；READY 行 → BadRequest')
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/apps/api && ./node_modules/.bin/jest src/knowledge/knowledge-upload-async.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`uploadFile`：assertEditable → `crypto.createHash('sha256')` 算哈希（118MB ≈0.5s，预算内）→ 去重查询 `findFirst({ where: { knowledgeBaseId, sha256, status: { in: ['PARSING','READY'] } } })` 命中即返回 `{...row, deduplicated: true}` → FAILED 同 sha 行复用（update 重置 status/error/processedPages/totalPages/chunkCount/indexed/objectKey 等并 best-effort 删旧 MinIO 对象）→ 否则 create（status PARSING）→ `parseQueue.add('parse', { fileId }, opts)` → 返回行。**不再内联** parse/split/embed/insert（全数移入 Task 3 processor）。controller retry 路由挂 `@HttpCode(HttpStatus.ACCEPTED)`。

- [ ] **Step 4: 跑测试确认通过 + knowledge 目录全绿**

Run: `cd water-erp/apps/api && ./node_modules/.bin/jest src/knowledge/`
Expected: PASS（旧 degrade spec 已删，无引用残留——`grep -r knowledge-upload-degrade` 为空）

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/api/src/knowledge/knowledge.service.ts water-erp/apps/api/src/knowledge/knowledge.controller.ts water-erp/apps/api/src/knowledge/knowledge-upload-async.spec.ts
git rm water-erp/apps/api/src/knowledge/knowledge-upload-degrade.spec.ts
git commit -m "feat(knowledge): 上传收件即 202+入队，sha256 同库去重，FAILED 可 retry——同步解析链拆除"
```

### Task 5: 读端口径收口（PARSING 不可检索 + 面板取数带状态）

**Files:**
- Modify: `water-erp/apps/api/src/tender-review/services/rule-extractor.service.ts:68`（findMany where 加 `status: 'READY'`）
- Modify: `water-erp/apps/api/src/knowledge/knowledge.service.ts`（assistantOverview 的 files select 增 `status/processedPages/totalPages/error/indexed`）
- Test: 既有 spec 回归（rule-extractor 若无 spec 则靠 tsc + 全量单测）

**Interfaces:**
- Produces: 检索侧不变式——仅 `status:'READY'` 的文件参与规则提取；向量检索天然只命中已写 chunks（PARSING 无 chunks），无需改动。

- [ ] **Step 1: rule-extractor 加 READY 过滤（content 非空判断保留作双保险）**

- [ ] **Step 2: assistantOverview select 补状态字段（前端 Task 6 要用）**

- [ ] **Step 3: 回归**

Run: `cd water-erp/apps/api && npx tsc --noEmit -p tsconfig.json && ./node_modules/.bin/jest src/knowledge/ src/tender-review/`
Expected: tsc 0 错误；jest PASS

- [ ] **Step 4: Commit**

```bash
git add water-erp/apps/api/src/tender-review/services/rule-extractor.service.ts water-erp/apps/api/src/knowledge/knowledge.service.ts
git commit -m "feat(knowledge): 检索读端收口——规则提取仅 READY；水叮当面析取数带解析状态"
```

### Task 6: web 前端——上传即回 + PARSING/FAILED 态 + 轮询 + 重试

**Files:**
- Modify: `water-erp/apps/web/src/lib/types/tender-review.ts:14`（KnowledgeFile 增 `status?: 'PARSING'|'READY'|'FAILED'; processedPages?: number; totalPages?: number | null; error?: string | null; indexed?: boolean`）
- Modify: `water-erp/apps/web/src/lib/api/knowledge.ts`（`uploadKnowledgeFileWithStatus` 重写为返回整行；新增 `retryKnowledgeFile(kbId, fileId)`；`KbFile` 类型增状态字段）
- Modify: `water-erp/apps/web/src/components/tender-review/files-panel-compact.tsx`（上传 toast 文案「已上传，后台解析中」；文件行状态徽章；FAILED 行「重试」按钮；存在 PARSING 时 5s 轮询 refreshKnowledgeBases、无则停）
- Modify: `water-erp/apps/web/src/components/assistant/knowledge-panel.tsx`（上传 toast 改「已上传，解析中」；行状态徽章 `解析中(x/y页)`/`解析失败·重试`/`已入库`+indexed:false 提示重建索引；面板 open 且有 PARSING 时 5s 轮询 load()）

**Interfaces:**
- Consumes: Task 4/5 的 API 契约（202 返回行、retry 端点、assistantOverview 新字段）。
- Produces: 无（叶子 UI）。

- [ ] **Step 1: types + api 层改动**（如上字段与函数；`fetch` 对 202 天然 `res.ok`，无需分支；`uploadKnowledgeFile` 既有 `{ onProgress?, signal? }` opts 形参保留不动——代码审查发现其签名已带进度/中止支持）

- [ ] **Step 2: 两个面板组件改造**

上传后立刻 `refreshKnowledgeBases()/load()`（PARSING 行即时可见）；轮询用 `useEffect` + `setInterval(5000)`，依赖「是否存在 PARSING 文件」布尔，false 时清定时器；FAILED 行重试按钮调 `retryKnowledgeFile` 后刷新。toast 文案不再出现「索引完成」（完成时点已移后台）。视觉遵循 cgzxui 既有类名（徽章用 `neu-tab-count` 风格小标签，禁 emoji/渐变）。

- [ ] **Step 3: 验证**

Run: `cd water-erp && pnpm --filter web exec tsc --noEmit`
Expected: 0 错误

- [ ] **Step 4: Commit**

```bash
git add water-erp/apps/web/src/lib/types/tender-review.ts water-erp/apps/web/src/lib/api/knowledge.ts water-erp/apps/web/src/components/tender-review/files-panel-compact.tsx water-erp/apps/web/src/components/assistant/knowledge-panel.tsx
git commit -m "feat(web): 知识库上传即回+解析状态轮询展示+失败重试——双面板（审查端/水叮当）"
```

### Task 7: 端到端冒烟 + CLAUDE.md 落注

**Files:**
- Modify: `water-erp/CLAUDE.md`（Bash 编辑：Knowledge 模块行 + AI Bid Analysis Worker 节补 knowledge-parse 队列与重启耦合注记）

**Interfaces:** 无。

- [ ] **Step 1: 冒烟——API + worker 起动、上传→READY 全链**

已有 dev 环境在跑则只重启 api 与 worker：`cd water-erp && pnpm dev:kill` 后按需起 `pnpm dev`（或最小集 `pnpm dev:api` + `pnpm --filter api dev:worker:ai-bid-analysis`）。验证：

```bash
# worker 日志出现 knowledge-parse 队列注册/消费（无报错）
# curl 登录任一 leader 账号（X-Portal: web）后：
curl -s -F "file=@<小pdf>" -b "token_web=<...>" -H "X-Portal: web" http://localhost:4001/api/knowledge/<kbId>/files
# 预期：立即 202 返回行 status=PARSING；数秒后 GET /api/knowledge 行 status=READY、chunkCount>0
# 重复同命令 → deduplicated:true、不新增行
```

Expected: 202 <5s（小文件 <1s）；轮询见 PARSING→READY；重复上传去重生效。

- [ ] **Step 2: 全量单测回归**

Run: `cd water-erp/apps/api && ./node_modules/.bin/jest`
Expected: 全绿（既有套件无回归）

- [ ] **Step 3: CLAUDE.md 落注（Bash heredoc/sed）**

Knowledge 模块行补「文件上传解析异步化（2026-11-06）：收件即 202+`knowledge-parse` BullMQ 队列，由 ai-bid worker 进程消费（改解析/OCR 源码须杀 worker 重启，连带中断分析任务——已知代价）；`KnowledgeFile.status` PARSING/READY/FAILED+进度，FAILED 可 retry，同库 sha256 去重」；AI Bid Analysis Worker 节补一行队列清单含 knowledge-parse。

- [ ] **Step 4: Commit**

```bash
git add water-erp/CLAUDE.md
git commit -m "docs(claude-md): 知识库解析异步化落注——队列归属 worker 与运维注记"
```
