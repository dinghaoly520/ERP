# Procurement AI-Bid-Analysis → ERP Expert 辅助评标 移植方案 (v4.1·本机实证版)

> 将 `/home/asus/桌面/procurement` 的 `ai-bid-analysis` 模块移植到 `/home/asus/桌面/ERP` 的专家端辅助评标。
>
> - **v3** 基于对两个项目的彻底代码审查（procurement 全模块 + ERP expert/ai/bid/announcement/supplier-portal），修正了 v2 的致命错误。所有字段类型、解密机制、环境依赖均以实际代码为准。
> - **v4** 基于 2026-06-24 本机实证（procurement 与 ERP **同机**；GPU = RTX 5090D；逐条复核 v3 的 22 条事实声明），修正 v3 的 OCR 第十/十四章失实、15.1 过滤条件偏差，并补充保证金（bond）交叉处理。**v4 是当前实施依据；v3 的 OCR 第十章/第十四章已废止。**
> - **v4.1** 修正 v4 的 4 处移植陷阱（实证 `bid.service.ts:668-694` 真实解密逻辑 + `llm.service.ts:37` 硬编码 + `startEvaluation` 无 AI hook）：见「零、丙」。**v4.1 是当前实施依据。**

---

## 零、甲、v3 → v4 关键修正（本机实证，必读）

| # | v3 错误 / 遗漏 | v4 修正 | 实证依据 |
|---|---------------|--------|---------|
| 1 | 第十四章："必须完整移植 opendataloader + hybrid + GPU + v5 模型，不精简" | procurement 与 ERP **同机**，OCR 服务已在 `:8100` 实跑；ERP 直接复用，**不部署 Python 服务** | `curl :8100/health` → `{"engine":"rapid","hybrid":false,"workers":0}`；`~/.rapidocr/models/v5/` 不存在 |
| 2 | 第十四章声称 procurement "已验证"配置是 opendataloader | 本机实际跑**精简 rapid 模式**（`.env` 仅 `OCR_ENGINE=rapid`+`OCR_MAX_SIDE=3000`），v3 的 14.1 论证是理论推演 | `procurement/services/ocr/.env` |
| 3 | 15.1 过滤条件 `confirmStatus !== 'EXCEPTION'` | 实际代码 **`confirmStatus === 'CONFIRMED'`**（正向匹配）；照搬 v3 会让 PENDING 供应商混入 AI 分析 | `bid.service.ts:925` |
| 4 | 全文未覆盖 `bidBondAssetId`（保证金凭证） | `feat/bid-opening-bond-quality` 分支已给 `SupplierBidSubmission` 加保证金凭证字段；v4 新增 **15.12** 厘清与 AI 分析的边界 | `schema.prisma` `SupplierBidSubmission.bidBondAssetId` |
| 5 | GPU 兼容性未知 | 本机 RTX 5090D（Blackwell, compute_cap 12.0），`onnxruntime-gpu 1.23.2` 已支持，procurement 实跑验证 | `nvidia-smi` + `pip show onnxruntime-gpu` |
| 6 | 工期 15-18 天 | OCR 部署归零（同机复用），**砍至 13-16 天** | 上 |

> **核查结论**：v3 的 22 条事实声明逐条比对，21 条属实，仅 15.1 一处精度偏差；但 OCR 第十/十四章的**配置描述**与 procurement 本机实况不符（over-engineering），v4 整体废止并替换为同机复用方案。

---

## 零、丙、v4 → v4.1 关键修正（实证解密逻辑，必读）

| # | v4 缺陷 | v4.1 修正 | 实证依据 |
|---|--------|----------|---------|
| 1 | 5.2 `fetchBidderPlaintext` 写 `if(!sealedKey) throw`，与种子 sealedKey=null 冲突，对所有投标文件抛「缺少文件」 | sealedKey **可空**——对齐 `bid.service.ts:678` 真实 `if(ref.sealedKey){解密}`：为空则明文直读，仅做完整性校验（15.2 同步修正） | bid.service.ts:668-694；种子 `technicalSealedKey` 12/12=null 却解出 SUCCESS |
| 2 | 15.11 清单「三份文件能解密（sealedKey+unwrapKey+verifyIntegrity）」对当前种子是假命题 | 订正：种子走明文直读路径；真加密流需另生成带 sealedKey 的种子（非首期阻塞） | SupplierBidSubmission.json |
| 3 | 8.1/10.1 把 LlmService 当「改 env 即可」 | `llm.service.ts:37` **硬编码** `'deepseek-v4-pro'` 不读 env；构造函数 `@Inject(forwardRef(()=>VllmMonitorService))` 强依赖 vLLM 监控，ERP 无 vLLM 基建 → DI 启动即崩。必须抽 DeepSeek-only 精简版 | llm.service.ts:27,37 |
| 4 | Phase 4.3「startEvaluation 触发 AI」暗示扩展现有 hook | 现状 `startEvaluation`(bid.service.ts:530-584) 体内**无任何 AI/queue 调用**——是**新增**逻辑而非扩展；三重门控已就位 | bid.service.ts:530-584 |

> **核查结论**：v4 的 OCR 同机复用、15.1 过滤、15.12 保证金均经 v4.1 复核**确认无误**；v4.1 仅修补 4 处移植陷阱（均围绕「照搬 procurement 代码」的隐含假设）。H1 的种子 sealedKey 争议已由实证平息：真实解密逻辑本就兼容明文直读，**无需重生成种子即可跑通首期 E2E**。

---

## 零、乙、v2 → v3 关键修正（历史·保留）

| # | v2 错误 | v3 修正 | 依据 |
|---|--------|--------|------|
| 1 | `BidOpeningRecord.amount/period` 当数值用 | **String 类型，必须归一化** | schema.prisma:162-163 |
| 2 | `AiConcordanceResult` 双重 unique | **仅 `@@unique([taskId, supplierId])`** | Prisma 规范 |
| 3 | "ERP 无 per-item，需从固定 breakdown 改造" | **ERP `scoreSuggestion` 已是 per-item**（按 BidScoreItem），核心是换数据源（规则→LLM+OCR），不是改结构 | ai.service.ts:212-261 |
| 4 | 招标/投标文件直接 `unwrapKey` | **必须走 `isWrappedKey` 双格式判断**（legacy 原始 hex vs wrapped base64） | bid-document.service.ts:259-263 |
| 5 | "DeepSeek 需新增配置" | **已配置**（`.env` 有 KEY/MODEL）；但 procurement 硬编码 `deepseek-v4-pro`，ERP `.env` 是 `flash` | llm.service.ts:37 |
| 6 | "BullMQ 直接复用" | **ERP 未安装**，需 `pnpm add @nestjs/bullmq bullmq` + 新建 worker 进程 | package.json 无依赖 |
| 7 | "OCR 直接复用" | **ERP 完全没有**，需独立部署 Python 服务（docker-compose 加 service） | 全 src 无 OCR |
| 8 | 漏 `KMS_SECRET` | **`.env` 未配置**，但 `wrapKey/unwrapKey` 强制要求，必须添加 | .env 缺失 |
| 9 | 孤儿恢复"复用 procurement" | procurement **有** `recoverOrphanedTasks`（在 `src/ai-bid-analysis-worker.ts`，不在子目录） | worker.ts:43-102 |
| 10 | 投标文件"单数" | **三份**：technical/business/coverLetter，各自 `*AssetId` + `*SealedKey` | schema.prisma:653-663 |
| 11 | "RESPONSIVE 维度 procurement 完全没有" | procurement `TechnicalScore.starredResponse` 已覆盖★号响应性 | types/index.ts:92-95 |
| 12 | `SupplierQualification` 有 level 字段 | **只有 type/name/validFrom/validTo**，等级要从 name 解析 | schema.prisma:438-454 |
| 13 | 触发时机"decrypt-all 或 startEvaluation 并列" | **解密只能在 OPENING 窗口内**；AI 触发挂在 startEvaluation 之后（EVALUATING） | bid.service.ts:600-615 |
| 14 | Redis 端口默认 6379 | docker 映射 **6380→6379**，BullMQ 连接要注意 | docker-compose.yml |

---

## 一、现状对照（精确事实）

### 1.1 procurement 的 `ai-bid-analysis`（被移植方）

