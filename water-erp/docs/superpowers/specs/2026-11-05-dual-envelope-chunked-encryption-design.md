# 双信封大文件分块加密 设计定案（500MB 链路补缺 ③）

> 日期：2026-11-05（同日 brainstorming 定案 + builder check 补定，v3）
> 来源：OCR 接管升级 spec 的 500MB 全链审计（见 `2026-11-04-ocr-service-takeover-config-design.md`「2026-11-05 补充」节）
> 性质：单独立项——本文件自包含，新会话零上下文可开工
> 背景裁定：单文件上传上限全库统一 500MB（已落地：API 500MB、供应商前端闸默认 500MB、OCR 页数全量透传）

## 0. 定案纪要（2026-11-05 brainstorming + builder check 两轮）

| 决策点 | 结论 | 出处 |
|---|---|---|
| D1 架构形态 | **c：Worker + 分块 + 流式读** | 用户按 spec 推荐方向确认 |
| D2 分块核心 | **sm-crypto 滚动 IV 分块**（零新密码学代码，见 §4.1） | 用户拍板 |
| D3 服务端同改 | **外层解密分块化纳入本期**（§4.5）——否则 500MB 首次开标即 API OOM，目标不达成 | 用户裁定（builder check Q1） |
| D4 内存预算口径 | 验收 #2 的 ≤1GB 按**单件大文件**算；多角色总量线性叠加入文档说明，不引入 OPFS 溢写/协议改造 | 用户裁定（builder check Q2） |
| D5 上传超时 | **两处 XHR 180s 硬超时本期一并修**（§4.6） | 用户裁定（builder check Q3） |
| 增量 SHA-256 | ukey 自写增量实现（WebCrypto 无流式摘要，无可选项） | 实现必然 |
| 死 overlay | `withCryptoOverlay` 翻新为「全屏进度+防误关」接三收口点 | 我的裁定（B6 刷新丢进度教训） |
| 降速挡 | 不做——worker 化后主线程不冻结，改为**可取消**（terminate） | 我的裁定（推翻验收 #2 括号内可选项） |
| 线程分工 | 盾交互（PIN/P7 签名/P7 解封）全留主线程；worker 是纯数据面，只收 DEK 与 File/URL | spec 硬约束细化 |
| sealedFields | 小数据 hex 一次性路径**不动**（几百字节，无收益） | 我的裁定 |
| 密码实现唯一源 | sm-crypto（不引入第二份 SM4 实现） | D2 推论 |

## 1. 问题

供应商投标走双信封：明文标书在供应商浏览器用国密 SM4 双层加密（C_inner=DEK_S、C_outer=DEK_A）后上传；开标时供应商浏览器再解密内层。现状实现是 **sm-crypto 同步阻塞、整读整算、hex 字符串中转**：

- 设计自述上限 ≤50MB：`apps/supplier-portal-next/src/utils/crypto-overlay.ts:2`
- **实测口径修正（2026-11-05 核实，比原立项书「3×」更糟）**：现路径有双重内存放大——hex 字符串（2×S）+ sm-crypto 内部 `[...inArray]` 把 Uint8Array 摊开成 `number[]`（≈8×S）+ 输出 hex 串（2×S）。100MB 文件瞬时 ~1.4GB，500MB ≈ 7GB——纯内存层面即不可行
- 主线程同步计算冻结 UI：sm-crypto JS 吞吐约 20-50MB/s（**开工先实测基线**），500MB 冻结 10-25s 以上
- 两端同病：投递加密（`encryptAndUploadV3`）与开标解密（`CaOpeningDecryptCard`）都整读进内存

## 2. 现状地图（2026-11-05 已核实）

