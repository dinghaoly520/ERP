# 双信封大文件分块加密 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 供应商双信封投标加密/开标解密改造为 Worker 流式分块（滚动 IV），服务端剥外层同步分块化，上传链路修复——500MB 单件全程可用、≤100MB 无冻结。

**Architecture:** `@water-erp/ukey` 新增分块 SM4-CBC 类与增量 SHA-256（唯一密码学新增面，sm-crypto 滚动 IV 续链、与 one-shot 逐字节一致）；供应商门户 crypto worker（纯数据面，盾交互留主线程）经可注入 `CryptoEngine` 接入投递/解密/补传三收口点；apps/api 外层解密改两遍流式（哈希闸语义不变）；上传 XHR 超时按体积缩放。

**Tech Stack:** TypeScript、sm-crypto 0.4、Web Worker + `File.stream()`/`fetch` streaming、Next 16.2.3（Turbopack）、NestJS + minio-js、jest（ukey/api）、node:test via tsx（supplier-portal）。

**Spec:** `docs/superpowers/specs/2026-11-05-dual-envelope-chunked-encryption-design.md`（已批准 v3；含定案纪要/实测基线/风险坑——执行前必读）

## Global Constraints

- 密码实现唯一源 = sm-crypto；CBC 链式**禁止并行分块**；分块必须缓冲 16B 未对齐尾（sm-crypto `padding:'none'` 非对齐输入**静默丢尾**不报错）
- 解密方向给 sm-crypto **数组直传**，禁止 hex 字符串往返（吞吐腰斩，spec §3.3）
- 信封字节级零变化：同 key/IV 下新旧实现产出相同密文/哈希/envelope——byte-equality 测试是回归闸
- `@water-erp/ukey` dist 消费：改 src 后必须 `pnpm --filter @water-erp/ukey build`，否则门户拿到旧 dist
- 测试跑法：ukey=`pnpm --filter @water-erp/ukey test`（jest，共置 `*.spec.ts`）；supplier-portal=`pnpm --filter supplier-portal-next test`（`tsx --test`，**glob 固定**——新测试文件只能放 `src/utils/__tests__/` 或 `src/lib/__tests__/`，worker 目录不在 glob 内）；api=`pnpm --filter api test -- <pattern>`
- Next dev 一律 Turbopack（无 `--webpack`）；Node 24
- 并行会话协作约定（CLAUDE.md）：**禁 `git add -A`/`git add .`**，只 add 明确路径；commit 前查 `git status`；共享高危文件（`apps/api/src/bid/bid-decrypt.service.ts`、`dual-envelope.service.ts`、`supplier-portal.service.ts`）对方工作区不干净时避让
- 不主动 push（commit 后仅提醒未推送数）
- 提交信息带 Co-Authored-By: Claude Code <noreply@anthropic.com> 尾行

## Review Focus

1. **块边界尺寸类**（空文件 0、恰好 16 整除、整除±1）：加密须补出与 one-shot 相同的整块 PKCS#7、解密还原原文字节——Task 2 一致性 spec 全尺寸锁定（spec §7 风险第 2/3 条）
2. **任意非对齐 update 喂块**（任意尺寸流式 chunk，含 1 字节喂法）：尾巴缓冲与跨块拼接正确——Task 2 随机切分 feed 用例
3. **密文损坏**（末块填充非法/中段字节翻转）：解密端必须抛错（服务端 `OUTER_FAILED` 语义、浏览器端报错文案），不得静默产出错文——Task 2 padding-invalid 用例 + Task 11 哈希闸用例
4. **进度异常类**（Content-Length 缺失 totalBytes=0、进度回调风暴）：进度降级只显示已处理字节、节流不淹没消息通道——Task 4 节流/单调断言 + Task 5 totalBytes=0 用例 + Task 7 `formatProgress` 零总长守卫
5. **worker 不可用**（SSR/构造抛错/打包失败）：`getDefaultCryptoEngine` 内 worker null → local 分块降级，功能不丢、不白屏——Task 5 构造失败返回 null + 默认引擎回退用例

---

### Task 1: ukey 增量 SHA-256

**Files:**
- Create: `water-erp/packages/ukey/src/sha256-increment.ts`
- Modify: `water-erp/packages/ukey/src/index.ts`（加一行导出）
- Test: `water-erp/packages/ukey/src/sha256-increment.spec.ts`

**Interfaces:**
- Produces: `class Sha256Incremental { update(data: Uint8Array): void; finalHex(): string }`——finalHex 后实例不可再用（再 update 抛错）。Task 4/11 消费。

- [ ] **Step 1: 写失败测试**