| 能力 | 实现关键 |
|------|---------|
| 文件 OCR | Python FastAPI（`:8100`，RapidOCR）+ mammoth（DOCX 直接提文本） |
| LLM 调用 | `LlmService.chatJson<T>()`，DeepSeek `response_format:{type:'json_object'}` 强制 JSON，温度=0，`deterministicSeed`（DJB2 哈希）保证可复现 |
| 招标需求提取 | `TENDER_REQUIREMENTS_PROMPT` → 资质/技术(含★)/商务要求 + scoringRules |
| 投标信息提取 | `BIDDER_INFO_PROMPT` → keyInfo(20+字段) + extractedInfo(完整结构) |
| 三维评分 | technical(50,固定4子项)/commercial(30,固定3子项)/price(20) 三个 `Promise.all` 并行 |
| 响应性 | `TechnicalScore.starredResponse`（★号条款响应检查）— **已覆盖** |
| 串通检测 | `FraudDetectorService` 6 维纯算法（价格离散度/规律/联系方式/文档相似度LCS/结构相似度/元数据） |
| 第二轮横向评分 | `ComparativeScoringService`（≥2 bidder 完成后，LLM 对比，merge 进 scores） |
| 优劣势分析 | `CompetitiveAnalysisService`（LLM，dimension/title/detail/evidence/impact，有 sanitize 白名单+截断） |
| 队列 | BullMQ 两队列（tender/bidder processing）+ 独立 worker 进程（concurrency:2，lockDuration 10min） |
| 孤儿恢复 | `recoverOrphanedTasks`（worker 启动时扫描非终态任务重入队） |
| 文档元数据 | `DocumentMetadataExtractorService`（JSZip 读 docProps / pdf-parse 读 info） |
| 缓存 | `CacheService`（**内存 Map**，TTL 5min，实际未被 processor 使用） |
| 话术中性化 | `neutralizeRecommendationText`（去掉"推荐中标"等倾向性表述） |
| 报告导出 | `DocxGeneratorService`（docx npm 包，7 节） |

### 1.2 ERP 现状（移植目标）

| 能力 | 实际情况 |
|------|---------|
| **辅助评标 API** | `GET /expert/projects/:pid/assist/:sid` → `ExpertService.getAssistData` → `AiService.analyzeBid` |
| **当前 AI 引擎** | `analyzeBid` 是**纯规则+统计引擎**（`'WaterERP-AI v2.0 (Rules + Statistics Engine)'`），**不读文件、不调 LLM** |
| **现有 scoreSuggestion** | **已是 per-item**（按 BidScoreItem，按 category 设 basePercent 映射建议分区间）★关键 |
| **评分维度** | 5 类 `ScoreCategory`：QUALIFICATION/RESPONSIVE/BUSINESS/TECHNICAL/PRICE |
| **评分项** | `BidScoreItem`（category/name/maxScore，管理员自定义；标准模板 5 项，资格+符合性 maxScore=0） |
| **专家评分** | `BidScoreRecord`（`@@unique([expertId,scoreItemId,supplierId])`），submitScores 事务内 upsert + progress 重算 |
| **评标结果** | `generateEvaluationResults`：每专家×供应商汇总，≥5 专家去 1 高 1 低，前 3 名 recommended |
| **评分偏差检测** | `expert-deviation.ts`：组内偏离≥30%danger/≥20%warning |
| **解密** | `decryptSupplier`（**仅 OPENING 窗口内**）：sealedKey + unwrapKey + decryptBuffer(AES-256-GCM) + verifyIntegrity(SHA256) + classifyDecryptOutcome |
| **招标文件** | `BidDocument`（BID_NOTICE 公告 1:1，加密存 MinIO，decryptKey 信封包裹） |
| **投标文件** | `SupplierBidSubmission`（三份：technical/business/coverLetter，各有 AssetId + SealedKey + SM2 签名） |
| **供应商库** | `Supplier` + `SupplierQualification`（无 level 字段）+ `SupplierContact`（email 可空） |
| **开标唱标** | `BidOpeningRecord`（amount/period 是 **String**，bidSupplierId 可空） |
| **状态机** | `DOWNLOAD→SUBMIT→OPENING→EVALUATING→ARCHIVED` |
| **WebSocket** | `BidGateway`（namespace `/bid`，project room + host room） |
| **公告联动** | `syncBidProject`（BID_NOTICE 首次发布 → 创建/同步 BidProject） |
| **DeepSeek** | `.env` 已配（KEY + flash 模型） |
| **Redis** | docker 已有（6380→6379），但 ERP 只用 ioredis 缓存，**无 BullMQ** |
| **OCR** | **完全没有** |
| **KMS_SECRET** | `.env` **未配**（但代码强制要求） |

---

## 二、核心设计原则

### 2.1 三层目标

1. **替换数据源**：ERP 的 `analyzeBid` 从"规则模拟"→"LLM+OCR 真实分析投标文件"
2. **保留 per-item 结构**：复用 ERP 现有 `scoreSuggestion` 的 per-item（按 BidScoreItem）结构，AI 建议逐项对齐专家评分
3. **双源一致性**：系统结构化数据（权威）vs 标书 OCR（验证），冲突即风险

### 2.2 数据优先级（贯穿全局）

| 字段类 | 权威源 | 说明 |
|--------|--------|------|
| 企业主体（名/法人/地址/信用代码） | `Supplier` | 已审批 |
| 资质 | `SupplierQualification` | 已审核证书，标书声明只进一致性校验 |
| 联系方式 | `SupplierContact` | 注册核验 |
| **报价/工期** | `BidOpeningRecord`（开标唱标）> `SupplierBidSubmission`（表单）> 标书 OCR | 法律效力层级 |
| 技术方案/业绩/项目经理 | 标书 OCR | 系统无此数据 |

---

## 三、数据模型扩展（修正版）

在 ERP `schema.prisma` 新增（关联现有 `BidProject`/`BidSupplier`/`BidScoreItem`）：

```prisma
// AI 辅助评标任务（每个 BidProject 进入 EVALUATING 时创建，1:1）
model AiBidAnalysisTask {
  id             String              @id @default(cuid())
  projectId      String              @unique  // 关联 BidProject
  status         AiAnalysisTaskStatus @default(PENDING)
  tenderText     String?             // 招标文件 OCR 文本
  tenderPages    Json?
  requirements   Json?               // LLM 提取的招标要求（含 scoringRules）
  scoringCriteriaSnapshot Json?     // AI 推断的评分标准快照（不回填 BidScoreItem，见 15.8）
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt
  completedAt    DateTime?

  project        BidProject          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  bidderResults  AiBidderResult[]
  report         AiBidReport?
  @@map("ai_bid_analysis_tasks")
}

// 投标单位分析结果（每个 BidSupplier 一条）
model AiBidderResult {
  id                  String        @id @default(cuid())
  taskId              String
  bidSupplierId       String        // 关联 BidSupplier（注意 supplierId 在 BidSupplier 上可空）
  status              AiBidderStatus @default(PENDING)
  // 文本
  technicalText       String?       // 技术标 OCR 文本
  businessText        String?       // 商务标 OCR 文本
  // 提取结果
  extractedInfo       Json?         // 标书 LLM 提取（审计快照）
  systemInfo          Json?         // 系统结构化数据快照（审计快照）
  keyInfo             Json?         // 融合后展示对象（权威源 + 一致性标注）
  // per-item 评分（对齐 BidScoreItem，核心）
  scoreItems          Json?         // [{scoreItemId, category, name, score, maxScore, reason, evidence, confidence}]
  categoryTotals      Json?         // { QUALIFICATION:{score,max}, RESPONSIVE:{...}, ... }
  totalScore          Decimal?      @db.Decimal(5, 2)
  // 判定
  qualificationStatus String?       @default("pending")  // 通过/不通过/待审查
  riskLevel           String?       @default("low")
  riskAnalysis        Json?
  strengths           Json?         // 优劣势（dimension/title/detail/evidence/impact）
  weaknesses          Json?
  overallComment      String?
  deviationAnalysis   Json?
  competitiveAnalysis Json?         // 第二轮横向对比结果
  processedAt         DateTime?

  task        AiBidAnalysisTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  bidSupplier BidSupplier        @relation(fields: [bidSupplierId], references: [id], onDelete: Cascade)
  concordance AiConcordanceResult?

  @@unique([taskId, bidSupplierId])
  @@map("ai_bidder_results")
}

// 双源一致性校验结果（每供应商一条）
model AiConcordanceResult {
  id              String   @id @default(cuid())
  taskId          String
  bidSupplierId   String   @unique  // ★ 修正：每供应商一条，用 bidSupplierId 唯一
  overallStatus   String   // consistent | minor_diff | conflict | insufficient_data
  conflictCount   Int      @default(0)
  warningCount    Int      @default(0)
  checkedFields   Json?    // [{field,label,systemValue,docValue,status,severity,note}]
  generatedAt     DateTime @default(now())

  bidder     AiBidderResult @relation(fields: [bidSupplierId], references: [id], onDelete: Cascade)
  @@map("ai_concordance_results")
}

// 报告
model AiBidReport {
  id                  String  @id @default(cuid())
  taskId              String  @unique
  summary             Json?
  ranking             Json?
  keyInfoComparison   Json?
  priceAnalysis       Json?
  concordanceSummary  Json?
  strengthsWeaknesses Json?
  riskStats           Json?
  highRiskDetails     Json?
  fraudIndicators     Json?   // 串通检测
  reviewSuggestions   Json?
  conclusion          String?
  docxFileId          String?
  generatedAt         DateTime?
  task AiBidAnalysisTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  @@map("ai_bid_reports")
}

enum AiAnalysisTaskStatus { PENDING TENDER_PROCESSING ANALYZING COMPLETED COMPLETED_WITH_ERRORS FAILED CANCELLED }
enum AiBidderStatus {
  PENDING OCR_PROCESSING OCR_COMPLETED EXTRACTING EXTRACTED
  CONCORDANCE_CHECKING SCORING SCORED DEVIATION_ANALYZING COMPLETED FAILED
}
```