| 文件 | 作用 / 核实结论 |
|---|---|
| `water-erp/packages/ukey/src/sm-crypto-layer.ts` | SM4/SM2/SM3 封装层（hex 进 hex 出、一次性整算——保留不动，小数据继续用） |
| `water-erp/packages/ukey/src/dual-v3.ts` | dual-v3 信封构造/校验——**信封格式零改动** |
| `water-erp/packages/ukey/src/canonical.ts` | 哈希对象=明文/密文二进制（`sha256Hex(Uint8Array)`）+ tiny JSON；大文件哈希改增量后口径不变 |
| `apps/supplier-portal-next/src/utils/dual-v3-client.ts` | `encryptAndUploadV3`：`file.arrayBuffer()` 整读 + 双层 `sm4Encrypt`——**加密端改造主战场** |
| `apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx` | 投递页（`setSubmitNote/Progress` 内联进度，同步段不重绘） |
| `apps/supplier-portal-next/src/components/ca-opening-decrypt-card.tsx` | **开标解密端（原立项书误标在 bid-portal，已定位）**：整下载 C_inner → 整块 `sm4Decrypt` → 明文全量驻内存 `plainByRole` → FormData 回传 |
| `apps/supplier-portal-next/src/components/ca-bid-reupload-card.tsx` | 补传卡，复用 `encryptAndUploadV3`——改造自动受益 |
| `apps/supplier-portal-next/src/utils/crypto-overlay.ts` | **当前是死代码**（包装的 dual-v2 收口点已随 040df9a8 删除，全库零引用）——翻新接线 |
| `apps/supplier-portal-next/src/lib/api/supplier.ts` | 两处上传 XHR 硬超时 `180000ms`（解密回传 :106 / 外层暂存上传 :128）——500MB 真实上行带宽必然超时（§4.6） |
| `apps/api/src/bid/bid-decrypt.service.ts` | **服务端外层解密（D3 纳入）**：:220/:377 `streamToBuffer` 整读 C_outer → 整块 hex 解密 → `written[]` 全角色 C_inner 驻留（仅服务 FileAsset 元数据 size/sha256）——与浏览器端同病且更重 |
| `apps/api/src/common/crypto/dual-envelope.service.ts` | `decryptOuterFileV3` :91 `outerBuf.toString('hex')` → `sm4Decrypt`——服务端 hex 放大点 |
| `apps/bid-portal` | **无交付**：`:3007 decryptOuter` 是管理方外层解密触发（服务端执行），供应商内层解密不在本门户 |

**两端均在供应商浏览器**——worker 基建只需要做在 supplier-portal-next 一个门户。

## 3. 关键技术事实（定案依据，含 2026-11-05 实测基线）

1. **sm-crypto 支持分块续链**（读源码 `sm4/index.js` 核实）：`sm4.encrypt(data, key, { mode:'cbc', padding:'none', iv, output:'array' })` 跳过填充、按 CBC 链接。对 16B 对齐的中间块，以上一密文块作 IV 续链；**末块单独 `padding:'pkcs#7'`**——产出与 one-shot `sm4Encrypt` **逐字节相同**（同一块函数、同一链接数学）。解密方向同理（`padding:'none'` 续链 + 末块 `pkcs#7` 去填充）。
   **已用一次性脚本实证（Node 24 / 本机）**：12 尺寸 × 4 切分 = 48 组加密+解密+回解全比对通过（含 16 整除、整除+1、跨块边界、1MB±3）。
2. **实测吞吐基线（2026-11-05，Node 24，改造前机器）**：
   | 操作 | one-shot（现状） | 2MB 滚动 IV 分块 |
   |---|---|---|
   | 加密 | 5.3-6.9 MB/s | **15-16.5 MB/s（2.5×）** |
   | 解密 | —（现状 hex 往返不可比） | **9.3-9.7 MB/s（数组直传）** |
   推演：100MB 双层加密 ~12s / 单层解密 ~11s；500MB 双层 ~61s / 单层 ~54s（worker 内进度+可取消，验收达标）。分块反而比现状 one-shot 快 2.5×——现有 ≤100MB 建议档位直接受益。
3. **解密路径必须数组直传**（实测铁律）：给 `sm4.decrypt` 传 hex 字符串会 hex→array 往返，吞吐腰斩（4.7 vs 9.3MB/s）——worker 内从 fetch 流拿到的 Uint8Array 须 `Array.from` 直传。
4. WebCrypto 无增量摘要——流式 SHA-256 需自写（标准算法 ~80 行，与 `crypto.subtle.digest` 交叉验证）。
5. File/Blob 可 structured clone 进出 worker；worker 内有 `fetch`（流式读 response.body）、`crypto.getRandomValues`；ArrayBuffer 可 transfer 零拷贝回传。
6. 全库无 Worker 先例——Next 16.2.3 + Turbopack 的 `new Worker(new URL('./x.ts', import.meta.url))` 打包支持**须开工第一步 spike**（风险 §7）。
7. 大文件密文以二进制 Blob 上传、信封只存 sha256/bytes——**二进制原生分块改造天然信封字节级兼容**（同 key/IV → 同密文 → 同哈希 → 信封不变）。

