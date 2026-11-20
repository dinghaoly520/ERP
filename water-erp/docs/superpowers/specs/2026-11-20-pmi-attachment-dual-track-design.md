# PMI 附件双轨存储加固设计（本地主轨 + MinIO 副本）

**日期**：2026-11-20
**状态**：已实施（2026-11-20，9 任务落地；生产运维侧挂卷/回填见 docs/ops/pmi-attachment-volume-mount-runbook.md）
**事故触发**：2026-11-20 13:50 生产（10.60.14.14）PMI 附件 ENOENT——容器 recreate 抹掉可写层 `uploads/`，DB 行在、文件永久丢失；`getAttachmentFile` 裸吐 500 ×3，`analyzeProject` OCR 提取静默返回空串。

## 1. 意图（为什么）

PMI 阶段附件（含谈判采购文件 refFileKeys 主轨、非招标成交引用、AI 分析/归档导出源文件）目前**只写容器本地磁盘**，`Attachment.objectKey` 只是相对路径约定。容器重建 = 用户上传的采购文书不可逆丢失。本设计让每份附件在 MinIO 留一份副本，读端「本地优先 → MinIO 回退 → 明确 404」，让容器可随意重建、宿主盘单点故障不再等于数据灭失。

## 2. 目标 / 非目标 / 反目标

**目标**
1. `persistUploadedFile` 写入时同步在 MinIO 落副本；**副本失败不阻断本地主轨**（降级告警）。
2. 全部裸读本地盘的附件消费点获得 MinIO 回退；两轨皆失时返回带错误码的 404（下载类）或空文本+日志（分析类），不再 500。
3. 附件删除时 MinIO 副本 best-effort 双清。
4. 存量附件回填 MinIO（dry-run 默认 + `--execute`）；两边都无的行列「不可恢复清单」指导人工重传。
5. 生产挂卷 runbook（先救文件、后挂卷、再回填）。

**非目标**
- 不改 `Attachment` schema、不建 FileAsset 行（objectKey 直接作为 MinIO 对象键，零迁移）。
- 不动专家端谈判文件下载的 FileAsset 兜底轨、公告 bid-document 的 MinIO-first 轨（各自已有回退，自然受益于副本存在）。
- `uploads/archive/` 归档导出产物、docx/text 缓存等**派生工件**维持纯本地（可从 DB 重新生成）。
- dev 环境行为不变（MinIO 本就常在，双写天然生效）。

**反目标（就算技术上可行也不做）**
- ❌ 迁移到 FileAsset 单轨（推翻「主轨=本地盘」现行裁定，波及谈判 refFileKeys 语义）。
- ❌ 副本失败时让上传失败（副本是保险，不是闸门）。

## 3. 约束

- 「PMI 附件主轨=本地 uploads/ 磁盘」为现行架构裁定（CLAUDE.md 谈判采购文件读端口径），本设计只加副本轨道。
- `Attachment.objectKey` 混轨现状：PMI 上传件=`project-management/<stored>` 相对路径；非招标成交引用=FileAsset 的 MinIO key。「本地 miss → MinIO read」对两种轨**都恰好正确**（前者命中副本，后者命中本体）。**形态实查（2026-11-20 dev 金仓）**：78 行全为 `project-management/%`，零裸名 legacy 键、零混轨行——回填脚本无需分轨判定，行为自分类即可。
- MinIO 键空间无碰撞：PMI 前缀 `project-management/`，FileAsset/公告前缀 `uploads/<date>/`。
- 生产 compose 权威源在生产机（仓库版无 api 服务）——挂卷属生产机操作单，桌面拷贝同步。
- ai-bid worker 进程也要能读（plaintext-fetcher）——共享工具不得依赖 API 独有模块；`upload/minio.client.ts` 已是两进程共用底座。

## 4. 方案比选

| 方案 | 内容 | 结论 |
|------|------|------|
| **① 双轨制（选定）** | 本地主轨不变 + MinIO 副本（写双写/读回退/删双清/存量回填） | `readAttachmentText`（project-management.service.ts:7325）**已写好 MinIO 回退并注释「缺失时回退 MinIO」**——本方案是兑现半完成的设计约定，不是引入新架构 |
| ② 仅挂卷+读端加固 | 不双写 | 单盘单点仍在；本次已丢文件无从补救；公告引用采购文件轨继续断供。用户未选 |
| ③ 全迁 FileAsset 单轨 | Attachment 全走 MinIO | 波及谈判 refFileKeys/成交引用/专家兜底轨，大迁移，与现行裁定冲突。用户未选 |

**读端回退波及面（用户裁定）**：PMI 服务内全部裸读点 + supplier-portal:1944 + ai-bid-analysis/plaintext-fetcher:229（两处目前零兜底）；expert:1191 与 bid-document:132 已各有兜底轨，不动。

## 5. 详细设计

### 5.1 共享工具 `src/common/attachment-object-store.ts`（新文件）

纯函数模块（直接 import `minioClient`/`MINIO_BUCKET`，不依赖 DI——API 与 worker 进程通用）：

```ts
/** 本地优先读附件；两轨皆失返回 null（调用方决定 404 或降级空文本） */
export async function readAttachmentBuffer(objectKey: string): Promise<Buffer | null>
// resolve(process.cwd(), 'uploads', objectKey) stat+readFile → miss 则
// minioClient.getObject(MINIO_BUCKET, objectKey) 流式聚 Buffer → 再 miss 返 null

/** best-effort 写 MinIO 副本：失败 logger.warn 并返 false，绝不抛 */
export async function writeAttachmentCopy(objectKey: string, buffer: Buffer, mimeType: string): Promise<boolean>

/** best-effort 删 MinIO 副本（本地 unlink 仍由调用方既有逻辑负责） */
export async function removeAttachmentCopy(objectKey: string): Promise<void>
```