**关键修正说明**：
- `AiBidderResult` 关联 `BidSupplier`（其上 `supplierId` 可空关联 `Supplier`）；外键用 `bidSupplierId` 避免与 `BidSupplier.supplierId` 混淆
- 评分用 `scoreItems`（per-item 数组，对齐 `BidScoreItem.id`）+ `categoryTotals`（5 维聚合，供雷达图），**不照搬** procurement 的固定 `breakdown`
- `AiConcordanceResult` 仅 `bidSupplierId @unique`（每供应商一条），无双重 unique 冲突
- 保留 `requirements.scoringRules`（价格评分方法来源）

**给 `BidScoreItem` 增加评分细则字段**（见第六章）：
```prisma
model BidScoreItem {
  // ... 现有字段
  scoringCriteria  String?  // ★ 新增：评分细则（管理员填 或 AI 推断回填）
  evidenceHint     String?  // ★ 新增：评审要点
  criteriaSource   String?  // ★ 新增：manual | ai_inferred
}
```

---

## 四、招标文件自动获取

### 4.1 数据链路（实际）

```
BidProject (stage=EVALUATING)
  ← relatedProjectCode 关联 →
Announcement (type=BID_NOTICE, status=PUBLISHED)  [1:1]
  → BidDocument (announcementId @unique)
    → decryptKey (信封包裹的 base64，或 legacy 原始 hex)
    → FileAsset.key (MinIO 密文路径)
```

### 4.2 获取 + 解密流程（修正：双格式）

```typescript
async fetchTenderPlaintext(projectId: string): Promise<Buffer> {
  // 1. 通过 projectCode 找 BID_NOTICE 公告
  const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
  const announcement = await this.prisma.announcement.findFirst({
    where: { relatedProjectCode: project.projectCode, type: 'BID_NOTICE', status: 'PUBLISHED' },
    include: { bidDocument: { include: { fileAsset: true } } },
  });
  if (!announcement?.bidDocument) throw new NotFoundException('未找到招标文件');

  const doc = announcement.bidDocument;

  // 2. 从 MinIO 读密文
  const ciphertext = await streamToBuffer(
    await minioClient.getObject(MINIO_BUCKET, doc.fileAsset.key)
  );

  // 3. ★ 双格式解密（必须，否则 legacy 数据崩）
  const rawKey = isWrappedKey(doc.decryptKey)
    ? unwrapKey(doc.decryptKey, process.env.KMS_SECRET!)   // 新数据：信封解包
    : doc.decryptKey;                                       // legacy：原始 hex
  const plaintext = decryptBuffer(ciphertext, rawKey);      // AES-256-GCM

  // 4. 完整性校验（原文 sha256）
  verifyIntegrity(plaintext, doc.fileAsset.sha256);

  return plaintext;
}
```

> **前置条件**：`.env` 必须有 `KMS_SECRET`（当前缺失，见第十章）。

---

## 五、投标文件自动获取（修正：三份文件）

### 5.1 数据结构（实际）

`SupplierBidSubmission` 有三份文件，各有独立密钥：
```
technicalFileAssetId  + technicalSealedKey   // 技术标
businessFileAssetId   + businessSealedKey    // 商务标
coverLetterAssetId    + coverLetterSealedKey // 投标函
+ fileHash + signature (SM2) + signedAt      // 抗抵赖
```

### 5.2 解密流程（★ v4.1：复用 bid.service.ts:668-694 真实逻辑，sealedKey 可空）

> **v4.1 关键修正**：v4 原写 `if (!sealedKey) throw` 是**错的**。实证 `bid.service.ts:678` 真实逻辑是 `if (ref.sealedKey) { 解密 }`——**sealedKey 为空时跳过 AES 解密、直接当明文读**（Layer A 仅做完整性校验）。这正是种子 `technicalSealedKey=null`（12/12）却能解出 SUCCESS 的原因：种子走明文直读路径。AI 抓取必须与此对齐，否则对所有种子投标文件抛「缺少文件」。

```typescript
// ★ v4.1：与 decryptSupplier (bid.service.ts:668-694) 逐行对齐
async fetchBidderPlaintext(submission: SupplierBidSubmission, which: 'technical'|'business'|'coverLetter'): Promise<Buffer> {
  const assetId = which === 'technical' ? submission.technicalFileAssetId
                : which === 'business'  ? submission.businessFileAssetId
                : submission.coverLetterAssetId;
  const sealedKey = which === 'technical' ? submission.technicalSealedKey
                : which === 'business'  ? submission.businessSealedKey
                : submission.coverLetterSealedKey;
  if (!assetId) throw new Error(`缺少 ${which} 文件引用`);  // ★ 仅 assetId 必需；sealedKey 可空

  const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error(`投标文件记录缺失: ${assetId}`);

  // sealedPath 优先（Layer B 密文路径），回退原 key（兼容存量明文）
  const readKey = asset.sealedPath || asset.key;
  let buffer = await streamToBuffer(await minioClient.getObject(MINIO_BUCKET, readKey));

  // ★ Layer B：仅当 sealedKey 存在时执行真实 AES 解密；为空则明文直读（种子/legacy 路径）
  if (sealedKey) {
    const rawKey = isWrappedKey(sealedKey) ? unwrapKey(sealedKey, process.env.KMS_SECRET!) : sealedKey;
    buffer = decryptBuffer(buffer, rawKey);
  }

  // Layer A：完整性校验（明文 vs 存储 sha256）
  if (verifyIntegrity(buffer, asset.sha256) === false) {
    throw new Error(`${which} 标书完整性校验失败：SHA-256 不匹配`);
  }
  return buffer;  // 明文，内存中，不落盘（见 15.2）
}
```

### 5.3 三份文件用途分工

| 文件 | 用途 |
|------|------|
| **technical（技术标）** | 技术方案/设备/人员/质量保障提取 → TECHNICAL 评分 + starredResponse（→ RESPONSIVE） |
| **business（商务标）** | 资质/业绩/报价分项/服务承诺提取 → BUSINESS/QUALIFICATION/PRICE 评分 |
| **coverLetter（投标函）** | 报价确认/签字盖章核验 → 符合性 |

### 5.4 触发时机（修正：解密窗口约束）