## 4. 技术设计

### 4.1 `@water-erp/ukey` 新增（分块核心 + 测试，Node/jest 可跑）

**`sm4-cbc-chunked.ts`**（唯一密码学新增面）：

```ts
export class Sm4CbcChunkedEncryptor {
  constructor(dek: { keyHex: string; ivHex: string });   // IV 仅首块用
  update(chunk: Uint8Array): Uint8Array;  // 内部缓存未对齐尾巴；滚动 IV 续链（padding:'none'）
  final(): Uint8Array;                     // 末块 PKCS#7（含整除时补整块——与 one-shot 一致）
}
export class Sm4CbcChunkedDecryptor { /* 对称：update 续链 / final 去填充并校验 */ }
```

- 内部逐块调 sm-crypto（CBC + `output:'array'`），Uint8Array ↔ number[] 转换只发生在块边界；chunk 默认 1-4MB（常量可调，基线以 2MB 实测）
- **解密方向数组直传**（§3.3 铁律：hex 往返吞吐腰斩）
- **byte-equality 由构造保证 + 测试锁定**：固定 key/IV 下随机多尺寸（**0（空文件）**/1/15/16/17/31/32/33/1000/4096/64KB+7/1MB/1MB+3 × 多切分）`chunked == sm4Encrypt one-shot` 逐字节比对；解密同理（含填充错误路径）。**开工 spike 已全过（48 组，含 0 外全部尺寸）**——此测试是把实证固化为回归闸（0 尺寸 spike 未跑、测试补齐）

**`sha256-increment.ts`**：增量 SHA-256（`update(Uint8Array)` / `finalHex()`），与 `crypto.subtle.digest` 随机尺寸交叉验证。

### 4.2 supplier-portal crypto worker（本门户自包含，不进共享包）

`apps/supplier-portal-next/src/workers/crypto-worker.ts`，消息协议（id 关联、transferable 回传）：

```
主 → worker  { id, cmd:'encrypt', file: File, dekS, dekA }
worker → 主  { id, type:'progress', doneBytes, totalBytes }        // 节流 ~250ms / 2MB
           { id, type:'done', outerBlob: Blob, plainSha256, innerSha256, outerSha256,
             plainBytes, innerBytes, outerBytes }                  // Blob 在 worker 内组装——postMessage(blob) 传句柄，大数据可盘背书
           { id, type:'error', message }
主 → worker  { id, cmd:'decrypt', url: string, dek }               // worker 内 fetch 流式下载 C_inner
worker → 主  { id, type:'done', plainBlob: Blob, plainSha256, plainBytes }
```

- **加密流水线**（单遍流式、C_inner 不落全量）：`file.stream()` → 增量 plainSha256 → Sm4CbcChunkedEncryptor(DEK_S) 逐块 → 增量 innerSha256 → 直接喂 Sm4CbcChunkedEncryptor(DEK_A) → 增量 outerSha256 → outer 块累积。内存峰值目标 ≈ 流缓冲 + C_outer 累积 ≈ 1.1-1.3×S
- **解密流水线**：worker `fetch`（同源带 cookie + `X-Portal: supplier`）→ `response.body` 流读 → 逐块解密 → 增量 plainSha256 → plain 块累积
- 取消 = `worker.terminate()`（页面卸载/用户取消）；主线程收尾（上传中不可取消，走既有上传进度）

### 4.3 主线程接线（三收口点）