`sha256-increment.spec.ts`：随机 buffer（尺寸 0/1/55/56/63/64/65/1000/1MB+7）按随机切分点多次 `update`，`finalHex()` 与 `crypto.subtle.digest('SHA-256', 整buffer)` 十六进制比对；同输入两实例分不同切分点结果相同；finalHex 后再 update 抛错。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/packages/ukey && npx jest sha256-increment --silent`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

标准 SHA-256（Uint8Array/Uint32Array、K 常量表、64B 分组、长度计数按位拼接）。注意 1MB+7 这类跨多分组的长度位编码。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd water-erp/packages/ukey && npx jest sha256-increment --silent`
Expected: PASS

- [ ] **Step 5: index.ts 加 `export * from './sha256-increment';` 后提交**

```bash
cd water-erp && git add packages/ukey/src/sha256-increment.ts packages/ukey/src/sha256-increment.spec.ts packages/ukey/src/index.ts
git commit -m "feat(ukey): 增量 SHA-256（大文件流式哈希基元）"
```

---

### Task 2: ukey 分块 SM4-CBC（滚动 IV 续链）

**Files:**
- Create: `water-erp/packages/ukey/src/sm4-cbc-chunked.ts`
- Modify: `water-erp/packages/ukey/src/index.ts`（加一行导出）
- Test: `water-erp/packages/ukey/src/sm4-cbc-chunked.spec.ts`

**Interfaces:**
- Consumes: `sm4Encrypt/sm4Decrypt`（`./sm-crypto-layer`，one-shot 基准）
- Produces:
  - `export const SM4_CHUNK_BYTES = 2 * 1024 * 1024;`
  - `class Sm4CbcChunkedEncryptor { constructor(dek: { keyHex: string; ivHex: string }); update(chunk: Uint8Array): Uint8Array; final(): Uint8Array }`——update 返回本次完成的密文块字节；final 补 PKCS#7（含整除补整块）并返回尾段密文；累计输出 = one-shot 密文
  - `class Sm4CbcChunkedDecryptor { constructor(dek: { keyHex: string; ivHex: string }); update(chunk: Uint8Array): Uint8Array; final(): Uint8Array }`——update 扣留最后一个密文块不输出（不知是否为末块）；final 解扣留块、校验并剥 PKCS#7（非法抛 `Error('padding is invalid')`）；累计输出 = 原文

- [ ] **Step 1: 写失败测试**

`sm4-cbc-chunked.spec.ts`（尺寸矩阵：0/1/15/16/17/31/32/33/1000/4096/65543/1MB/1MB+3；每尺寸随机 key/IV）：
- 加密一致：随机切分点多次 update + final，拼接输出与 `sm4Encrypt(key, iv, bytesToHex(plain))` hex 解码**逐字节相等**（覆盖整除补整块、空文件=仅一块填充）
- 解密一致：one-shot 密文按随机切分喂 Decryptor，拼接与原文相等
- 加解密往返：Encryptor 输出喂 Decryptor 还原原文
- 单字节喂法：1B×N 次 update（小尺寸用例）结果不变
- 损坏抛错：末块翻转一字节 → final 抛 `padding is invalid`；密文截断一块 → final 抛错
- 字节计数契约：encryptor 总输出 = plain + padLen（padLen = 16 - plain%16，整除时 16）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/packages/ukey && npx jest sm4-cbc-chunked --silent`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

要点：构造时预转 key/iv 为 hex 串；内部维护 `pendingTail: Uint8Array`（未满 16B 对齐的尾巴）与 `lastCipherBlockHex`（首块=ivHex）；中间块调 `sm4.encrypt(Array.from(对齐段), keyHex, { mode:'cbc', padding:'none', iv: lastCipherBlockHex, output:'array' })`，更新 lastCipherBlockHex=输出末 16B；末段（final）改 `padding:'pkcs#7'`。Decryptor 对称：`sm4.decrypt(数组, keyHex, { mode:'cbc', padding:'none'/'pkcs#7', iv, output:'array' })`，**数组直传禁 hex 往返**。输出 Uint8Array 拼接用预分配 set，禁 push(...spread)。

- [ ] **Step 4: 跑测试确认通过（全量回归）**

Run: `cd water-erp/packages/ukey && npx jest --silent && pnpm --filter @water-erp/ukey build`
Expected: 全 PASS + build 成功

- [ ] **Step 5: 提交**

```bash
cd water-erp && git add packages/ukey/src/sm4-cbc-chunked.ts packages/ukey/src/sm4-cbc-chunked.spec.ts packages/ukey/src/index.ts
git commit -m "feat(ukey): SM4-CBC 分块类——滚动 IV 续链与 one-shot 逐字节一致（48+ 组一致性闸）"
```

---

### Task 3: Worker 打包 spike（Turbopack 双模式验证）

**Files:**
- Create: `water-erp/apps/supplier-portal-next/src/workers/crypto-worker.ts`（先骨架：`self.onmessage` 回 echo）
- Create: `water-erp/apps/supplier-portal-next/src/utils/crypto-engine.ts`（先仅 `createWorkerCryptoEngine()` 内 `new Worker(new URL('../workers/crypto-worker.ts', import.meta.url), { type: 'module' })`，try/catch 返回 null；完整协议 Task 5 实现）
- Modify: `water-erp/docs/superpowers/specs/2026-11-05-dual-envelope-chunked-encryption-design.md` §4.4（spike 结论回写）

**Interfaces:**
- Produces: worker 实例化模式定案（`new Worker(new URL(...))` 是否可用；不可用则换兜底②并记录）——Task 5 依赖此结论

- [ ] **Step 1: 写骨架并接线实例化**

crypto-worker.ts 骨架收 `{id,cmd:'ping'}` 回 `{id,type:'pong'}`；crypto-engine.ts `createWorkerCryptoEngine(): Worker | null`（`typeof window === 'undefined'` 或构造抛错 → null）。

- [ ] **Step 2: dev 模式验证**

Run: `cd water-erp && pnpm dev:supplier`（后台起）→ `curl -s -o /dev/null -w '%{http_code}' http://localhost:3004` → 200；用 chrome-devtools MCP 开 `http://localhost:3004` 任一页面，console 执行探针：`import('/_next/static/chunks/…')` 不可行——直接临时在登录页组件挂 `useEffect(() => { const e = createWorkerCryptoEngine(); console.log('worker:', !!e); e?.postPing?.(); }, [])`（探针代码用完即删），确认 worker 构造成功且 ping/pong 通。
Expected: worker 构造成功、echo 通；Turbopack 终端无 worker 相关错误