```
OPENING 阶段：
  管理员在开标大厅逐个 decryptSupplier（受 decryptWindowStart/End 约束）
  或新增 POST /bid/projects/:id/decrypt-all（一键解密窗口内待解密供应商）

startEvaluation（OPENING → EVALUATING）：
  ★ AI 分析触发点（此时所有解密已定型）
  三重门控：≥1 专家 + ≥1 解密成功供应商 + ≥1 评分项
  → 创建 AiBidAnalysisTask + 入队 tender/bidder 处理
```

> **关键**：解密只能在 OPENING 窗口内（`bid.service.ts:610-615`），`decrypt-all` 不是 AI 触发点，AI 触发独立挂在 `startEvaluation` 之后。

---

## 六、评分改造（修正：换数据源，不改结构）

### 6.1 核心认知修正

**v2 错误**：认为 ERP 无 per-item，需从 procurement 固定 breakdown 改造。
**v3 事实**：ERP 现有 `AiService.generateScoreSuggestions`（ai.service.ts:212-261）**已是 per-item**——遍历 `BidScoreItem`，按 category 设 basePercent，输出 `{category, name, suggestedScore, minScore, maxScore, reason, confidence}`。

**真正要做的**：保留 per-item 结构，把数据源从"规则 basePercent"换成"LLM 分析投标文件"。

### 6.2 评分标准来源（三层）

| 层 | 来源 | 说明 |
|----|------|------|
| ① 管理员填写 | `BidScoreItem.scoringCriteria`（新增字段） | 编制评分标准时写细则 |
| ② AI 从招标文件推断 | `TenderExtractor` 已提取 `scoringRules` + 各维度要求 | 为缺细则的评分项推断标准，回填标记 `criteriaSource=ai_inferred` |
| ③ 评分时实时参考 | extractedInfo + requirements + scoringCriteria | 一起传 LLM |

### 6.3 GenericItemScorerService（取代 procurement 3 个固定评分器）

```typescript
@Injectable()
export class GenericItemScorerService {
  constructor(private llm: LlmService) {}

  async score(
    scoreItems: BidScoreItem[],        // 含 scoringCriteria
    extractedInfo: any,                 // 投标文件提取
    requirements: TenderRequirements,
    taskId: string, bidSupplierId: string,
  ): Promise<{ scoreItems: AiScoreItem[]; categoryTotals: Record<string,{score,max}>; totalScore: number; overallComment: string }> {

    // ★ 价格项分离：公式计算，不走 LLM
    const priceItems = scoreItems.filter(si => si.category === 'PRICE');
    const llmItems = scoreItems.filter(si => si.category !== 'PRICE');

    const llmResult = await this.llm.chatJson(
      '你是评标专家。按评分标准对每个评分项独立评分。',
      ITEM_SCORING_PROMPT
        .replace('{{SCORE_ITEMS}}', JSON.stringify(llmItems.map(si => ({
          id: si.id, category: si.category, name: si.name, maxScore: si.maxScore,
          scoringCriteria: si.scoringCriteria, evidenceHint: si.evidenceHint,
        }))))
        .replace('{{BIDDER_INFO}}', JSON.stringify(extractedInfo))
        .replace('{{REQUIREMENTS}}', JSON.stringify(requirements)),
      0, undefined, deterministicSeed(taskId + ':' + bidSupplierId + ':score'),
    );

    // 价格项公式计算（基准价法/最低价法，来自 requirements.scoringRules.priceMethod）
    const priceResults = priceItems.map(si => this.scorePriceByFormula(si, extractedInfo, allBidders));

    // 合并 + 分类聚合
    return this.mergeAndAggregate([...llmResult.items, ...priceResults]);
  }
}
```

### 6.4 响应性（RESPONSIVE）维度映射

procurement 的 `TechnicalScore.starredResponse`（★号条款响应检查）→ 映射到 ERP `RESPONSIVE` 维度。**不是 procurement 完全没有响应性**，而是复用 starredResponse。

### 6.5 资格/符合性审查项（maxScore=0）

模板中 `QUALIFICATION`/`RESPONSIVE` 的 `maxScore=0` 是符合性审查项（通过/不通过），AI 输出 `{score: 0|满分占位, pass: boolean, reason}`，不参与数值评分但影响资格判定。

---

## 七、双源一致性引擎（修正：String 归一化）

### 7.1 字段类型现实（必须归一化）

| 字段 | 系统源 | 类型 | 处理 |
|------|--------|------|------|
| 报价 | `BidOpeningRecord.amount` | **String** | `normalizePrice` 解析（"2350万元"→2350） |
| 报价（备选） | `SupplierBidSubmission.bidPrice` | **String** | 同上 |
| 工期 | `BidOpeningRecord.period` | **String** | `parsePeriodDays`（"540日历天"→540） |
| 资质等级 | `SupplierQualification.name` | String | **正则解析等级**（"水利水电施工总承包甲级"→甲级），无独立 level 字段 |
| 联系电话 | `SupplierContact.phone` | String | 归一化（去空格横线） |
| 联系邮箱 | `SupplierContact.email` | **String?可空** | null 安全 |
| 法人 | `Supplier.legalPerson` | String | 精确匹配 |

### 7.2 ConcordanceVerifierService

```typescript
async verify(systemData: SystemData, docKeyInfo: BidderKeyInfo): Promise<ConcordanceResult> {
  const checks: FieldCheck[] = [
    this.checkPrice(
      this.normalizePrice(systemData.openingAmount) ?? this.normalizePrice(systemData.submissionPrice),
      this.normalizePrice(docKeyInfo.quotePrice),
    ),
    this.checkPeriod(
      this.parsePeriodDays(systemData.openingPeriod) ?? this.parsePeriodDays(systemData.submissionPeriod),
      this.parsePeriodDays(docKeyInfo.constructionPeriod),
    ),
    this.checkQualification(
      this.extractQualificationLevels(systemData.qualifications),  // 从 name 正则解析
      docKeyInfo.qualificationLevel,
    ),
    this.checkContact(systemData.contacts, docKeyInfo.contactInfo),  // email 可空
    this.checkLegalPerson(systemData.legalPerson, docKeyInfo.legalPerson),
    this.checkCreditCode(systemData.creditCode, docKeyInfo.license?.number),
  ];
  return this.summarize(checks);
}

// 报价归一化（处理 万元/元/亿 单位）
private normalizePrice(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[¥,元万亿\s]/g, '');
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (value.includes('亿')) n *= 10000;
  else if (value.includes('元') && !value.includes('万元')) n /= 10000; // 元→万元
  return n;
}

// 资质等级从 name 解析（如「水利水电工程施工总承包甲级」）
private extractQualificationLevels(quals: SupplierQualification[]): string[] {
  const levels = ['特级','甲级','一级','乙级','二级','丙级','三级'];
  return quals.map(q => levels.find(l => q.name?.includes(l))).filter(Boolean) as string[];
}
```

### 7.3 一致性 → 评分影响

- 报价 conflict → PRICE 项 score=0 + riskWarning + 转人工
- 资质 conflict（系统无此等级 vs 标书声明）→ QUALIFICATION `qualificationStatus='不通过'` + riskLevel=high

---

## 八、移植的服务清单（procurement → ERP）

### 8.1 直接复制并适配的服务

| procurement 服务 | 适配点 |
|----------------|--------|
| `LlmService`（local-ai/llm.service.ts） | ★ v4.1：**不能原样复制**——(1) `llm.service.ts:37` 硬编码 `model:'deepseek-v4-pro'` 不读 env，必须重构为 `config.get('DEEPSEEK_MODEL','deepseek-v4-pro')`；(2) 构造函数 `@Inject(forwardRef(()=>VllmMonitorService))` 强依赖 vLLM 监控，ERP 无 vLLM 基建 → DI 启动即崩。推荐抽 **DeepSeek-only 精简版**（去掉 local/vLLM fallback + `VllmMonitorService`/`embedding.service.ts` 依赖） |
| `OcrService`（local-ai/ocr.service.ts） | `OCR_SERVICE_URL` 指向**本机 procurement :8100**（同机复用，不部署新服务，见第十四章） |
| `DocumentMetadataExtractorService` | 直接复用（串通检测元数据维度） |
| `FraudDetectorService`（6 维算法） | 直接复用；增强：用 `SupplierContact` 全量数据做联系方式检测 |
| `CompetitiveAnalysisService`（优劣势 LLM） | 直接复用（含 sanitize 白名单） |
| `ComparativeScoringService`（第二轮横向） | **改为 per-item 合并**（不再 merge 固定 breakdown） |
| `ReportGeneratorService` | 适配 per-item 结构 |
| `DocxGeneratorService` + `neutralizeRecommendationText` | 直接复用（话术中性化） |
| `utils/`（price-statistics, text-similarity, deterministicSeed, retry） | 直接复用 |
| `recoverOrphanedTasks`（worker.ts:43-102） | 直接复用（扫描非终态任务重入队） |