1. **`dual-v3-client.encryptAndUploadV3` 重构**：逐角色文件改走 worker（DEK 仍主线程 `randomHex` 生成——kself/kadmin 封装需要）；返回后主线程拿 outerBlob → 既有 `uploadOuter`（含服务端哈希交叉核对，保留）→ P7/SM2 封装 → 信封组装。**统一走 worker**（不保留同步双轨——单一数据路径，一致性由 ukey 测试锁定）；sealedFields 小数据仍走一次性 `sm4Encrypt` hex。**cryptoEngine 依赖注入**：worker 经 `deps.cryptoEngine`（默认浏览器实现）注入——现有 `dual-v3-client.test.ts` 是 `node:test` 直跑真 `File` + fake adapter/upload 的注入式单测，注入 Node 直跑引擎（分块类本身）后测试链路保持全绿、不依赖浏览器
2. **`CaOpeningDecryptCard`**：盾解封 DEK_S/DEK_F（主线程）→ 各角色 worker 解密 → 明文 Blob 组装 → 既有 FormData/证明链不变（`plainSha256ByRole` 改用 worker 回传值）
3. **`ca-bid-reupload-card`**：经 `encryptAndUploadV3` 自动受益
4. **`crypto-overlay.ts` 翻新**：`withCryptoOverlay(task, { progress })` 全屏遮罩（cgzxui 视觉）+ 进度百分比 + 防误关；接到投递/解密/补传三处；submit 页内联 note/progress 保留为遮罩内文案来源

### 4.4 Worker 打包 spike（开工第一步）——已定案（2026-11-05，Task 3）

**结论：`new Worker(new URL('../workers/crypto-worker.ts', import.meta.url), { type: 'module' })` 双模式可用，定为唯一实例化模式**（骨架 `src/utils/crypto-engine.ts` `createWorkerCryptoEngine()`，Task 5 在其上建消息协议）。实测记录：

- **dev（真实门户实测）**：运行中 :3004（Turbopack watch）热接新文件，登录页探针 `useEffect` 挂引擎 → console `[worker-spike] engine: Worker created ok`、`onmessage: {"id":1,"type":"pong"}`、无错误；Turbopack 即时编译独立 worker 入口（网络面板 `/_next/static/chunks/apps_supplier-portal-next_src_workers_crypto-worker_ts_*.js` 三块均 200，经 `turbopack-worker-*#params=` 引导）。
- **build（同版本合成应用实测）**：不动真树 .next，/tmp 一次性 next@16.2.3 + react@19.2.4 应用（与门户同版本）复刻同构 workers/+utils/ 骨架，`next build`（Turbopack）通过：TS worker 源被编译为 chunk（ping/pong 处理器逐字节在 `.next/static/chunks/17tdwi6~3n3hs.js`），运行时 Turbopack 把 Worker 构造改写为自家引导入口 `turbopack-worker-*.js#params=[chunkurls]`（**实际按经典 worker + importScripts 装载**，`{type:'module'}` 被接管——模块形态由引导层保证，业务代码无感知）；`next start` + 真浏览器加载 `/spike` 页实测 pong、零 console 错误。另产出辅助媒体件 `/_next/static/media/crypto-worker.*.ts`（源码原样 asset，非运行路径，勿据其误判"未编译"）。
- **注意**：URL 必须是静态字面量（Turbopack 编译期识别该语法模式），勿改成运行时拼接。
- **残留兜底**：若未来生产构建（Next/Turbopack 升级或 webpack 回退）不再识别该模式（症状=worker 请求 404/语法错误），按原兜底链改造：②构建期把 worker 预编译为静态资源（`tsc` 独立产物进 public/）+ 显式 URL/Blob URL → ③主线程分块 + 每块 yield（功能等价降级）。①语法变体已无必要（原语法即过）。`createWorkerCryptoEngine` 构造失败返回 null 的降级语义保留，调用方按③兜底。

### 4.5 服务端外层解密分块化（D3，apps/api）

改造 `decryptOuterOneV3` 逐角色链路（fencing/CAS/短事务/监督日志/审计逻辑**不动**）：