- [ ] **Step 3: build 模式验证**

Run: `cd water-erp && pnpm build:supplier 2>&1 | tail -5` 且 `ls .next/static/chunks | grep -i worker`（或独立 worker chunk 出现）。
Expected: build 成功且产出 worker chunk

- [ ] **Step 4: 结论回写 spec §4.4 并提交**

成功 → 记「`new URL` 语法 dev/build 双过」；失败 → 按兜底链②（构建期静态产物 + 显式 URL）改造并记录。随后：

```bash
cd water-erp && git add apps/supplier-portal-next/src/workers/crypto-worker.ts apps/supplier-portal-next/src/utils/crypto-engine.ts docs/superpowers/specs/2026-11-05-dual-envelope-chunked-encryption-design.md
git commit -m "feat(supplier-portal): crypto worker 骨架 + Turbopack 打包 spike 定案"
```

---

### Task 4: 流式管线 `crypto-pipeline.ts`（纯函数，Node 可测）

**Files:**
- Create: `water-erp/apps/supplier-portal-next/src/utils/crypto-pipeline.ts`
- Test: `water-erp/apps/supplier-portal-next/src/utils/__tests__/crypto-pipeline.test.ts`（门户 test glob 已覆盖此目录）

**Interfaces:**
- Consumes: Task 1/2 的 `Sha256Incremental`、`Sm4CbcChunkedEncryptor/Decryptor`（`@water-erp/ukey`，**须先 `pnpm --filter @water-erp/ukey build`**）
- Produces:
  - `type DekHex = { keyHex: string; ivHex: string }`
  - `interface EncryptFileResult { outerBlob: Blob; plainSha256: string; innerSha256: string; outerSha256: string; plainBytes: number; innerBytes: number; outerBytes: number }`
  - `function encryptFileStream(source: ReadableStream<Uint8Array>, totalBytes: number, dekS: DekHex, dekA: DekHex, onProgress?: (doneBytes: number) => void | Promise<void>): Promise<EncryptFileResult>`
  - `interface DecryptStreamResult { plainBlob: Blob; plainSha256: string; plainBytes: number }`
  - `function decryptStream(source: ReadableStream<Uint8Array>, dek: DekHex, onProgress?: (doneBytes: number) => void | Promise<void>): Promise<DecryptStreamResult>`

- [ ] **Step 1: 写失败测试**

`crypto-pipeline.test.ts`（node:test，Node 24 自带 ReadableStream/Blob/webcrypto）：
- **管线等价锚**：随机 plain（尺寸 0/1/16/1000/300KB+7——控制测试时长）→ `ReadableStream` 喂 `encryptFileStream`；手工算 one-shot 期望值 `C_inner = sm4Encrypt(dekS)`（hex→bytes）、`C_outer = sm4Encrypt(dekA, C_inner hex)`；断言 `outerBlob` 字节 == C_outer、三哈希/三字节计数与手工值相等、`innerBytes === plainBytes + (16 - plainBytes % 16 || 16)`、`outerBytes === innerBytes + 16`
- **往返**：C_outer 流喂 `decryptStream` → plainBlob 字节 == 原 plain、plainSha256 相等
- **进度**：doneBytes 单调不减、最终 == totalBytes（加密侧）/密文长（解密侧）；onProgress 被节流为约每 `SM4_CHUNK_BYTES` 一档（调用次数 ≤ 明文块数 + 2）
- **空文件**：encryptFileStream 全零长度 → outerBlob == 16B 单填充块密文（与 one-shot 空输入一致）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp && pnpm --filter supplier-portal-next test 2>&1 | grep -A2 crypto-pipeline`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

加密：`getReader()` 循环 → EncryptorS.update → `Sha256Incremental(inner).update` → EncryptorA.update → outer hash update + `outerParts.push` + 进度（按明文 doneBytes 计）；EOF 后两个 final() 依序喂下一层，`new Blob(outerParts, { type: 'application/octet-stream' })`。解密对称（进度按密文 doneBytes 计）。管道内 C_inner 零全量驻留（块即弃）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd water-erp && pnpm --filter supplier-portal-next test`
Expected: 全 PASS（含既有 dual-v3-client.test.ts 不受影响）