### 8.2 新建/重写的服务

| 服务 | 说明 |
|------|------|
| `GenericItemScorerService` | 取代 procurement 3 个固定评分器，按 BidScoreItem per-item 评分（第六章） |
| `ScoreCriteriaInfererService` | AI 从招标文件为评分项推断 scoringCriteria 并回填 |
| `ConcordanceVerifierService` | 双源一致性校验（第七章） |
| `TenderExtractorService` | 复用 procurement，但增加「评分标准推断」输出 |
| `BidderExtractorService` | 复用，提取后与 systemInfo 融合 |
| `AiBidAnalysisWorker` | 独立 worker 进程（含孤儿恢复） |

### 8.3 改造的现有 ERP 服务

| 服务 | 改造 |
|------|------|
| `ExpertService.getAssistData` | 从读 `AiService.analyzeBid`（规则）→ 读 `AiBidderResult`（LLM 结果），保留 per-item 结构 |
| `AiService` | 保留规则引擎作为**降级 fallback**（LLM/OCR 不可用时） |
| `BidService.startEvaluation` | ★ v4.1：**新增** AI 触发（创建 task + 入队）；现状该函数无 AI hook，见 Phase 4.3 |
| 新增 `POST /bid/projects/:id/decrypt-all` | 一键解密窗口内待解密供应商 |

---

## 九、结果发布到专家页面

### 9.1 改造 getAssistData（保留 per-item）

```typescript
async getAssistData(userId, projectId, supplierId) {
  // 现有门控：OPENING/EVALUATING + 角色校验
  const task = await this.prisma.aiBidAnalysisTask.findUnique({
    where: { projectId },
    include: {
      bidderResults: { where: { bidSupplierId: supplierId }, include: { concordance: true } },
      report: true,
    },
  });

  // AI 未完成 → 降级到规则引擎（保留现有 AiService.analyzeBid 作为 fallback）
  if (!task || task.status !== 'COMPLETED') {
    return this.aiService.analyzeBid(projectId, supplierId);  // 规则引擎兜底
  }

  const result = task.bidderResults[0];
  return {
    supplierName: result.bidSupplier.supplierName,
    model: 'WaterERP-AI v3.0 (DeepSeek + OCR + 双源一致性)',
    generatedAt: result.processedAt,
    // ★ 保留现有 AiAnalysisResult 结构（前端兼容）
    overall: this.buildOverall(result),           // 含 breakdown
    complianceCheck: this.buildCompliance(result),
    riskAnalysis: this.buildRisk(result),
    scoreSuggestion: result.scoreItems,           // ★ per-item，结构与现有一致
    keyPoints: this.buildKeyPoints(result),
    // v3 新增
    concordance: result.concordance,
    fraudIndicators: task.report?.fraudIndicators,
  };
}
```

### 9.2 WebSocket 推送（复用 BidGateway）

- bidder 处理完成 → `project:${id}` room 推 `ai:bidder:completed`
- 全部完成 → 推 `ai:analysis:completed`

---

## 十、环境与依赖（修正）

### 10.1 `.env` 增补

```bash
# ★ 必须新增（当前缺失，wrapKey/unwrapKey 强制要求）
KMS_SECRET=<openssl rand -hex 32 生成>

# OCR 服务（新增）
OCR_SERVICE_URL=http://localhost:8100

# DeepSeek（已有 KEY + flash）。★ v4.1：仅改 env 不生效——procurement llm.service.ts:37 硬编码 pro 不读 env；
# 必须先重构该行为 env 驱动（见 8.1 / Phase 2.1），此行才生效
DEEPSEEK_MODEL=deepseek-v4-pro   # 当前是 flash；改 pro 获更深分析（可选，重构后生效）

# BullMQ 用现有 Redis（注意端口 6380→6379）
REDIS_URL=redis://localhost:6380
```

### 10.2 依赖安装

```bash
pnpm --filter api add @nestjs/bullmq bullmq
```

### 10.3 OCR 服务接入（同机复用，零部署）

> **v4 修正**：procurement 与 ERP 同机，OCR 服务**已在 `:8100` 实跑**（`rapid` 引擎，`onnxruntime-gpu 1.23.2` 实跑于 RTX 5090D）。ERP **不部署任何 Python 服务**，直接复用。详见第十四章。

两步接入：
1. 复制 Node 端调用方（契约与 `:8100` 的 `POST /ocr` 完全匹配，含大文件 `page_range` 分批）：
   ```bash
   cp /home/asus/桌面/procurement/apps/api/src/local-ai/ocr.service.ts \
      /home/asus/桌面/ERP/water-erp/apps/api/src/local-ai/ocr.service.ts
   ```
2. `apps/api/.env` 加：
   ```bash
   OCR_SERVICE_URL=http://localhost:8100
   ```

`/ocr` 接口契约（multipart：`file`+`dpi`(150)+`max_pages`(200)+`page_range`）与引擎无关——rapid/opendataloader 走同一接口，ERP 侧零改动。验证：`OcrService.isAvailable()` 调 `GET /health` 应返回 `{"status":"ok",...}`。

**耦合代价**：ERP OCR 依赖 procurement `:8100` 进程，procurement 停则 ERP OCR 断；缓解靠 `isAvailable()` 健康检查 + 规则引擎降级 fallback（第十三章）。本机开发环境可接受；需彻底解耦时 ERP 起独立实例换端口 `8101`（非必需）。

### 10.4 Worker 进程

新增 `apps/api/src/ai-bid-analysis-worker.ts` + `.module.ts`（独立 Nest 进程，注册 processor + 孤儿恢复）。`package.json` 加 `dev:worker:ai` / `start:worker:ai`。**必须从 `dist/` 运行**（NestJS DI 需 `emitDecoratorMetadata`）。

---

## 十一、前端展示（修正：纵向卡片 → Tab 容器）

### 11.1 现状修正

ERP `evaluate/[id]/page.tsx` 的 assist step 当前是**单列纵向卡片**（综合评分→符合性→风险→评分建议→关键要点），**不是 Tab**。`AssistData` 类型在 `packages/shared/src/types.ts:189-198`。

### 11.2 改造为 Tab 容器

```
辅助评标 Tab：
[🔴 数据一致性] [关键信息] [评分分析] [串通检测] [综合报告]
```

- **数据一致性**（首屏）：ConcordanceVerifier 结果，红/黄/绿三色，冲突优先
- **关键信息**：三区设计（系统库/资质/报价/标书核心内容，每字段标数据源）
- **评分分析**：per-item 评分（按 category 分组）+ 5 维雷达图 + AI建议vs专家分对比
- **串通检测**：FraudDetector 6 维指标
- **综合报告**：排名 + 导出 DOCX

### 11.3 评分分析 Tab 内容（per-item）

```
▎技术评审 (42.0/50)
  施工组织设计  18/20  AI建议  [展开：理由 + 标书证据 + 置信度]
  设备配置       8/10  AI建议
  ...
▎商务评审 (25.0/30)  ▎价格评审 (18.5/20)  ▎资格/响应性 (通过)

▎AI 建议 vs 您的评分（如已打分）
  评分项        AI建议   您的评分   偏差
  施工组织设计  18.0     17.5      -0.5
```

### 11.4 定位声明（每页）

procurement 是"AI 决策最终结果"，ERP 是"AI 辅助参考"。复用 `neutralizeRecommendationText` + 显著声明「仅供参考，以专家独立评分为准」。

---

## 十二、移植步骤（修正·最终）

### Phase 1: 环境与依赖（1 天）