- **流式解密**：MinIO `getObject` 流 → ukey `Sm4CbcChunkedDecryptor`（Node 同源，§3.3 数组直传铁律同适用）→ 流写回 MinIO（分块 put/分段上传）；`decryptOuterFileV3` 增流式变体（SM2 解 kadmin 得 DEK_A 不变，仅 SM4 段改分块）
- **C_inner 尺寸可预知**：CBC+PKCS#7 下 `innerBytes = outerBytes − 16`（信封 `entry.outerBytes` 已知）——MinIO 流式 `putObject(stream, size)` 有确定 size，两遍流方案成立性无悬念
- **outerSha256 闸门保持语义**（`OUTER_HASH_MISMATCH` 防调包）：改增量哈希——两遍流（先哈希闸后解密，MinIO LAN 双读可接受）或单遍分段累积+失配中断清理（plan 定）
- **`written[]` 驻留取消**：FileAsset 元数据（size/sha256）改边解边算（增量 innerSha256 + 字节计数），Buffer 不驻留
- 内存峰值从 ~7×S 降到 chunk 级（几 MB）；PKCS#7 损坏检测语义不变（final() 校验 → `OUTER_FAILED`）
- **长任务注记（500MB 墙钟 ~1-2min，两遍读+解密）**：①浏览器端无虞——`@water-erp/client` fetch 不带 signal 无默认超时；**部署层 nginx `proxy_read_timeout` 须 ≥3min**（挂审计缺口 ④ 一并处理）②`DecryptExecution` 60s 接管窗口 vs 长任务：双击重试会重复夺槽做无用功（fence CAS 保正确性、只是浪费）——大文件建议放宽接管窗口或 :3007 按钮防双击（plan 定）
- dual-v2 存量路径（`decryptOuterFile`）本期**不动**（存量信封可继续整解；如需同改后续跟进——记录在案）

### 4.6 上传链路修复（D5，supplier-portal）

- **两处 XHR 硬超时**（`caUploadEncryptedOuter` / `caDecryptUpload`，均 `timeout = 180000`）按体积缩放：大文件（如 >50MB）取消硬超时、改进度停滞判活（如 60s 无 onprogress 即中止），小文件维持现状；超时/中止给中文明确文案与重试入口
- **`caDecryptUpload` 补上传进度**（现状无 onProgress——500MB 明文回传期间弹窗只有静态文案「正在上传明文与证明…」）：补 `xhr.upload.onprogress` 并接入解密卡弹窗进度行，与解密进度首尾衔接（下载解密 % → 上传 %）
- 单请求上传形态不变（nginx/代理层上限为审计缺口 ④，另行处理——本项只修前端）

## 5. 验收标准

1. ≤100MB：加密/解密全程主线程无冻结帧，遮罩进度平滑推进
2. 500MB：完成加密/解密，浏览器标签内存峰值 ≤1GB（DevTools heap 实测，**单件大文件口径**——多角色总量线性叠加，文档记录不设闸）；进度可见，无崩溃；**可取消**（terminate 后无残留状态、可重新发起）
3. 信封字节级兼容：固定 key/IV 下，改造前后同一输入产出完全相同的密文三哈希与 envelope（ukey 一致性测试锁定）
4. `packages/ukey` 单测：分块 == one-shot（加密/解密 × 多尺寸 × 随机 key/IV）；增量 SHA-256 == `crypto.subtle`
5. e2e：供应商投递 → **服务端剥外层** → 开标解密全链（现有 dual e2e 基础上补 100MB 级用例；500MB 用脚本级验证 + 手动浏览器实测一次）；服务端解密内存峰值实测（500MB 输入下 API 进程稳定）
6. 基准数据入档：改造前后 50/100/500MB 加解密耗时与内存实测表（浏览器端 + 服务端，写入本 spec「实现纪要」）
7. 三收口点（投递/解密/补传）全部接线翻新后的进度遮罩；Mock 盾路径（无盾环境 e2e）与 SCCA 真盾路径行为一致（bulk SM4 与盾无关，盾交互未挪动）
8. 上传超时：>50MB 上传无硬超时（进度停滞判活），中断文案+可重试；≤50MB 行为不变

## 6. 交付面

- `packages/ukey`：`sm4-cbc-chunked.ts` + `sha256-increment.ts` + 一致性测试（build 后门户方可消费）
- `apps/supplier-portal-next`：crypto worker + `encryptAndUploadV3` 流式重构 + 解密卡流式化 + overlay 翻新 + 上传超时修复
- `apps/api`：外层解密分块化（`bid-decrypt.service.ts` + `dual-envelope.service.ts` 流式变体 + 单测）
- `apps/bid-portal`：**无交付**（§2 修正）
- 文档：本 spec 补「实现纪要」（含基准表、spike 结论）+ CLAUDE.md 双信封节一句话更新 + `crypto-overlay.ts` 头注释 ≤50MB 自述修正

## 7. 风险与坑（开工必读）