- [ ] **Step 5: 提交**

```bash
cd water-erp && git add apps/supplier-portal-next/src/utils/crypto-pipeline.ts apps/supplier-portal-next/src/utils/__tests__/crypto-pipeline.test.ts
git commit -m "feat(supplier-portal): 双层流式加密/解密管线——C_inner 零驻留、增量哈希、节流进度"
```

---

### Task 5: `crypto-engine.ts`（worker facade + local 降级）

**Files:**
- Modify: `water-erp/apps/supplier-portal-next/src/utils/crypto-engine.ts`（Task 3 骨架填全）
- Modify: `water-erp/apps/supplier-portal-next/src/workers/crypto-worker.ts`（消息协议实现）
- Test: `water-erp/apps/supplier-portal-next/src/utils/__tests__/crypto-engine.test.ts`

**Interfaces:**
- Consumes: Task 4 `encryptFileStream/decryptStream` 及结果类型；Task 3 定案的 worker 实例化模式
- Produces:
  - `interface CryptoEngine { encryptFile(file: File, dekS: DekHex, dekA: DekHex, onProgress?: (doneBytes: number, totalBytes: number) => void): Promise<EncryptFileResult>; decryptUrl(url: string, dek: DekHex, onProgress?: (doneBytes: number, totalBytes: number) => void): Promise<DecryptStreamResult>; terminate(): void }`
  - `createWorkerCryptoEngine(): CryptoEngine | null`（构造/打包失败 → null）
  - `createLocalCryptoEngine(): CryptoEngine`（同进程直跑 pipeline——Node 测试与降级双用）
  - `getDefaultCryptoEngine(): CryptoEngine`（lazy：worker 优先、null 回退 local）
- worker 消息协议（spec §4.2 定案版）：`{id, cmd:'encrypt', file, dekS, dekA}` / `{id, cmd:'decrypt', url, dek}` → `{id, type:'progress', doneBytes, totalBytes}`（节流 2MB/250ms）/ `{id, type:'done', outerBlob|plainBlob, …哈希与字节}` / `{id, type:'error', message}`；worker 内 `decrypt` 用 `fetch(url, { credentials:'include', headers:{'X-Portal':'supplier'} })` + `response.body` 流，totalBytes 取 `Content-Length`（缺失=0）

- [ ] **Step 1: 写失败测试**