```
□ 1.1 .env 加 KMS_SECRET（openssl rand -hex 32）、OCR_SERVICE_URL、REDIS_URL=6380
□ 1.2 DEEPSEEK_MODEL 改 pro（可选；★ v4.1：需先重构 llm.service.ts:37 为 env 驱动，否则改了不生效，见 Phase 2.1）
□ 1.3 pnpm --filter api add @nestjs/bullmq bullmq
□ 1.4 复制 Node 端 `local-ai/ocr.service.ts` 到 ERP；`OCR_SERVICE_URL` 指向本机 procurement :8100（**无需部署 Python 服务**，见第十四章）
□ 1.5 Prisma 迁移：AiBidAnalysisTask/AiBidderResult/AiConcordanceResult/AiBidReport + BidScoreItem 加 3 字段
```

### Phase 2: 基础模块移植（2 天）

```
□ 2.1 复制 local-ai/——★ v4.1 前置：LlmService 抽 **DeepSeek-only 精简版**（重构 `llm.service.ts:37` 硬编码 model 为 env；剥离 `VllmMonitorService`/`embedding.service.ts` 强依赖，否则 DI 崩）；OcrService/DocumentMetadataExtractor/utils 直接复用
□ 2.2 复制 ai-bid-analysis/ services（FraudDetector/CompetitiveAnalysis/Report/Docx/extractors）
□ 2.3 适配 StorageModule → ERP MinIO（复用 sealedPath + isWrappedKey 解密）
□ 2.4 改写 ComparativeScoring 为 per-item 合并
```

### Phase 3: 双源 + 评分核心（3 天）

```
□ 3.1 SystemData 聚合（Supplier+Qualification+Contact+Submission+OpeningRecord）
□ 3.2 ConcordanceVerifierService（String 归一化：normalizePrice/parsePeriodDays/资质正则）
□ 3.3 ScoreCriteriaInfererService（AI 推断 scoringCriteria 回填）
□ 3.4 GenericItemScorerService（per-item，价格项公式分离，starredResponse→RESPONSIVE）
□ 3.5 ITEM_SCORING_PROMPT + categoryTotals 聚合
```

### Phase 4: 数据流集成（2 天）

```
□ 4.1 fetchTenderPlaintext（isWrappedKey 双格式）
□ 4.2 fetchBidderPlaintext（三份文件，复用 bid.service 解密流程）
□ 4.3 ★ v4.1：在 BidService.startEvaluation（bid.service.ts:530-584）**新增** AI 触发调用（创建 task + 入队）——现状该函数体内无任何 AI/queue 调用，是新增逻辑而非扩展；三重门控（≥1 专家 + ≥1 解密成功供应商 + ≥1 评分项）已就位
□ 4.4 新增 POST /bid/projects/:id/decrypt-all
□ 4.5 改造 ExpertService.getAssistData（读 AiBidderResult，规则引擎降级）
```

### Phase 5: Worker（1.5 天）

```
□ 5.1 ai-bid-analysis-worker.ts + .module.ts（独立进程）
□ 5.2 recoverOrphanedTasks（复用 procurement）
□ 5.3 TenderProcessor/BidderProcessor 适配 ERP 数据流
□ 5.4 package.json scripts
```

### Phase 6: 前端（4 天）

```
□ 6.1 assist step 纵向卡片 → Tab 容器
□ 6.2 数据一致性面板 + 关键信息三区
□ 6.3 评分分析 per-item 展示 + 5 维雷达图
□ 6.4 AI建议 vs 专家分对比（读 BidScoreRecord）
□ 6.5 串通检测面板 + 综合报告 + DOCX 导出
□ 6.6 定位声明 + neutralizeRecommendationText
```

### Phase 7: 测试（2 天）

```
□ 7.1 一致性归一化单元测试（String→Number 各种格式）
□ 7.2 解密双格式测试（wrapped + legacy）
□ 7.3 per-item 评分 + 价格公式测试
□ 7.4 E2E：公告→投标→开标解密→startEvaluation→AI分析→专家查看
```

**总工期：13-16 天**（v4：OCR 部署归零，较 v3 砍 1-2 天）

---

## 十三、风险与缓解

| 风险 | 缓解 |
|------|------|
| KMS_SECRET 缺失导致解密全崩 | Phase 1.1 强制配置 + seed 数据验证 |
| String 字段直接对比 NaN | 所有系统源字段强制 normalizePrice/parsePeriodDays |
| legacy 数据 decryptKey 是原始 hex | isWrappedKey 双格式判断（必须） |
| 评分项无 scoringCriteria，LLM 评不准 | AI 推断回填 + criteriaSource 标记 + 低 confidence 提示 |
| OCR 大文件慢/失败 | 并发 2 + 200 页上限 + DOCX 走 mammoth + 重试 3 次；`page_range` 分批 |
| OCR 依赖 procurement :8100 进程 | 同机复用导致耦合；`OcrService.isAvailable()` 健康检查 + 规则引擎降级 fallback 兜底；需解耦时 ERP 起独立实例换端口 8101 |
| 扫描件识别质量（rapid 模式） | 电子件充分；扫描件质量作为**后置可逆决策**，不足时改 procurement `.env` 的 `OCR_ENGINE`（ERP 侧零改动） |
| 解密窗口外无法触发 AI | AI 触发挂 startEvaluation（EVALUATING），不依赖运行时解密 |
| LLM 费用 | deterministicSeed 缓存 + 温度 0 + 价格项走公式不走 LLM |
| AI/OCR 不可用 | 保留规则引擎 analyzeBid 作为降级 fallback |

---

## 十四、OCR 服务接入（同机复用 procurement :8100）

> **v4 整章重写**。v3 本章原为"完整移植 opendataloader + hybrid + GPU + v5 模型"（约 200 行），经 2026-06-24 本机实证发现与 procurement 实况不符，**整章废止**，替换为同机复用方案。

### 14.1 本机实证（procurement 与 ERP 同机）

| 实证项 | 结果 |
|--------|------|
| `GET :8100/health` | `{"status":"ok","engine":"rapid","hybrid":false,"workers":0}` |
| `procurement/services/ocr/.env` | 仅 `OCR_ENGINE=rapid` + `OCR_MAX_SIDE=3000`（无 hybrid/GPU/v5 配置） |
| `~/.rapidocr/models/v5/` | **不存在**（v5 未启用） |
| GPU | RTX 5090D，空闲 ~19GB，`onnxruntime-gpu 1.23.2` 支持 Blackwell（compute_cap 12.0） |
| Java | openjdk 11（已装，hybrid 备用） |

**结论**：procurement 本机跑的就是精简 rapid 模式，v3 本章论述的"完整 opendataloader + hybrid"在本机并不存在。v3 的 14.1「精简 vs 完整」对比表是理论推演，不代表实际选择。

### 14.2 接入步骤（两步，零 Python 部署）

```bash
# 1. 复制 Node 端调用方（契约与 :8100 完全匹配）
cp /home/asus/桌面/procurement/apps/api/src/local-ai/ocr.service.ts \
   /home/asus/桌面/ERP/water-erp/apps/api/src/local-ai/ocr.service.ts

# 2. ERP apps/api/.env 加一行
echo 'OCR_SERVICE_URL=http://localhost:8100' >> /home/asus/桌面/ERP/water-erp/apps/api/.env
```

注册 `OcrService` 到 `LocalAiModule` 的 providers + exports。`POST /ocr` 契约（multipart：`file`+`dpi`(150)+`max_pages`(200)+`page_range`）与引擎无关，rapid/opendataloader 走同一接口，**ERP 侧零改动**。

### 14.3 验证

```bash
curl http://localhost:8100/health           # → {"status":"ok","engine":"rapid",...}
# Node 端
OcrService.isAvailable()                     # → true
# 实跑一张投标 PDF，确认 nvidia-smi 中 uvicorn 进程占显存（rapid GPU 路径生效）
```

### 14.4 扫描件质量（后置可逆决策，非前置）

rapid 模式对电子 PDF / DOCX（mammoth 提文本）充分。扫描件质量若日后证伪，**只改 procurement `services/ocr/.env`**：
- 启用 hybrid：加 `OCR_HYBRID_DEVICE=cuda` + `OCR_HYBRID_WORKERS=2`
- 或换引擎：`OCR_ENGINE=opendataloader`