- **CBC 链式**：分块必须按 16B 密码学块边界串行推进，禁止并行分块（并行需 GCM/CTR，合规另议，默认不做）
- **sm-crypto `padding:'none'` 静默丢尾**（builder check 实证）：非 16B 对齐输入不报错、**尾字节静默丢弃**——分块类必须缓冲未对齐尾巴、只在块边界调用，一致性测试覆盖跨块非对齐尺寸
- **末块整除补整块**：PKCS#7 在输入恰为 16 整除时补**整块** 16 字节——一致性测试必须覆盖整除尺寸
- **Turbopack worker 打包**：全库首例——§4.4 spike 已双模式定案（dev 实测 + 同版本合成 build 实测），兜底②③仅在构建形态未来分叉时启用
- **服务端 MinIO 流式写**：minio-js `putObject` 流式需 size 或走分段上传——plan 期定两遍流 vs 单遍分段；dual-v2 存量整解路径保留不动
- **worker 内存**：outer/plain 块累积在 worker 堆（~500MB 量级 OK）；块用 transferable 回传避免拷贝翻倍
- **进度节流**：postMessage 每 2MB/250ms 一次，防消息风暴
- **非安全上下文**：`assertSecureContext` 守卫保留（增量 SHA-256 不依赖 WebCrypto，但盾哈希/其他原语仍依赖；LAN http 环境指引文案不变）
- **并行会话**：多会话共用 main，遵守 CLAUDE.md 并行会话协作约定（只 add 明确路径、commit 前查 status、共享高危文件避让）
- **测试盾**：SCCA 01/02 盾绑定关系见 memory（`scca-test-shield-allocation`）；bulk SM4 与盾无关，真盾联调只验收三收口点接线
- **ukey dist 消费**：改 src 后必须 `--filter @water-erp/ukey build`（与 @water-erp/client 同律）

## 8. 关联阅读

- `docs/superpowers/specs/2026-11-04-ocr-service-takeover-config-design.md`（500MB 全链审计原始记录）
- CLAUDE.md：「双信封新轨·生产启用前清单」「供应商门户」「开评标管理端」节
- memory：`scca-test-shield-allocation`、`supplier-dualv2-frontend-removed`、`client-package-needs-build`

## 9. 实现纪要（2026-11-05 全 12 任务交付后补记）

### 9.1 交付事实（commit 映射）

| 任务 | 交付 | commits |
|---|---|---|
| T1 增量 SHA-256 | `ukey/sha256-increment.ts`（与 crypto.subtle 交叉验证） | 0b713b6..52cc34d |
| T2 分块 SM4-CBC | `ukey/sm4-cbc-chunked.ts`（滚动 IV 续链，13 尺寸×随机切分一致性闸） | 52cc34d..3c3580c |
| T3 Worker 打包 spike | `new Worker(new URL(...), {type:'module'})` 双模式定案（§4.4 已回写） | 3c3580c..85413a3 |
| T4 流式管线 | `supplier-portal-next/src/utils/crypto-pipeline.ts`（单遍双层加密/下载解密管线） | 85413a3..c469bbb |
| T5 crypto-engine | `utils/crypto-engine.ts`（worker facade + local 降级引擎，promise map/错误传播/terminate 重建） | c469bbb..06da494 |
| T6 encryptAndUploadV3 重构 | 注入式引擎化，整读路径删净（dev 树真编译信号过） | 06da494..c93c177 |
| T7 overlay 翻新 | `crypto-overlay.ts` 全屏进度+防误关+可取消（头注释已更新） | c93c177..53bf595 |
| T8 上传链路修复 | 两 XHR 超时按体积缩放 + 60s 停滞判活（addEventListener 化看门狗） | 53bf595..99e9034/ea89a36 |
| T9 投递页/补传卡接线 | 遮罩进度相位 + 取消（worker/本地/上传尾三相位 settle） | ea89a36..ad7aa00 |
| T10 解密卡接线 | 流式下载解密 + 回传进度 + 取消 | ad7aa00..797db10 |
| T11 服务端两遍流式 | `bid-decrypt.service.ts` decryptOuterOneV3 + `dual-envelope.service.decryptOuterStreamV3/unwrapOuterDekV3`（哈希闸语义不变、C_inner 零驻留） | 797db10..dcbb87e |
| T12 e2e+基准+文档 | `apps/api/test/bid-v3.e2e-spec.ts` ⑪ 100MB 用例 + `packages/ukey/scripts/sm4-chunked-bench.js` + 本纪要 | （本次提交） |