`crypto-engine.test.ts`：
- **local 引擎往返**：File 构造（Node 有 File）→ encryptFile → 结果与 Task 4 手工锚一致；decryptUrl 不好测（无服务）——local 引擎 decryptUrl 直接对 `fetch` 的依赖抽成可注入 `fetchImpl`（默认全局 fetch），测试注入 stub 返回 `new Response(ReadableStream)`，断言解密还原
- **协议编解码**（fake Worker：手写 mock 对象实现 postMessage/onmessage/terminate）：engine.encryptFile 发出 `{cmd:'encrypt', file, dekS, dekA}` 消息；回 progress×3 + done（携带 blob）→ resolve、onProgress 收到三次；回 error → reject(message)；**id 关联**：并发两个请求各自 done 不串线
- **terminate**：pending 请求全部 reject（取消语义）、worker.terminate 被调；**下次调用自动重建 worker**（定案：取消后重试直达，无「须手动重建」态）——测试锁定重建行为
- **构造失败**：`createWorkerCryptoEngine` 在 `Worker` 抛错时返回 null（注入 fake WorkerCtor 抛错）；`getDefaultCryptoEngine` 对 null 回退 `createLocalCryptoEngine()`

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp && pnpm --filter supplier-portal-next test 2>&1 | grep -A2 crypto-engine`
Expected: FAIL

- [ ] **Step 3: 实现**

engine：模块内单 worker 实例 + `Map<id, {resolve,reject,onProgress}>`；`terminate()` 清 Map 全 reject 后置空。worker 侧：`self.onmessage` 分发 → pipeline 调用 → progress 节流（2MB 或 250ms 先到者）→ done 带 Blob（worker 内组装，postMessage 传句柄）。local：`file.stream()` 直喂 pipeline。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd water-erp && pnpm --filter supplier-portal-next test`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd water-erp && git add apps/supplier-portal-next/src/utils/crypto-engine.ts apps/supplier-portal-next/src/workers/crypto-worker.ts apps/supplier-portal-next/src/utils/__tests__/crypto-engine.test.ts
git commit -m "feat(supplier-portal): CryptoEngine——worker 数据面 + local 降级，进度/取消/协议闭环"
```

---

### Task 6: `encryptAndUploadV3` 注入重构（消灭整读+hex 放大）

**Files:**
- Modify: `water-erp/apps/supplier-portal-next/src/utils/dual-v3-client.ts:102-201`（逐角色循环体）
- Test: `water-erp/apps/supplier-portal-next/src/utils/__tests__/dual-v3-client.test.ts`（既有用例改造）

**Interfaces:**
- Consumes: Task 5 `CryptoEngine`/`getDefaultCryptoEngine`；既有 `V3UploadDeps.uploadOuter`、`V3WrapAdapter.wrapKeyToEncCert`
- Produces: `V3UploadDeps` 增可选 `cryptoEngine?: CryptoEngine`（缺省 `getDefaultCryptoEngine()`）；**公开签名与返回结构零变化**（submit 页/补传卡无感）；sealedFields 小数据仍走 `sm4Encrypt` hex 一次成型

- [ ] **Step 1: 改造既有测试先行**

`dual-v3-client.test.ts` 既有「信封结构/哈希锚点/双密封件/fieldsCommit 闭环」用例：deps 注入 `cryptoEngine: createLocalCryptoEngine()`；新增断言——`uploadOuter` 收到的 Blob 字节 == 手工 one-shot `sm4Encrypt(dekA, sm4Encrypt(dekS, plain))`（从 fake adapter 捕获的 keyWrapJson 反解 DEK 构造期望值）；新增多文件用例（technical+coverLetter 两角色，验证逐角色 DEK 独立、进度回调按文件序）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp && pnpm --filter supplier-portal-next test 2>&1 | grep -A3 dual-v3`
Expected: FAIL（现实现走整读路径、无 cryptoEngine 注入点）

- [ ] **Step 3: 重构循环体**

逐角色：主线程 `randomHex(16)` 生成 dekS/dekA → `engine.encryptFile(file, dekS, dekA, onProgress透传)` → `uploadOuter(role, res.outerBlob, name.outer)`（服务端哈希交叉核对保留：`uploaded.outerSha256 !== res.outerSha256` → 抛既有文案）→ kself/kadmin 封装用 dekS/dekA（`keyWrapJson`）→ entries 以 `res.plainSha256/innerSha256/innerBytes/outerBytes` 落（outerSha256 用服务端值优先）。删除 `file.arrayBuffer()`/`plainHex`/`hexToBytes(outerHex)` 旧路径。`deps.cryptoEngine ?? getDefaultCryptoEngine()` 一处收口。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd water-erp && pnpm --filter supplier-portal-next test`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd water-erp && git add apps/supplier-portal-next/src/utils/dual-v3-client.ts apps/supplier-portal-next/src/utils/__tests__/dual-v3-client.test.ts
git commit -m "refactor(supplier-portal): encryptAndUploadV3 走 CryptoEngine——整读/hex 放大清零、信封锚点不变"
```

---

### Task 7: `crypto-overlay.ts` 翻新（进度 + 防误关 + 可取消）

**Files:**
- Modify: `water-erp/apps/supplier-portal-next/src/utils/crypto-overlay.ts`（含头注释 ≤50MB 自述修正）
- Test: `water-erp/apps/supplier-portal-next/src/utils/__tests__/crypto-overlay.test.ts`

**Interfaces:**
- Produces:
  - `interface OverlayProgress { phase: string; doneBytes?: number; totalBytes?: number }`
  - `function withCryptoOverlay<T>(task: (report: (p: OverlayProgress) => void) => Promise<T>, opts?: { cancel?: () => void }): Promise<T>`——task 内 `report()` 更新遮罩进度行；`opts.cancel` 提供则显示取消按钮（点击调 cancel 并等 task 自行 reject）
  - `function formatProgress(p: OverlayProgress): string`（纯函数：`加密中 37%（185MB/500MB）` 风格；totalBytes 缺省/0 → 只显已处理 `已加密 185MB`）
- 保留：`data-sp-busy="1"`、双 rAF、引用计数、SSR 安全

- [ ] **Step 1: 写失败测试（纯逻辑部分）**