ERP 侧零改动（共用同一份 Python 代码 + 同一 `:8100`）。此决策后置到「真实扫描件数据回归」之后，不在首期阻塞。

### 14.5 注意事项

1. **进程耦合**：ERP OCR 依赖 procurement `:8100`；procurement 重启时 ERP OCR 短暂中断，靠 `isAvailable()` + 规则引擎降级兜底（第十三章）。
2. **显存共存**：本机已有两个 `vLLM::EngineCore`（各 ~2GB）；rapid worker 再占 ~1-2GB，19GB 空闲足够，但 OCR 批处理峰值需观察 vLLM 尾延迟。
3. **不改 procurement 代码**：`main.py`/`ocr_engine.py` 原样；行为调整只动 `.env`。
4. **不要复制 `services/ocr/` 目录到 ERP**：v3 此步（Step 1）已废止——同机无需两份 Python 服务，也无需新建 venv / 装 v5 模型 / 改 docker-compose。
5. **未来独立部署（可选）**：若 ERP 上线需与 procurement 解耦，再 `cp -r services/ocr` 到 ERP 起独立实例（换端口 8101 + 独立 venv），届时可参考 v3 的 systemd/PM2 方案。首期不做。

---

## 十五、移植盲点与边界处理

前期方案聚焦主流程，以下 11 个边界点在移植时必须处理。A 类为强制规范（不处理会导致错误/安全/合规问题），B 类按推荐实现，C/D 类为明确方案。

### 15.1【A·强制】供应商过滤：复用 ERP 现有过滤逻辑

procurement 的 bidder 手动添加、全部参与；ERP 的 `BidSupplier` 有状态机，AI 分析必须只处理有效供应商。

**过滤条件**（与 `generateEvaluationResults` 完全一致）：
```typescript
// BidService.startEvaluation 触发 AI 入队时，只对有效供应商创建 AiBidderResult
// ★ v4 修正：与 generateEvaluationResults (bid.service.ts:925) 完全一致
// 注意是 ===CONFIRMED（正向），不是 !==EXCEPTION（v3 写法会让 PENDING 混入）
const analyzableSuppliers = project.suppliers.filter(s =>
  s.decryptStatus === 'SUCCESS' &&
  s.submitStatus !== '已撤回' &&
  s.confirmStatus === 'CONFIRMED',
);
```

- `decryptStatus !== 'SUCCESS'`（PENDING/DANGER）→ 无可读投标文件，跳过
- `submitStatus === '已撤回'`（withdrawSubmission 后）→ 跳过
- `confirmStatus !== 'CONFIRMED'`（PENDING / EXCEPTION）→ 未确认或异常，跳过

**禁止**：对已撤回/解密失败的供应商创建分析任务，否则结果污染排名与对比评分。

### 15.2【A·强制】明文文件安全：走内存流，不落盘

解密链路产出明文投标文件给 OCR，**严禁落 MinIO**（原系统只有密文，落明文等于扩大泄露面）。

**实现**（内存流）：
```typescript
// BidderProcessor 中（★ v4.1：sealedKey 可空，对齐 bid.service.ts:678）
const ciphertext = await streamToBuffer(await minioClient.getObject(MINIO_BUCKET, asset.sealedPath || asset.key));
// 仅当 sealedKey 存在才 AES 解密；为空则明文直读（种子/legacy 路径）
let plaintext: Buffer = ciphertext;
if (sealedKey) {
  const rawKey = isWrappedKey(sealedKey) ? unwrapKey(sealedKey, KMS_SECRET!) : sealedKey;
  plaintext = decryptBuffer(ciphertext, rawKey);  // 内存中明文
}

// 直接 POST 给 OCR 服务，不 putObject 到 MinIO
const formData = new FormData();
formData.append('file', new Blob([new Uint8Array(plaintext)]), 'bid.pdf');
const ocrResult = await fetch(`${OCR_SERVICE_URL}/ocr`, { method: 'POST', body: formData });
// plaintext 出作用域即被 GC，不持久化
```

**OCR 文本持久化**：只存 OCR 提取的**文本**到 `AiBidderResult.technicalText/businessText`（文本非文件，且是分析必需），不存明文文件本身。

**OCR 服务侧**：`services/ocr/main.py` 的 `logger.info` 不得记录文件内容（默认只记页数/字符数，已符合）；生产关闭 DEBUG 级日志。

### 15.3【A·强制】与正式排名的技术隔离

AI 的 `AiBidderResult.totalScore` 是辅助参考，**绝不流入** `BidEvaluationResult`（正式排名）。

**隔离规则**：
- `BidService.generateEvaluationResults` 只读 `BidScoreRecord`（专家评分），**禁止** import/查询 `AiBidderResult`
- `ComparativeScoringService`（AI 第二轮横向）只更新 `AiBidderResult.scores`，不写 `BidScoreRecord`
- 前端：辅助评标 Tab 显示 AI 分（标注"参考"），专家打分 Tab 显示专家分，两套数据源物理隔离

**代码层检查**：`expert.service.ts` / `bid.service.ts` 中任何评分聚合方法不得引用 `ai-bid-analysis` 模块的 service。

### 15.4【B·推荐】专家回避与串通检测可见性

**回避屏蔽**：`getAssistData` 校验回避：
```typescript
async getAssistData(userId, projectId, supplierId) {
  const expert = await this.prisma.bidExpert.findFirst({ where: { projectId, userId } });
  if (expert.conflictedSupplierIds.includes(supplierId)) {
    throw new ForbiddenException('该供应商在您的回避名单中');  // 屏蔽
  }
  // ...
}
```

**串通检测分层可见**（检测方法泄露会让围标方下次规避）：
- 专家端：只看摘要「存在 N 项风险线索，建议关注」（不展示联系方式重叠/文档相似度细节）
- `admin`/`bid_host`/监督端：完整 6 维指标 + 证据
- 实现：`GET /expert/projects/:id/assist/fraud/:supplierId` 返回摘要；`GET /bid/projects/:id/fraud-detection`（管理端）返回完整

### 15.5【B·推荐】重新分析机制

新增 `POST /bid/projects/:id/rerun-ai-analysis`：
- **门控**：仅 `admin`/`bid_host` + 项目状态 EVALUATING + 审计日志 `AuditLog`
- **限流**：同项目 10 分钟内只能重跑 1 次（防 LLM 费用滥用）
- **流程**：清除该 task 的旧 `AiBidderResult` → 重置 task 状态 PENDING → 重新入队
- **触发场景**：评分标准修正、澄清答疑更新、供应商补件后重新解密

### 15.6【B·推荐】部分供应商失败的处理

`tryComparativeScoring`（全部 COMPLETED 才跑）改为**容忍部分失败**：
```typescript
private async tryComparativeScoring(taskId: string) {
  const all = await this.prisma.aiBidderResult.findMany({ where: { taskId } });
  const completed = all.filter(r => r.status === 'COMPLETED');
  const failed = all.filter(r => r.status === 'FAILED');

  // 有 COMPLETED 的就跑对比（≥2），FAILED 的排除出对比
  if (completed.length >= 2) {
    await this.comparativeScoring.score(taskId);  // 内部只取 COMPLETED
  }

  // 全部终态（COMPLETED 或 FAILED）即任务完成
  if (all.every(r => ['COMPLETED','FAILED'].includes(r.status))) {
    await this.prisma.aiBidAnalysisTask.update({
      where: { id: taskId },
      data: { status: all.some(r => r.status === 'FAILED') ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED', completedAt: new Date() },
    });
  }
}
```

`AiAnalysisTaskStatus` 增加 `COMPLETED_WITH_ERRORS`（部分失败）。报告 ranking 标注失败供应商为「分析失败」，不参与排名但不阻塞报告生成。

### 15.7【B·推荐】LLM 缓存启用（Redis，按 seed）

procurement 的 `CacheService`（内存 Map）实际未被 processor 调用——重跑会重复花 LLM 费用。迁移时**正式启用 Redis 缓存**：