### 9.2 基准实测（2026-11-05，Node 24.16.0 本机，`sm4-chunked-bench.js`）

| 尺寸 | 轨道 | 加密 | 解密 | 备注 |
|---|---|---|---|---|
| 25MB | one-shot（现状遗留） | 5.9 MB/s | 5.6 MB/s | |
| 25MB | chunked 2MB | **15.4 MB/s** | **15.2 MB/s** | 2.6×/2.7× |
| 100MB | one-shot | 4.0 MB/s | 4.6 MB/s | GC 压力下进一步劣化；单进程跑 25→100 档需 >4GB 提交堆（默认堆 OOM，跑法见脚本头注 `--max-old-space-size=6144`） |
| 100MB | chunked 2MB | **15.8 MB/s** | **15.6 MB/s** | 4.0×/3.4× |
| 500MB | chunked 2MB | **15.5 MB/s**（32.2s） | **15.3 MB/s**（32.6s） | one-shot 档跳过（~10×S 堆必 OOM——本身即旧路径不可用的实证）；进程 RSS 峰 ~2.4GB（基准自持 源+密文+回读 三份，生产单遍管线更省） |

- 两档（25/100MB）运行时自检：chunked 密文与 one-shot 密文 sha256 相等、回读 sha256==源——逐字节等价的运行时佐证（正式回归闸在 `sm4-cbc-chunked.spec.ts`）。
- 与 §3 定案基线吻合（当时 chunked 加密 15-16.5 / 解密 9.3-9.7 MB/s；本次解密 15+ MB/s 系当次机器负载更好）；500MB 双层加密推演 2×~33s ≈ 64s，与 §3 推演（~61s）一致。浏览器 worker 内为同源 JS 内核（sm-crypto），量级同阶（主线程零冻结由 worker 化保证，速度不由门户承担）。

### 9.3 e2e 100MB 全链用例（`bid-v3.e2e-spec.ts` ⑪）

- 链路：测试进程 ukey 分块双层加密（与浏览器 worker 同一密码学内核，明文逐块现生成不整驻）→ C_outer 暂存 → prepare/signing-payload/submit v3（I6 归属闸+T4 备份固化真实执行）→ 签到 quorum+OPENING+会话+指派主持人 → **真实 HTTP 端点 `POST /bid/projects/:id/opening/decrypt-outer`**（bid_host 登录 token_bid，AssignedHostGuard 按指派放行）。
- 断言：SUCCESS / roles=[technical] / C_inner FileAsset.sha256 == 加密侧增量自算 innerSha256（字节级一致性的端到端证明） / size==innerBytes==outerBytes−16 / DecryptExecution SUCCESS / MinIO 对象在位；耗时 console.log 输出。
- 两连跑实测（隔离库 water_erp_e2e + Redis 6390，2026-11-05）：plain=104857607B（100MB+7 非对齐）outer=104857632B inner=104857616B；**加密 28.5s/27.7s，submit 0.56s/0.62s（含 MinIO 100MB 备份读回写回），decrypt-outer 14.6s/14.4s（两遍流：哈希闸+解密写回），用例全程 ~44s**；套件 10/10 绿（~48s）。
- **用例头注的口径偏差**：C_outer 暂存不走 `encrypted-assets` 端点而按端点同构直写 MinIO+FileAsset——因该端点 multer 闸 `MAX_OUTER_BYTES = 50MiB+32B` **未随「全库统一 500MB」（2026-11-05）上调**（见 §9.5 待修项①）；小件真实端点路径由用例①覆盖。

### 9.4 部署注记