`crypto-overlay.test.ts`：`formatProgress`——有 total：百分比整数+双 MB 值；totalBytes=0/undefined：只显已处理 MB；doneBytes=0：`0%`；phase 文案原样透传。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp && pnpm --filter supplier-portal-next test 2>&1 | grep -A2 overlay`
Expected: FAIL

- [ ] **Step 3: 实现**

DOM 结构升级为卡片（沿用 B6 遮罩底色/ spinner 动画体系，卡片圆角与发丝线对齐 .impeccable 语言；纯 DOM 零 React 不变）；`report()` 更新进度行文本（DOM 直写）；取消按钮仅 `opts.cancel` 存在时渲染。头注释改述：worker 化分块加密、500MB 可用、进度+防误关。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd water-erp && pnpm --filter supplier-portal-next test`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd water-erp && git add apps/supplier-portal-next/src/utils/crypto-overlay.ts apps/supplier-portal-next/src/utils/__tests__/crypto-overlay.test.ts
git commit -m "feat(supplier-portal): 加密遮罩翻新——进度行+防误关+可取消（复活 B6 死代码）"
```

---

### Task 8: 上传链路修复（两 XHR 超时 + 解密回传进度）

**Files:**
- Modify: `water-erp/apps/supplier-portal-next/src/lib/api/supplier.ts`（`caUploadEncryptedOuter` :~110-145、`caDecryptUpload` :~101-120）
- Test: `water-erp/apps/supplier-portal-next/src/lib/__tests__/upload-timeout.test.ts`

**Interfaces:**
- Consumes: 无新依赖
- Produces:
  - `function xhrTimeoutMs(bytes: number): number`——`bytes > 50MB` 返回 `0`（禁用硬超时，走停滞判活），否则 `180000`（现状）
  - `function attachStallWatchdog(xhr: XMLHttpRequest, ms = 60_000): void`——每次 upload onprogress 复位计时器；超时 `xhr.abort()`；导出供两处 XHR 与后续复用
  - `caDecryptUpload(projectId, fd, onProgress?: (pct: number) => void)`——签名扩展，内部挂 `xhr.upload.onprogress`；`caUploadEncryptedOuter` 内部换用 `xhrTimeoutMs(blob.size)` + watchdog（公开签名不变）

- [ ] **Step 1: 写失败测试**

`upload-timeout.test.ts`（node:test，fake XMLHttpRequest 记录 timeout 赋值与 abort 调用）：
- `xhrTimeoutMs(50MB)=180000`、`xhrTimeoutMs(50MB+1)=0`、`xhrTimeoutMs(0)=180000`
- watchdog：60s 无 progress → abort 被调；有 progress 复位 → 不 abort（用假计时器/短 ms 注入）
- `caDecryptUpload` 挂 onprogress 透传（fake xhr 触发 upload.onprogress → 回调收到整数 pct）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp && pnpm --filter supplier-portal-next test 2>&1 | grep -A2 upload-timeout`
Expected: FAIL

- [ ] **Step 3: 实现**

两 XHR 按接口改：`xhr.timeout = xhrTimeoutMs(size)`；size>50MB 时 `attachStallWatchdog(xhr)`；`caDecryptUpload` 加 onProgress 形参——其 size 取 fd 内各 Blob 尺寸求和（FormData 无 length，遍历 entries 累加）。错误文案：abort/stall → 「上传中断（网络停滞超过 60 秒），请检查网络后重试」。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd water-erp && pnpm --filter supplier-portal-next test`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd water-erp && git add apps/supplier-portal-next/src/lib/api/supplier.ts apps/supplier-portal-next/src/lib/__tests__/upload-timeout.test.ts
git commit -m "fix(supplier-portal): 上传 XHR 超时按体积缩放+停滞判活；解密回传补进度（500MB 广域网可达）"
```

---

### Task 9: 投递页 + 补传卡接线（遮罩进度相位 + 取消）

**Files:**
- Modify: `water-erp/apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx:481-530`（③ 段）
- Modify: `water-erp/apps/supplier-portal-next/src/components/ca-bid-reupload-card.tsx:96` 附近（`encryptAndUploadV3` 调用段，同法包遮罩——spec §4.3.4 三收口点之一）

**Interfaces:**
- Consumes: Task 7 `withCryptoOverlay/OverlayProgress`、Task 6 `deps.cryptoEngine`、Task 5 `getDefaultCryptoEngine().terminate()`
- Produces: 无（页面行为）——进度相位文案：`加密中 i/n`（engine onProgress）→ `上传中 i/n`（既有 uploadOuter onProgress 百分比）

- [ ] **Step 1: 接线实现**

`encryptAndUploadV3` 调用整段包 `withCryptoOverlay(async (report) => {...}, { cancel: () => getDefaultCryptoEngine().terminate() })`；`uploadOuter` deps 透传 `onProgress: (done, total) => report({ phase: '加密中', doneBytes: done, totalBytes: total })`；上传进度沿用既有 `setSubmitProgress`（遮罩内同步显示 `上传中 i/n xx%`——report 调用 phase 切换）。取消触发后 catch 取消错误 → 回到表单态、toast「已取消加密，文件未提交」。④ 签名/⑤ 提交段仍在遮罩外（既有 setSubmitNote 流程不变）。**补传卡**（`ca-bid-reupload-card.tsx` 的 `encryptAndUploadV3` 调用段）同法包遮罩与取消——第三收口点。