实现注意：MinIO 侧 miss 的判定用 try/catch（S3 NoSuchKey 错误码），非 S3 网络错误也按 miss 处理但打 warn（回退语义优先可用性）；本地路径拼接沿用各现状读点同款 `resolve(process.cwd(), 'uploads', objectKey)`。

### 5.2 写侧（单咽喉点）

`persistUploadedFile`（project-management.service.ts:7341）：本地 `writeFile` 成功后追加

```ts
const copied = await writeAttachmentCopy(attachment.objectKey, file.buffer, file.mimetype);
if (!copied) this.logger.warn(`[persistUploadedFile] MinIO 副本失败（不阻断）: ${attachment.objectKey}`);
```

覆盖 6 个调用点（阶段附件/替换重写/成交文书等）与 2 个直建点（:1977 与 :1558/:1585 createMany 引用的 objectKey 均源自既有 persistUploadedFile 产物，无需另挂）。非招标成交 non-tender-deal:77 的 objectKey 本就是 MinIO FileAsset key，天然无需副本。

### 5.3 读侧替换点

统一改走 `readAttachmentBuffer`：

| 位置 | 现状 | 改法 |
|------|------|------|
| `getAttachmentFile` :7845 | 裸 readFile → 500 | 回退后仍 null → `NotFoundException({ error: '附件文件缺失（本地与对象存储均未找到），请重新上传', code: 'ATTACHMENT_FILE_MISSING' })` |
| `getAttachmentTextContent` :7857 | 裸 readFile | null → 同款 404 |
| `analyzeProject` :5190 / :5714 | 裸路径传 `extractFileTextWithOcr` | 先 `readAttachmentBuffer` 取 buffer 再入 OCR；null → 空文本 + warn（维持静默降级语义但多一次 MinIO 机会） |
| `readAttachmentText` :7445 | 已有本地→MinIO 回退（全库唯一正确读点） | **保持原样**（严格审查裁定 2026-11-20：storage 为构造位置参数，删注入连锁 spec 工厂；重构仅省 6 行重复，风险≫收益） |
| :6530 / :6670 / :7437 / :7696 / :7959 等裸读点 | 各自 readFile | 逐一核上下文：Attachment objectKey 读点接 helper；缓存/派生路径（tender-text-cache、docx 工件）不动 |
| `supplier-portal.service.ts:1944` | 裸 readFile → 500 | 接 helper；attachment 行命中但 buffer null → 404 `ATTACHMENT_FILE_MISSING`（其后 FileAsset 轨按不同表 id 查不中该 fileId，直接 404 语义正确） |
| `plaintext-fetcher.service.ts:229` | 裸 readFile → 抛错 | 接 helper；buffer null → **不返回，落后续 FileAsset 兼容轨继续**（该函数本就有兼容轨，比空文本降级严格更好）；兼容轨也无 → 返 null 由调用方按「无采购文件」处理 |

### 5.4 删侧

附件 objectKey 的既有本地 unlink 点（:6497 批量、:7914 替换旧件等）旁追加 `removeAttachmentCopy(objectKey)` best-effort。缓存/工件 unlink 点不动。

### 5.5 存量回填脚本 `apps/api/scripts/backfill-attachment-minio.ts`

- 全表扫 `Attachment`（不区分轨别，行为自分类）：
  - 本地存在 & MinIO `statObject` miss → 待回填；
  - 本地存在 & MinIO 已有 → 跳过；
  - 本地 miss & MinIO 已有 → 健康（双写新件或 FileAsset 轨）；
  - 两边皆无 → **不可恢复清单**（预期含 `室内绿植服务谈判文件.pdf`），输出供人工找回重传。
- 默认 dry-run 打印统计与清单；`--execute` 才真传（仿 `fix-filename-mojibake.ts` 惯例）。
- 运行环境：dev 直跑；生产在容器内跑或宿主 `docker cp` 后跑（runbook 定）。

### 5.6 测试

- `attachment-object-store.spec.ts`：本地命中 / 本地 miss+MinIO 命中 / 双 miss 返 null / 写失败不抛。
- PMI service spec 增补：`getAttachmentFile` 双 miss → 404 带 `ATTACHMENT_FILE_MISSING`；`persistUploadedFile` 副本失败不阻断（mock writeAttachmentCopy 返 false）。
- 既有 `project-management`、`supplier-portal`、`plaintext-fetcher` 相关 spec 保持绿。

### 5.7 生产运维 runbook（放实施计划，要点）

1. **顺序铁律：先救文件、后重建**——若现存容器还有 `uploads/`，`docker cp` 导出宿主暂存；
2. 生产 compose（权威源在生产机）api 服务加 bind mount（宿主目录 ↔ `/app/apps/api/uploads`）后 `up -d` 重建；
3. 回填脚本 dry-run → `--execute`；
4. 不可恢复清单交用户找回原始文件走 UI 重传；
5. 验证：`docker inspect` Mounts、下载既有附件 200、重建一次再下载仍 200（副本轨生效证明）；
6. 桌面 compose 拷贝同步。

## 6. 遗留与开放点

- 大附件（数百 MB）双写的上传时延：PMI 附件为 multer 内存态 buffer，putObject 一次网络拷贝，接受；若日后出现超大件再议异步副本。
- `uploads/archive` 派生产物的持久化：非目标，若归档导出重算成本高可另案。
- dev 无需任何操作（`pnpm dev` 起 MinIO 即双写生效）。
