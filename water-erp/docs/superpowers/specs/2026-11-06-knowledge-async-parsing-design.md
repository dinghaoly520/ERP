# 知识库文件解析异步化 立项书（500MB 链路补缺 ②）

> 日期：2026-11-06
> 来源：当日生产/本机双实录事故（见下）——`2026-11-04-ocr-service-takeover-config-design.md` 500MB 审计线的结构性病根
> 性质：单独立项——本文件自包含，新会话零上下文可开工
> 关联已修项：同日已修 ①web 代理超时误分类（proxy.ts，超时不再整包重放）与 ③OCR 批次级缓存+并发合并（ocr.service.ts `ocrOnce`）——两者止血但**不治病根**：同步 20 分钟的 HTTP 请求在任何网关（15s/120s/nginx 超时）下都活不了。

## 1. 事故实录（为什么立项）

本机上传 118MB/478 页扫描件到审查知识库（`POST /api/knowledge/:id/files`）：

1. 端点**同步**解析：收件 → pdf-parse → 判扫描件 → OCR 12 批 × ~60s ≈ **12 分钟后才响应**
2. :3005 web 代理 15s 硬超时击穿 →（①修复前）误判「不可达」→ **118MB POST 整包重放 4 次**
3. 后端 5 个 handler 无视连接断开各自跑完：**5×478=2390 页重复 OCR**，串行锁占用约 1 小时
4. 用户端最终只见 504；文件状态停留在中间态

生产同病异象：批次级 5 分钟超时（8 核旧镜像吞吐不足，见 OCR 部署线）。

## 2. 现状地图

| 文件 | 现状 |
|---|---|
| `apps/api/src/knowledge/knowledge.controller.ts:86` | `@Post(':id/files')` 同步等解析完才返回 |
| `apps/api/src/knowledge/knowledge.service.ts:101` | `uploadFile()`：存储+解析+入库一条龙 |
| `apps/api/src/knowledge/services/document-parser.service.ts` | pdf-parse 判文字层 → 稀疏则 `ocrPdf` 全量 |
| `prisma/schema.prisma:3281` `KnowledgeFile` | 需查/加 `status` 字段（PARSING/READY/FAILED + 进度） |
| 前端 `apps/web` 知识库页 | 需改：上传即返回 + 轮询/刷新状态展示 |

现成基建：BullMQ（`ai-bid-analysis` 已有 worker 模式先例）、Redis、站内通知（NotificationGateway WS 推送）。

## 3. 设计方向（2026-11-06 brainstorming 已定案）

**收件即返回 + 后台解析 + 状态可见**：

1. `POST /files` 收件落 MinIO + 建 `KnowledgeFile(status=PARSING)` → **立即 202**（文件 id 返回）
2. BullMQ 队列 `knowledge-parse`：消费 → DocumentParser 解析 → 分块进度回写（`processedPages/totalPages`，OCR 批次粒度天然可报）→ 成功置 READY / 失败置 FAILED(原因)
3. 前端：上传列表即时出现「解析中」态 + 轮询刷新；FAILED 可重试（重试吃 ③ 的批次缓存，秒级）
4. 知识检索侧：PARSING 文件不可检索

### 定案记录（2026-11-06 与用户 brainstorming 四点裁定）

| 决策点 | 裁定 | 落地要点 |
|---|---|---|
| PARSING 检索口径 | **不可检索**（READY 才可检索） | 分块/嵌入本就在全文解析完成后一次性进行，PARSING 期无向量数据天然搜不到；规则提取 `rule-extractor` 显式加 `status:'READY'` 过滤 |
| worker 归属 | **并入 ai-bid worker 进程**（不另起进程） | `AiBidAnalysisWorkerModule` 增引 KnowledgeModule + 队列注册 + KnowledgeParseProcessor；dev 链/生产部署零新增进程。代价已知情：改解析源码须杀 worker 重启，会连带中断进行中的 AI 分析任务（memory `ai-bid-worker-independent-process` 既有坑，非新增） |
| 前端刷新 | **轮询** | 页面存在 PARSING 文件时 ~5s 轮询知识库详情、无则停轮；断网关重进页面即见状态（验收 #3 天然满足） |
| sha256 去重 | **同库内去重** | 同库同 sha256 且 PARSING/READY → 直接返回既有行（响应标 `deduplicated:true`）；FAILED → 对该行重入队。跨库重复靠 ③ OCR 内容哈希缓存兜底（第二库秒级），不做跨库共享 content |