- [ ] **Step 2: 手动冒烟（本机 SCCA 测试盾 01/02，见 memory scca-test-shield-allocation）**

小文件（1-5MB）真盾走完整投递：遮罩出现→加密进度→上传进度→签名→提交成功；投递中点取消→回表单可重投。构建验证：`cd water-erp && pnpm --filter supplier-portal-next build`（tsc 随 build 过）。
Expected: 全流程成功、无冻结帧

- [ ] **Step 3: 提交**

```bash
cd water-erp && git add "apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx" apps/supplier-portal-next/src/components/ca-bid-reupload-card.tsx
git commit -m "feat(supplier-portal): 投递页+补传卡接线流式加密——遮罩进度相位+可取消+主线程零冻结"
```

---

### Task 10: 开标解密卡接线（流式解密 + 回传进度 + 取消）

**Files:**
- Modify: `water-erp/apps/supplier-portal-next/src/components/ca-opening-decrypt-card.tsx:71-112`（解密段与上传段）
- Modify: `water-erp/apps/supplier-portal-next/src/app/(main)/my-bids/[projectId]/opening-hall/page.tsx`（仅当需透传取消态——最小改动）

**Interfaces:**
- Consumes: Task 5 `getDefaultCryptoEngine().decryptUrl/terminate`、Task 8 `caDecryptUpload` onProgress
- Produces: 无（卡片行为）——弹窗进度行：`解密 xx（xx%）…` → `上传明文 xx%`

- [ ] **Step 1: 接线实现**

循环体改：`const r = await engine.decryptUrl(f.downloadUrl, dek, (done,total) => setNote(...))` → `plainByRole[f.role] = r.plainBlob`、`plainSha256ByRole[f.role] = r.plainSha256`（哈希用 worker 值，不再主线程整算）；删除 `fetchCInner`/整块 `sm4Decrypt`。上传段：`caDecryptUpload(projectId, fd, (pct) => setNote('上传明文 ' + pct + '%'))`。busy 期间对话框加「取消」按钮（`!busy` 才可关的规则保留）→ `engine.terminate()` → 错误态回初始可重试。sealedFields/盾交互/P7 证明链逐字不动。

- [ ] **Step 2: 手动冒烟（配合 :3007 开标流程或用既有已解外层项目）**

真盾走「取包并解密」：进度行推进（下载解密%→上传%）→ 成功 toast → 唱标表出现。取消路径：解密中取消→弹窗回初始态可重试。
Expected: 全程弹窗可交互、无冻结

- [ ] **Step 3: 提交**

```bash
cd water-erp && git add apps/supplier-portal-next/src/components/ca-opening-decrypt-card.tsx "apps/supplier-portal-next/src/app/(main)/my-bids/[projectId]/opening-hall/page.tsx"
git commit -m "feat(supplier-portal): 开标解密卡流式化——worker 下载解密+回传进度+可取消"
```

---

### Task 11: 服务端外层解密分块化（两遍流 + 哈希闸语义不变）

**Files:**
- Modify: `water-erp/apps/api/src/common/crypto/dual-envelope.service.ts`（新增两方法，`decryptOuterFileV3` 原样保留）
- Modify: `water-erp/apps/api/src/bid/bid-decrypt.service.ts:373-399`（`decryptOuterOneV3` 逐角色段）
- Test: 扩 `water-erp/apps/api/src/common/crypto/dual-envelope.service.spec.ts`、`water-erp/apps/api/src/bid/bid-decrypt.service.spec.ts`

**Interfaces:**
- Consumes: Task 1/2 ukey 类（**api 消费 ukey dist——先 `pnpm --filter @water-erp/ukey build`**）；既有 `streamToBuffer`/minioClient/fencing/CAS
- Produces:
  - `DualEnvelopeService.unwrapOuterDekV3(entry: DualV3FileEntry, adminPrivateKey: string): Promise<{ keyHex: string; ivHex: string }>`（SM2 解 kadmin + unwrapDekJson，失败语义=既有 `OUTER_FAILED`）
  - `DualEnvelopeService.decryptOuterStreamV3(outerStream: AsyncIterable<Buffer>, dek: { keyHex; ivHex }, onPlainChunk: (b: Buffer) => void): Promise<{ plainBytes: number; plainSha256: string }>`（分块解密+增量哈希+计数；PKCS#7 非法 → `OUTER_FAILED`）
  - `bid-decrypt.service` 内 `written[]` 变元数据数组 `{ role, objectKey, innerBytes, innerSha256 }`（Buffer 不再驻留）；FileAsset 创建用流式算出的 size/sha256

- [ ] **Step 1: 写失败测试**