- **nginx `proxy_read_timeout` ≥3min**：500MB decrypt-outer 两遍流墙钟 1-2min（本次 100MB 实测 14.5s 线性外推），浏览器侧 `@water-erp/client` fetch 无默认超时，卡点在反代层。
- **DecryptExecution 60s 接管窗口 vs 长任务墙钟**：大件解外层期间双击重试会重复夺槽做无用功（fence CAS 保证正确性，只是浪费；陈旧楔接管判定 60s < 500MB 墙钟——中途崩溃的恢复要等 updatedAt 停摆 60s 后的下一笔触发）。建议放宽接管窗口或 :3007 按钮防双击（未实施，留运维裁定）。
- **上传 XHR 停滞判活 60s**（T8）：>50MB 上传无硬超时，60s 无 onprogress 中止并给中文文案+重试；广域网慢链路健康上传不被误杀（停滞≠慢）。
- **取消语义**：多文件投递中取消——terminate 后当前文件立即停，下一文件会在自建 worker 上完整加密、停止点是其上传边界（结构性行为，非 bug，QA 勿误读）；解密卡非解密相位（unwrap/P7/上传）取消不生效，上传成功照常 toast+关闭（T8 abort 缺口下游，体验项）。

### 9.5 已知待修项（实现后发现）

1. **`encrypted-assets` 端点 50MiB 闸未上调（P0，500MB 链路唯一断点）**：`apps/api/src/ca/encrypted-asset.controller.ts` `MAX_OUTER_BYTES = 50*1024*1024+32`——2026-11-05「单文件统一 500MB」只覆盖了通用 `/api/upload`（attachment-rules.ts），本端点自带 multer 闸漏改。>50MiB 的真实投递在暂存即 413，浏览器 500MB 全链（验收 #2）当前不可达。修法=常量改 `500*1024*1024+32`（两层 CBC padding 上限）+ `encrypted-asset.controller.spec.ts` 对齐 + 顺带核对 `supplier-portal.controller.ts` :548/:612 两处 50MB multer 闸是否同口径（补传/解密回传文件）。本纪要成文时未改（Task 12 文件面约束），**500MB 上线前必修**。
2. dual-v2 存量整解路径（decryptOuterFile/decryptOuterOne v2 分支）未分块化（spec §4.5 既定不动；存量 v2 信封 ≤50MB，整解可承受）。

### 9.6 验收对照与偏差记录

- 验收 #7（三收口点接线遮罩）：**P-3 裁定**——解密卡用 SpDialog 模态 busy 弹窗（本身模态+busy 锁关）等价实现「防误关+进度」两要素，投递/补传两处接全屏遮罩；不叠加重复 UI。
- 验收 #5 服务端内存：「API 进程稳定」以 100MB e2e 真实执行佐证（流式改造后 C_inner 零驻留，500MB 推演 chunk 级）；500MB 级进程观测归入 §9.7 手测清单。
- Task 11 尺寸恒等式不变量：C_inner 本身是 SM4-CBC 密文恒 16 字节对齐 → 外层 PKCS#7 填充恒一整块 → `innerBytes = outerBytes − 16` 对一切良构信封恒成立（与明文是否对齐无关；已在 `bid-decrypt.service.ts` putObject 处补注释、e2e ⑪ 以 100MB+7 非对齐明文实证）。

### 9.7 PENDING：500MB 浏览器手动实测（验收 #2/#7 真盾路径——SCCA helper wss://localhost:36171 于 T9/T10/T12 三次核查均未监听，无法代跑，待用户插盾执行）

前置：先修 §9.5①（否则暂存端点 413 断链）。清单：

- [ ] **投递 500MB 全链**（供应商门户投递页，真盾）：进度遮罩平滑推进（加密→上传相位衔接）、中途取消可重发、无残留状态；
- [ ] **DevTools 内存观测**：标签页+worker 合计堆峰 ≤1GB（单件口径；注意 Blob 构造瞬间瞬态 2× 峰属预期——目的地是盘非 JS 堆）；
- [ ] **开标解密卡真盾流式**：:3004 解密卡下载→解密→回传进度三相位、非解密相位取消体验确认（或裁定上传相位禁用取消钮）；
- [ ] **服务端 :3007 解外层**：500MB decrypt-outer API 进程稳定（内存不随文件线性涨）、WS 广播正常、nginx `proxy_read_timeout` 配置生效；
- [ ] **多文件取消**（T9 结构性行为复核）：多角色投递中途取消，下一文件边界停止语义符合 §9.4 预期管理；
- [ ] **>50MB 上传停滞判活**：拔线/断网 60s 中止+文案+重试入口（≤50MB 行为不变抽查）。