### 实现层裁定（builder 自定，非用户决策）

- **schema 字段**：`KnowledgeFile` 增 `status`(默认 PARSING) / `totalPages Int?` / `processedPages Int @default(0)` / `error String?` / `indexed Boolean @default(true)`（嵌入降级标志持久化，替代原响应瞬态）/ `sha256 String?`；存量行回填 READY
- **totalPages 时机**：worker 开始解析时写（OCR getPdfPageCount / pdf-parse numpages），不在 202 路径探测——收件路径零解析开销；前端在 totalPages 出现前显示不定态「解析中…」
- **队列作业**：jobId=fileId（BullMQ 天然防重复入队）、payload 仅 `{fileId}`（不传 buffer）、attempts=3+指数退避、removeOnComplete/removeOnFail=true——**死信可见性走 DB（status=FAILED+error），不依赖 BullMQ failed 集**；并发默认 1（`KNOWLEDGE_PARSE_CONCURRENCY` 可调）
- **OCR 进度回调**：`ocrPdf(buffer, maxPages, onProgress?)` 选参穿透到 `ocrPdfBatched` 每批回调；`DocumentParserService.parse` 同增选参
- **重试端点**：`POST /knowledge/:id/files/:fileId/retry`（FAILED→PARSING→重入队；吃 ③ 批次缓存）
- **删除 PARSING 文件**：允许；processor 执行时行已删则 no-op（MinIO 对象由删除端点清）
- **e2e**：现有测试无人直打上传端点（tender-review e2e 走 prisma 直建），无需迁移；上传降级单测 `knowledge-upload-degrade.spec.ts` 契约重写（uploadFile 不再内联解析）

**硬约束**：
- 上传响应时间与文件大小/页数/OCR 时长**完全解耦**（大件不应再有任何同步等待）
- 队列消费失败要有 BullMQ 重试 + 死信可见性（FAILED 态 + 原因落库）
- 并发重复上传同一文件：sha256 相同 → 复用既有解析任务（③ 的 in-flight/cache 思想上移一层）
- e2e：现有 knowledge 相关测试契约会变（上传即 202），同步迁移

## 4. 验收标准

1. 118MB/478 页扫描件上传 **<5s 返回 202**，页面出现「解析中（x/478 页）」
2. 解析完成后文件可检索；失败可见原因、可一键重试
3. 断网关页面不丢任务；重复上传同文件不产生重复解析
4. 代理层不再出现该端点的重放/超时日志
5. 单测：状态机流转（PARSING→READY/FAILED）+ 队列重试路径

## 5. 风险与坑

- **schema 变更**：KnowledgeFile 加 status 字段 → 迁移 + 存量行回填 READY（旧数据已解析）
- **双进程消费**：若并入 ai-bid worker，注意 `dev:worker` 重启链（memory: 改源后须杀 worker 重启）
- **大 buffer 过队列**：不要把 118MB buffer 塞 BullMQ payload——传引用（fileId/MinIO key），worker 自取
- **前端契约**：web 门户知识库页 + 可能的 supplier/expert 侧入口同步改
- **并行会话**：仓库多会话共用 main，遵守 CLAUDE.md 协作约定

## 6. 关联阅读

- `docs/superpowers/specs/2026-11-04-ocr-service-takeover-config-design.md`（500MB 全链审计）
- CLAUDE.md：Knowledge 模块节、AI Bid Analysis Worker 节（BullMQ 先例）
- memory：`ai-bid-worker-independent-process`（worker 运维坑）