`dual-envelope.service.spec.ts` 扩：`decryptOuterStreamV3`——随机 buffer（含 >2MB 跨块）手工构造 C_outer（one-shot sm4Encrypt），按 AsyncIterable 分块喂入 → onPlainChunk 拼接 == C_inner、plainBytes/innerSha256 与整算一致；密文翻转一字节 → 抛 OUTER_FAILED；`unwrapOuterDekV3` 与既有 kadmin 构造闭环（用 spec 内既有 SM2 密钥对工具）。
`bid-decrypt.service.spec.ts` 扩：既有 decryptOuterOneV3 用例改为断言——MinIO putObject 收到流且 size=`outerBytes-16`、FileAsset 的 size/sha256 == 流式值、哈希闸失配抛 `OUTER_HASH_MISMATCH`（mock minio 流按现有 spec 手法）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp && pnpm --filter api test -- dual-envelope bid-decrypt 2>&1 | tail -15`
Expected: 新用例 FAIL

- [ ] **Step 3: 实现**

`decryptOuterOneV3` 逐角色改两遍流：①pass1 `getObject` 流 → `Sha256Incremental` → `!== entry.outerSha256` 抛既有 `OUTER_HASH_MISMATCH`；②`unwrapOuterDekV3`；③pass2 `getObject` 流 → `decryptOuterStreamV3` → onPlainChunk 推入 `Readable.from(异步生成器)` → `minioClient.putObject(bucket, objectKey, readable, entry.outerBytes - 16, {...})`；④`written.push` 元数据。**`decryptOuterOneV3` 是 v3 外层解密唯一入口**（decrypt-outer 单条/批量端点共用），以其为唯一改造点——动手前 `grep -rn "decryptOuterFileV3\|decryptOuterOneV3" apps/api/src` 验证调用图符合预期，不符则停下按实际调整并报告。fencing/CAS/短事务/监督日志/审计段**逐字不动**；`decryptOuterFileV3`（整读版）原样保留（dual-v2 存量路径与其他调用方）。

- [ ] **Step 4: 跑测试确认通过（api 全量单测）**

Run: `cd water-erp && pnpm --filter api test 2>&1 | tail -5`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd water-erp && git add apps/api/src/common/crypto/dual-envelope.service.ts apps/api/src/common/crypto/dual-envelope.service.spec.ts apps/api/src/bid/bid-decrypt.service.ts apps/api/src/bid/bid-decrypt.service.spec.ts
git commit -m "feat(api): 外层解密两遍流式化——哈希闸语义不变、C_inner 零驻留、500MB 不 OOM"
```

---

### Task 12: e2e 100MB 用例 + 基准入档 + 文档三件

**Files:**
- Modify: `water-erp/apps/api/test/bid-v3.e2e-spec.ts`（补大件用例）
- Create: `water-erp/packages/ukey/scripts/sm4-chunked-bench.js`（require dist + sm-crypto，node 直跑）
- Modify: `water-erp/docs/superpowers/specs/2026-11-05-dual-envelope-chunked-encryption-design.md`（补「实现纪要」：基准表/500MB 手测记录/部署注记）
- Modify: `water-erp/CLAUDE.md`（双信封节一句话：浏览器/服务端分块加密已落地，单件 500MB 全链可用）

**Interfaces:**
- Consumes: Task 11 服务端流式解密；既有 e2e 夹具（ukey + fake P7 构造信封）

- [ ] **Step 1: e2e 大件用例**

`bid-v3.e2e-spec.ts` 补：构造 100MB 随机明文投递（沿用既有信封构造夹具，`uploadOuter` 走真实端点）→ 触发 `decrypt-outer` → 断言 SUCCESS、返回 innerAsset、C_inner sha256 == 信封 `innerSha256`、耗时记录输出。

- [ ] **Step 2: 跑 e2e（本机隔离环境配方见 memory local-e2e-isolated-harness-seed-gotchas）**

Run: `cd water-erp && pnpm --filter api test:e2e -- bid-v3 2>&1 | tail -8`
Expected: 全 PASS（含新 100MB 用例）

- [ ] **Step 3: 基准脚本 + 入档**

`sm4-chunked-bench.js`：one-shot vs chunked 加解密 50/100MB（500MB 可选 `--big`）耗时+吞吐；跑 50/100 档，结果连同 Task 9/10 手测记录写入 spec「实现纪要」表。

- [ ] **Step 4: 手动 500MB 浏览器实测（验收 #2，记录入纪要）**

本机 dev 全链：投递 500MB（DevTools heap/任务管理器观察标签与 worker 内存 ≤1GB、进度平滑、可取消）→ :3007 解外层（API 进程稳定）→ 解密卡取包解密（同预算）。结果三行入纪要；未通过则回修对应 Task（不放过）。

- [ ] **Step 5: CLAUDE.md 一句话 + 提交**

```bash
cd water-erp && git add apps/api/test/bid-v3.e2e-spec.ts packages/ukey/scripts/sm4-chunked-bench.js docs/superpowers/specs/2026-11-05-dual-envelope-chunked-encryption-design.md CLAUDE.md
git commit -m "test(e2e): 100MB 双信封全链用例 + 分块基准入档 + 500MB 手测纪要"
```