```typescript
// 替换 CacheService 为 Redis 实现
@Injectable()
export class LlmCacheService {
  constructor(@Inject('REDIS') private redis: Redis) {}

  async getOrCall<T>(seed: number, system: string, user: string, fn: () => Promise<T>): Promise<T> {
    const key = `llm:cache:${seed}:${this.hash(system + user)}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);
    const result = await fn();
    await this.redis.setex(key, 7 * 24 * 3600, JSON.stringify(result));  // 7 天
    return result;
  }
}
```

- 缓存 key 基于 `deterministicSeed` + prompt hash，相同输入命中缓存
- TTL 7 天（与 BullMQ removeOnComplete 一致）
- 重跑 AI 分析默认用缓存（命中不花钱），`rerun-ai-analysis` 支持 `?force=true` 绕过

### 15.8【C·方案】评分标准推断时序（修正第六章）

第六章原方案「AI 推断回填 `BidScoreItem.scoringCriteria`」有时序冲突——`BidScoreItem` 在 EVALUATING 后锁定（`assertScoreItemsEditable`），AI 触发（startEvaluation）已在锁定后，无法回填。

**修正方案**：评分标准**不回填 BidScoreItem**，改存 AI 侧快照：

```prisma
// AiBidAnalysisTask 增加字段
model AiBidAnalysisTask {
  // ... 现有字段
  scoringCriteriaSnapshot Json?  // ★ AI 推断的评分标准快照 [{scoreItemId, criteria, evidenceHint, source}]
}
```

- 管理员在 OPENING（锁定前）填的 `BidScoreItem.scoringCriteria` → 优先用
- 为空的项，AI 在招标提取阶段推断 → 写入 `AiBidAnalysisTask.scoringCriteriaSnapshot`（不动 BidScoreItem）
- `GenericItemScorerService` 评分时合并两者：`BidScoreItem.scoringCriteria ?? snapshot[itemId]`

这样既尊重锁定，又让 AI 有标准可用。

### 15.9【C·方案】澄清答疑纳入需求提取

`BidClarification`（已回复的）可能实质修改招标要求。`TenderExtractorService` 输入增加澄清：

```typescript
async extract(text: string, clarifications: BidClarification[], taskId?: string) {
  const clarText = clarifications
    .filter(c => c.status === '已回复' && c.reply)
    .map(c => `【${c.supplierName}问】${c.question}\n【答】${c.reply}`)
    .join('\n\n');
  const prompt = TENDER_REQUIREMENTS_PROMPT
    .replace('{{TENDER_TEXT}}', text)
    .replace('{{CLARIFICATIONS}}', clarText || '无澄清');
  // ...
}
```

`TENDER_REQUIREMENTS_PROMPT` 增加 `{{CLARIFICATIONS}}` 占位符与说明「以下澄清答疑是对招标要求的补充/修改，提取需求时一并考虑」。

### 15.10【C·方案】监督与归档

**监督日志**（开评标监督要求）：
- AI 分析启动 → 写 `BidSupervisionLog`：`{role:'系统', action:'启动AI辅助分析', result:'N家供应商'}`
- 串通检测发现高风险 → 写监督日志 + `gateway.notifyAnomaly` 推 host room
- bid-portal 监督端展示 AI 分析进度（只读，符合监督非干预原则）

**归档**：
- AI 报告 DOCX 生成后，作为 `BidArchiveItem` 纳入归档包
- DOCX 的 sha256 纳入 `bid-archive.digest.ts` 的 hash chain（保证报告不可篡改）

### 15.11【D·确认】种子数据就绪度（英雄项目 cmqhero-bid-proj01）

E2E 验证前确认种子数据齐备：

```
□ BidDocument 存在（announcementId 关联，type=BID_NOTICE）
□ decryptKey 可解密（KMS_SECRET 已配置 + isWrappedKey 双格式覆盖；hero 招标 decryptKey 是 legacy 原始 hex）
□ SupplierBidSubmission 三份文件齐全（technical/business/coverLetter 各有 AssetId；**SealedKey 当前全 null——走明文直读，见 5.2**）
□ ★ v4.1：种子 `technicalSealedKey` 实测 12/12 为 null → fetchBidderPlaintext 走「sealedKey 可空」明文直读路径（5.2 已对齐 bid.service.ts:678）。**真加密流 E2E 需另生成带 sealedKey 的种子**（非首期阻塞）
□ BidSupplier 解密状态 SUCCESS（非 PENDING/DANGER）
□ BidScoreItem 已配置（非空，有评分项）
□ BidOpeningRecord 有 amount/period（一致性校验需要）
□ Supplier + SupplierQualification + SupplierContact 数据完整
□ 至少 2 家供应商满足条件（对比评分需要 ≥2）
□ bidBondAssetId 保证金凭证存在（若需 AI 辅助保证金一致性校验，见 15.12）
```

不满足时，E2E 跑不通，需先补 seed 数据（`apps/api/prisma/seed-data/`）。

### 15.12【B·推荐】投标保证金凭证与 AI 分析的交叉（v4 新增）

`feat/bid-opening-bond-quality` 分支已给 `SupplierBidSubmission` 增加 `bidBondAssetId`（保证金缴纳凭证 → `FileAsset.id`，**程序性文件，不加密**），并由 `bid-bond-status.ts` 的 `isBondQualified` 纯函数 + 人工核对判定保证金状态。本节厘清与 AI 辅助分析的边界。

**定位分工**：

| 职责 | 归属 | 说明 |
|------|------|------|
| 保证金**资格判定**（通过/不通过） | **bond 分支**（`isBondQualified` + 人工核对） | 法律效力，必须人工；AI 不做终判 |
| 保证金凭证**一致性校验** | **AI 一致性引擎**（可选） | 标书声明金额/账户 vs 唱标记录/系统登记，冲突标 warning |
| 保证金凭证 **OCR** | **不做** | `bidBondAssetId` 是程序性凭证（到账截图/回单），非评分依据，OCR 价值低、噪声高 |

**实现要点**：
- `ConcordanceVerifierService` 新增可选检查项 `bondConcordance`：仅在 `SupplierBidSubmission.bidBondAssetId` 存在且 `AiBidderResult` 提取到保证金声明时触发，作为 **warning 级**（不产生 conflict，不影响资格）。
- `AiBidderResult.qualificationStatus` **不得**直接采信保证金状态——保证金资格以 bond 分支的人工核对结果（`BidSupplier` 上的 bond 状态字段）为准，AI 只引用、不覆盖。
- 供应商过滤（15.1）**不**按保证金状态过滤——保证金未达标的供应商按 `72b9ddb` 已定为「软标记写监督日志、不排除」，AI 分析照常处理这些供应商，保证金状态作为风险提示呈现。

**与正式排名隔离**：与 15.3 一致，AI 的保证金一致性结论不流入 `BidEvaluationResult`。

---

## 十六、决策汇总（v4）

| 决策点 | 最终方案 |
|--------|---------|
| 数据源 | 系统结构化（权威）+ 标书 OCR（验证）双源 |
| 一致性校验 | 独立维度，纯算法，String 强制归一化 |
| 评分结构 | 保留 ERP per-item（按 BidScoreItem），数据源规则→LLM+OCR |
| 评分标准 | 管理员填 + AI 推断存 task 快照（不回填 BidScoreItem） |
| 响应性维度 | 复用 procurement starredResponse 映射 RESPONSIVE |
| 报价基准 | 开标唱标 > 表单 > 标书 |
| OCR | **同机复用 procurement :8100（rapid）**，零 Python 部署；扫描件质量后置决策 |
| 保证金凭证（v4） | 资格判定归 bond 分支（人工）；AI 仅做一致性 warning，不做终判；凭证不 OCR |
| 触发时机 | startEvaluation 后（EVALUATING），解密在 OPENING 窗口内 |
| 供应商过滤 | 复用 generateEvaluationResults 过滤（SUCCESS && !已撤回） |
| 明文安全 | 内存流，不落 MinIO |
| AI vs 正式排名 | 技术隔离，AiBidderResult 不流入 BidEvaluationResult |
| 可见性 | 回避屏蔽；串通详情仅管理员可见，专家看摘要 |
| 失败处理 | 部分失败容忍，COMPLETED_WITH_ERRORS 状态 |
| LLM 缓存 | Redis 按 seed 缓存，7 天 |
| 降级 | 规则引擎 analyzeBid 作为 OCR/LLM 不可用时的 fallback |
| 定位 | AI 辅助参考，话术中性化 + 显著声明 |
