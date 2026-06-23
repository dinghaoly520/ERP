# Procurement AI-Bid-Analysis → ERP Expert 辅助评标 移植方案

> 将 `/home/asus/桌面/procurement` 项目的 `ai-bid-analysis` 模块移植到 `/home/asus/桌面/ERP` 项目的专家端辅助评标功能

---

## 一、现状对比

### ERP 项目已有什么

| 能力 | 现状 |
|------|------|
| **招标文件存储** | `BidDocument` 模型 — 公告发布时上传加密招标文件（AES-256-GCM），存储在 MinIO |
| **投标文件存储** | `SupplierBidSubmission` 模型 — 供应商提交加密投标文件（技术/商务/投标函），关联 `FileAsset` |
| **开标解密** | `POST /bid/projects/:id/decrypt/:supplierId` — 管理员逐个解密供应商投标，使用信封加密（envelope-crypto） |
| **评标阶段** | `BidStage` 状态机: `DOWNLOAD → SUBMIT → OPENING → EVALUATING → ARCHIVED` |
| **评分体系** | `BidScoreItem` (评分项) + `BidScoreRecord` (评分记录)，5 个 ScoreCategory |
| **专家工作流** | 5 步: 身份核验 → 标书获取 → **辅助评标** → 专家打分 → 评审报告 |
| **辅助评标 API** | `GET /expert/projects/:projectId/assist/:supplierId` → 调用 `AiService.analyzeBid()` |
| **当前 AI 引擎** | **基于规则的模拟引擎**（模拟数据，非真实文件分析） |

### Procurement 项目有什么（需要移植的）

| 能力 | 实现 |
|------|------|
| **文件 OCR** | Python OCR 服务 (RapidOCR) + mammoth (DOCX) |
| **招标需求提取** | DeepSeek LLM 从招标文件提取资质/技术/商务要求 |
| **投标信息提取** | DeepSeek LLM 从投标文件提取 20+ 维度结构化信息 |
| **三维 LLM 评分** | 技术(50分) + 商务(30分) + 报价(20分) |
| **串通检测** | 6 维度纯算法检测（报价离散度/规律性/联系方式/文档相似度/结构相似度/元数据） |
| **横向对比评分** | 所有投标单位 LLM 横向对比，第二轮打分 |
| **队列系统** | BullMQ 三级队列 + 独立 Worker 进程 |
| **DOCX 报告** | Word 文档导出 |

---

## 二、数据模型扩展

### 新增表（在 ERP `schema.prisma` 中新增）

```prisma
// ── AI 辅助评标任务（每个 BidProject 进入 EVALUATING 时自动创建）──
model AiBidAnalysisTask {
  id             String            @id @default(cuid())
  projectId      String            @unique  // 关联 BidProject
  status         AiAnalysisTaskStatus @default(PENDING)
  tenderText     String?           // 招标文件 OCR 文本
  tenderPages    Json?             // 招标文件分页
  requirements   Json?             // LLM 提取的招标要求（资质/技术/商务）
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  completedAt    DateTime?

  project        BidProject        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  bidderResults  AiBidderResult[]  // 每个供应商的分析结果
  report         AiBidReport?

  @@map("ai_bid_analysis_tasks")
}

// ── 投标单位分析结果（每个 BidSupplier 对应一条）──
model AiBidderResult {
  id                  String        @id @default(cuid())
  taskId              String
  supplierId          String        // 关联 BidSupplier（ERP 中的投标供应商）
  status              AiBidderStatus @default(PENDING)
  text                String?       // 投标文件 OCR 文本
  pages               Json?         // 分页信息
  extractedInfo       Json?         // LLM 提取的完整信息
  keyInfo             Json?         // 前端展示的关键信息摘要
  scores              Json?         // 三维度评分
  totalScore          Decimal?      @db.Decimal(5, 2)
  qualificationStatus String?       @default("pending")
  riskLevel           String?       @default("low")
  riskAnalysis        Json?
  strengths           Json?
  weaknesses          Json?
  overallComment      String?
  deviationAnalysis   Json?
  competitiveAnalysis Json?
  processedAt         DateTime?

  task   AiBidAnalysisTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  supplier BidSupplier     @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@unique([taskId, supplierId])
  @@map("ai_bidder_results")
}

// ── AI 分析报告 ──
model AiBidReport {
  id                String            @id @default(cuid())
  taskId            String            @unique
  summary           Json?
  ranking           Json?             // 投标单位综合排名
  keyInfoComparison Json?             // 关键信息对比矩阵
  priceAnalysis     Json?             // 报价分析汇总
  strengthsWeaknesses Json?
  riskStats         Json?
  highRiskDetails   Json?
  fraudIndicators   Json?
  reviewSuggestions Json?
  conclusion        String?
  recommendation    Json?
  docxFileId        String?           // 导出的 DOCX 文件（MinIO key）
  generatedAt       DateTime?

  task AiBidAnalysisTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@map("ai_bid_reports")
}

// ── 枚举 ──
enum AiAnalysisTaskStatus {
  PENDING           // 等待开始
  TENDER_PROCESSING // 招标文件 OCR + LLM 提取中
  ANALYZING         // 投标文件分析中
  COMPLETED
  FAILED
  CANCELLED
}

enum AiBidderStatus {
  PENDING
  OCR_PROCESSING
  OCR_COMPLETED
  EXTRACTING
  EXTRACTED
  SCORING
  SCORED
  DEVIATION_ANALYZING
  COMPLETED
  FAILED
}
```

### 最小改动方案（不新增独立表，扩展现有表）

如果不想新增太多表，可以扩展现有模型：

```prisma
// BidProject 增加字段
model BidProject {
  // ... 现有字段
  aiAnalysisStatus    AiAnalysisTaskStatus?  // AI 分析状态
  aiTenderText        String?                 // 招标文件 OCR 文本
  aiRequirements      Json?                   // 提取的招标要求
}

// BidSupplier 增加字段
model BidSupplier {
  // ... 现有字段
  aiBidderStatus      AiBidderStatus?         // AI 分析状态
  aiExtractedText     String?                 // 投标文件 OCR 文本
  aiExtractedInfo     Json?                   // LLM 提取信息
  aiKeyInfo           Json?                   // 关键信息摘要
  aiScores            Json?                   // 评分
  aiTotalScore        Decimal? @db.Decimal(5,2)
  aiRiskLevel         String?
  aiRiskAnalysis      Json?
  aiStrengths         Json?
  aiWeaknesses        Json?
  aiOverallComment    String?
}

// BidExpert 增加字段（专家看到的分析结果按供应商缓存）
model BidExpert {
  // ... 现有字段
  aiAssistDataCache   Json?   // 该专家查看的辅助评标数据缓存
}
```

**推荐使用独立表方案**：隔离 AI 分析数据，不影响现有业务表结构，方便独立维护和清理。

---

## 三、招标文件自动获取

### 3.1 数据来源（ERP 已有）

```
Announcement (BID_NOTICE, PUBLISHED)
  └── BidDocument (加密招标文件, MinIO)
        ├── accessScope: OPEN / DESIGNATED / INVITED
        ├── encryptKey: AES-256-GCM 密钥（信封加密包装）
        └── FileAsset → MinIO 中的加密文件
```

### 3.2 获取时机与流程

```
触发点: BidService.startEvaluation() 执行时
         (BidProject stage: OPENING → EVALUATING)

流程:
┌─────────────────────────────────────────────────────────────┐
│ startEvaluation(projectId)                                  │
│   ↓                                                         │
│ 1. assertBidStageTransition('OPENING', 'EVALUATING')        │
│ 2. 更新 project.stage = EVALUATING                          │
│ 3. 查找关联的招标文件:                                       │
│    SELECT * FROM BidDocument                                │
│    JOIN Announcement ON BidDocument.announcementId          │
│    WHERE Announcement.relatedProjectCode = project.projectCode│
│      AND Announcement.status = 'PUBLISHED'                  │
│      AND Announcement.type = 'BID_NOTICE'                   │
│   ↓                                                         │
│ 4. 解密招标文件（使用 KMS 信封解密 decryptKey）              │
│    decryptKey = unwrapKey(bidDocument.decryptKey, KMS_SECRET)│
│    plaintext = decryptBuffer(ciphertext, decryptKey)        │
│   ↓                                                         │
│ 5. 创建 AiBidAnalysisTask:                                   │
│    ┌─ taskId = cuid()                                       │
│    ├─ projectId = project.id                                │
│    ├─ status = PENDING                                      │
│    └─ tenderText = null (待 OCR)                            │
│   ↓                                                         │
│ 6. 入队 Tender 处理 (BullMQ):                               │
│    tenderQueue.add('process', { taskId, fileBuffer: plaintext })│
│   ↓                                                         │
│ 7. 返回（不阻塞，队列异步处理）                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 补充文件获取

如果招标公告有多个附件（`AnnouncementAttachment`），也可以作为补充文件：

```typescript
// 在 BidService.startEvaluation() 中
const attachments = await this.prisma.announcementAttachment.findMany({
  where: { announcementId: announcement.id },
  include: { fileAsset: true },
});

// 每个附件的原文（非加密，直接下载）
for (const attachment of attachments) {
  const buffer = await minioClient.getObject(MINIO_BUCKET, attachment.fileAsset.key);
  // 作为补充招标文件传入 TenderExtractor
}
```

---

## 四、投标文件自动获取

### 4.1 数据来源（ERP 已有）

```
SupplierBidSubmission (供应商提交的加密投标文件)
  ├── technicalFileAssetId → FileAsset → MinIO (技术文件)
  ├── businessFileAssetId  → FileAsset → MinIO (商务文件)
  ├── coverLetterAssetId   → FileAsset → MinIO (投标函)
  ├── technicalSealedKey   → AES-256-GCM 密钥（信封加密）
  ├── businessSealedKey    → AES-256-GCM 密钥
  └── coverLetterSealedKey → AES-256-GCM 密钥
```

### 4.2 获取时机与流程

关键设计：**开标解密完成后，自动触发 AI 分析**。

```
触发点: BidService.decryptSupplier() 中，当所有供应商解密完成时

流程:
┌─────────────────────────────────────────────────────────────┐
│ decryptSupplier(projectId, supplierId)                      │
│   ↓                                                         │
│ 1. 现有解密逻辑: decryptBuffer + 验证签名                     │
│   ↓                                                         │
│ 2. 检查是否所有供应商都已解密:                                │
│    const pending = await prisma.bidSupplier.count({         │
│      where: { projectId, decryptStatus: 'PENDING' }         │
│    });                                                      │
│    if (pending > 0) return; // 还有未解密的                  │
│   ↓                                                         │
│ 3. 检查是否已进入 EVALUATING 阶段:                            │
│    if (project.stage !== 'EVALUATING') {                    │
│      // 尚未启动评标，标记待处理                              │
│      return;                                                │
│    }                                                        │
│   ↓                                                         │
│ 4. 获取所有已解密的投标文件:                                  │
│    for (supplier of project.suppliers) {                    │
│      const submission = await prisma.supplierBidSubmission  │
│        .findUnique({ where: { supplierId_projectId } });    │
│                                                             │
│      // 获取解密后的原文                                      │
│      const technicalBuf = submission.technicalSealedKey     │
│        ? await getDecryptedFile(submission.technicalFileAssetId,│
│                                 submission.technicalSealedKey) │
│        : null;                                              │
│      const businessBuf = submission.businessSealedKey       │
│        ? await getDecryptedFile(submission.businessFileAssetId,│
│                                 submission.businessSealedKey)  │
│        : null;                                              │
│      // 合并技术+商务文件为完整投标文件                        │
│      const combinedBuffer = mergeBuffers(technicalBuf, businessBuf);│
│                                                             │
│      // 存入 AI 分析用的临时 MinIO 位置                        │
│      const aiFileKey = `ai-input/${taskId}/${supplier.id}.pdf`;│
│      await minioClient.putObject(..., combinedBuffer);      │
│                                                             │
│      // 入队 Bidder 处理                                      │
│      await bidderQueue.add('process', {                     │
│        bidderResultId: result.id,                           │
│        taskId,                                              │
│        fileKey: aiFileKey,                                  │
│      });                                                    │
│    }                                                        │
│   ↓                                                         │
│ 5. 更新任务状态: AiAnalysisTask.status = ANALYZING           │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 前置解密的优化考虑

ERP 目前是**管理员逐个手动解密**。可以考虑：

| 方案 | 描述 | 适合场景 |
|------|------|---------|
| **A. 按需解密** | 管理员在开标大厅点击"解密"按钮逐个解密 → 最后一个解密完成时触发 AI 分析 | 保留现有交互，改动最小 |
| **B. 一键解密** | 新增 `POST /bid/projects/:id/decrypt-all` 批量解密所有供应商 → 直接触发 AI 分析 | 简化操作，推荐 |
| **C. 自动解密** | `startEvaluation()` 执行时自动解密所有已提交的供应商文件 | 流程最自动化 |

**推荐方案 B（一键解密）**作为主要入口，保留方案 A 的单个解密兼容。

```typescript
// BidService 新增方法
async decryptAllSuppliers(projectId: string, userId: string) {
  const project = await this.prisma.bidProject.findUnique({
    where: { id: projectId },
    include: { suppliers: true },
  });

  // 批量解密
  const results = [];
  for (const supplier of project.suppliers) {
    try {
      const result = await this.decryptSupplier(projectId, supplier.id, undefined, userId);
      results.push({ supplierId: supplier.id, name: supplier.supplierName, result });
    } catch (e) {
      results.push({ supplierId: supplier.id, name: supplier.supplierName, error: e.message });
    }
  }

  // 全部解密完成后，启动 AI 分析
  await this.startAiAnalysis(projectId);

  return { results };
}
```

---

## 五、队列与 Worker 系统移植

### 5.1 最小移植策略

可以**暂时不使用 BullMQ**，直接在 HTTP 请求中同步处理（ERP 项目目前没有 Redis 队列基础设施）：

```typescript
// 同步版本（适用于供应商数量 ≤ 5 的情况）
async startAiAnalysis(projectId: string) {
  // Step 1: 招标文件 OCR + LLM 提取
  const task = await this.createTask(projectId);
  const tenderText = await this.ocrService.processPdf(tenderFileBuffer);
  const requirements = await this.tenderExtractor.extract(tenderText);

  // Step 2: 逐个处理投标单位
  for (const supplier of suppliers) {
    const text = await this.ocrService.processPdf(supplierFileBuffer);
    const { keyInfo, extractedInfo } = await this.bidderExtractor.extract(text, supplier.name);
    const [tech, comm, price] = await Promise.all([
      this.technicalScorer.score(extractedInfo, requirements),
      this.commercialScorer.score(extractedInfo, requirements),
      this.priceAnalyzer.analyze(extractedInfo, requirements),
    ]);
    // 保存结果...
  }

  // Step 3: 横向对比评分
  await this.comparativeScoring.score(taskId);

  // Step 4: 串通检测
  const fraudResult = await this.fraudDetector.detect(bidders);
}
```

### 5.2 异步队列版本（推荐，与 procurement 一致）

```typescript
// 在 BidService.startEvaluation() 中
async startEvaluation(projectId: string, userId: string) {
  // ... 现有逻辑 ...
  await this.startAiAnalysisAsync(projectId);
}

async startAiAnalysisAsync(projectId: string) {
  // 创建分析任务
  const task = await this.prisma.aiBidAnalysisTask.create({
    data: { projectId, status: 'PENDING' },
  });

  // 获取招标文件
  const bidDoc = await this.findBidDocument(projectId);
  const plaintext = await this.decryptBidDocument(bidDoc);

  // 暂存解密后的招标文件到 MinIO
  const tenderKey = `ai-tender/${task.id}/${bidDoc.fileAsset.originalName}`;
  await minioClient.putObject(MINIO_BUCKET, tenderKey, plaintext);

  // 入队招标文件处理
  await this.tenderQueue.add('process', { taskId: task.id, fileKey: tenderKey }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}
```

### 5.3 新增基础设施

需要在 ERP 项目中新增：

```bash
# docker-compose.yml 中 Redis 已有 (localhost:6380→6379)
# 不需要新增外部服务

# 新增 Worker 启动命令
pnpm dev:worker:ai          # 启动 AI 分析 Worker
pnpm start:worker:ai        # 生产模式

# 如果 OCR 功能需要，新增
pnpm dev:ocr                # 启动 Python OCR 服务
```

---

## 六、分析结果发布到专家页面

### 6.1 现有 API 改造

当前专家端 `GET /expert/projects/:projectId/assist/:supplierId` 调用 `AiService.analyzeBid()` 返回基于规则的模拟数据。

**改造方案**：让这个端点从 `AiBidderResult` 表读取真实的 AI 分析结果。

```typescript
// ExpertService.getAssistData() — 改造后
async getAssistData(userId: string, projectId: string, supplierId: string) {
  // 1. 权限验证（专家是否分配到此项目）
  const expert = await this.prisma.bidExpert.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (!expert || !expert.signedIn) {
    throw new ForbiddenException('请先完成身份核验');
  }

  // 2. 从 AiBidderResult 读取真实分析结果
  const task = await this.prisma.aiBidAnalysisTask.findUnique({
    where: { projectId },
    include: {
      bidderResults: {
        where: { supplierId },
      },
      report: true,
    },
  });

  // 3. 如果 AI 分析尚未完成，返回降级数据
  if (!task || task.status !== 'COMPLETED') {
    return this.getAssistDataFallback(userId, projectId, supplierId);
  }

  const result = task.bidderResults[0];
  if (!result) throw new NotFoundException('该供应商暂无分析数据');

  // 4. 格式化为前端 AssistData 格式
  return {
    supplierName: result.supplier.supplierName,
    generatedAt: result.processedAt?.toISOString(),
    model: 'WaterERP-AI v3.0 (DeepSeek + OCR Engine)',
    overall: {
      score: Number(result.totalScore),
      level: this.mapScoreToLevel(result.totalScore),
      breakdown: {
        compliance: { weight: 30, score: Math.round(Number(result.totalScore) * 0.3) },
        risk: { weight: 30, score: Math.round(Number(result.totalScore) * 0.3) },
        scoring: { weight: 40, score: Math.round(Number(result.totalScore) * 0.4) },
      },
    },
    complianceCheck: this.formatCompliance(result),
    riskAnalysis: this.formatRiskAnalysis(result),
    scoreSuggestion: this.formatScoreSuggestion(result),
    keyPoints: this.formatKeyPoints(result),
    // procurement 项目新增的维度
    fraudIndicators: task.report?.fraudIndicators,
    comparativeRanking: task.report?.ranking,
    priceAnalysis: task.report?.priceAnalysis,
  };
}
```

### 6.2 WebSocket 实时推送

ERP 已有 `BidGateway` (Socket.IO)，可复用推送分析进度：

```typescript
// 在 BidderProcessor 完成后
this.gateway.server.to(`project:${projectId}`).emit('ai:bidder:completed', {
  supplierId: bidder.supplierId,
  supplierName: bidder.supplier.supplierName,
  totalScore: bidder.totalScore,
});

// 全部完成时
this.gateway.server.to(`project:${projectId}`).emit('ai:analysis:completed', {
  projectId,
  ranking: report.ranking,
});
```

---

## 七、前端展示方案

### 7.1 方案对比

| 维度 | 方案 A: 复用 Procurement 前端 | 方案 B: 增强现有 ERP 专家端 |
|------|------------------------------|---------------------------|
| **改动量** | 大量：需要集成新的页面路由、组件库、样式系统 | 中等：在现有 evaluate 页面扩展 assist step |
| **一致性** | 差：两个项目技术栈不同（procurement 用独立 UI，ERP 用玻璃态设计系统） | 好：使用 ERP 现有设计系统 |
| **用户体验** | 需要跳转到独立页面，割裂 | 在 5 步工作流内自然展开 |
| **维护成本** | 高：两套 UI 需要分别维护 | 低：统一在 ERP 项目内 |
| **功能完整度** | 高：procurement 的 5 阶段工作台功能完整 | 需要逐阶段实现 |

### 7.2 推荐方案：增强现有专家端（方案 B）

在专家端 `evaluate/[id]/page.tsx` 的 Step 3（辅助评标）中增强展示：

```
┌─────────────────────────────────────────────────────────────────┐
│  辅助评标 (Step 3)                                    [AI Engine] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ 供应商选择器 ─────────────────────────────────────────────┐  │
│  │ ○ 四川水发建设  ○ 中科院成都信息  ○ 四川省通信产业       │  │
│  │   [已完成] 92.5   [已完成] 88.3   [分析中...]             │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ AI 分析 Tab ─────────────────────────────────────────────┐  │
│  │ [关键信息] [符合性] [风险分析] [评分建议] [串通检测]       │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │                                                              │  │
│  │  ┌─ 关键信息对比 ───────────────────────────────────────┐  │  │
│  │  │ 维度        │ 四川水发建设     │ 中科院成都信息      │  │  │
│  │  │ 报价        │ 2,350万元        │ 2,180万元           │  │  │
│  │  │ 资质        │ 甲级             │ 甲级                │  │  │
│  │  │ 业绩        │ 12项             │ 18项                │  │  │
│  │  │ 项目经理    │ 张工 (高工)      │ 李工 (教高)         │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │  ┌─ 评分雷达图 ─────────────────────────────────────────┐  │  │
│  │  │              技术 (42/50)                             │  │  │
│  │  │                  ◆                                   │  │  │
│  │  │    商务(25/30)   ◆   ◆   价格(18/20)                 │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │  ┌─ ⚠ 串通检测结果 ────────────────────────────────────┐  │  │
│  │  │ 🔴 高风险: 报价离散度 5.2% (异常集中)                │  │  │
│  │  │ 🟡 中风险: 文档相似度 72% (四川水发 ↔ 中科院)        │  │  │
│  │  │ 建议进一步核实报价依据和文件编制独立性                 │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [上一步: 标书获取]                              [下一步: 专家打分] │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 前端组件树（新增和修改的文件）

```
apps/expert-portal/src/
├── app/(app)/evaluate/[id]/
│   └── page.tsx                          # 修改: 增强 assist step
├── components/evaluate/
│   ├── assist/                           # 新增目录
│   │   ├── assist-supplier-selector.tsx  # 供应商切换器（含状态徽章）
│   │   ├── assist-key-info-table.tsx     # 关键信息对比表格
│   │   ├── assist-score-radar.tsx        # 评分雷达图（SVG手绘）
│   │   ├── assist-compliance-list.tsx    # 符合性检查结果列表
│   │   ├── assist-risk-panel.tsx         # 风险分析面板
│   │   ├── assist-fraud-panel.tsx        # 串通检测面板（新增）
│   │   ├── assist-comparative-ranking.tsx # 横向对比排名（新增）
│   │   └── assist-loading-skeleton.tsx   # 分析中骨架屏
│   └── scoring-step.tsx                  # 已有的评分组件
├── hooks/
│   └── use-assist-data.ts               # 新增: 辅助评标数据 Hook（含轮询）
└── lib/
    ├── api.ts                            # 修改: 新增辅助评标接口
    └── types.ts                          # 修改: 扩展 AssistData 类型
```

### 7.4 关键组件实现要点

**assist-supplier-selector.tsx** — 供应商状态指示:
```tsx
interface SupplierAssistStatus {
  supplierId: string;
  supplierName: string;
  aiStatus: 'pending' | 'processing' | 'completed' | 'failed';
  totalScore?: number;
  progress?: number;  // 0-100
}
```

**use-assist-data.ts** — 数据获取 + 轮询:
```typescript
function useAssistData(projectId: string, supplierId: string) {
  // 1. 初始加载 GET /expert/projects/:projectId/assist/:supplierId
  // 2. 如果 aiStatus 为 processing，每 3 秒轮询
  // 3. WebSocket 监听 ai:bidder:completed 事件
  // 4. 返回 { data, loading, error, progress }
}
```

### 7.5 API 端点新增

```
GET  /expert/projects/:projectId/assist/status    # 获取所有供应商分析状态
GET  /expert/projects/:projectId/assist/:supplierId # 已有，改造返回真实数据
GET  /expert/projects/:projectId/assist/compare    # 新增：横向对比数据
GET  /expert/projects/:projectId/assist/fraud      # 新增：串通检测结果
GET  /expert/projects/:projectId/assist/report     # 新增：综合报告
POST /expert/projects/:projectId/assist/report/export  # 新增：导出 DOCX
```

---

## 八、移植步骤（分阶段）

### Phase 1: 基础设施（1-2 天）

```
□ 1.1 复制 ai-bid-analysis 模块到 ERP apps/api/src/
       cp -r procurement/apps/api/src/ai-bid-analysis → ERP/water-erp/apps/api/src/
□ 1.2 复制 local-ai 模块（LlmService, OcrService, EmbeddingService）
       cp -r procurement/apps/api/src/local-ai → ERP/water-erp/apps/api/src/
□ 1.3 修改 ERPs .env 增加 DeepSeek 配置
       DEEPSEEK_API_KEY=xxx
       DEEPSEEK_BASE_URL=https://api.deepseek.com
       OCR_SERVICE_URL=http://localhost:8100
□ 1.4 在 AiBidAnalysisModule 中替换 StorageModule 为 ERP 的 Upload/MinIO 模块
□ 1.5 在 AiBidAnalysisModule 中替换 PrismaService 为 ERP 的 PrismaService
□ 1.6 新增 Prisma 迁移（新增 AiBidAnalysisTask 等表）
       npx prisma migrate dev --name add_ai_bid_analysis
```

### Phase 2: 数据流集成（2-3 天）

```
□ 2.1 BidService.startEvaluation() 中增加自动创建 AiBidAnalysisTask
□ 2.2 实现从 BidDocument 自动解密获取招标文件
□ 2.3 实现从 SupplierBidSubmission 自动解密获取投标文件
□ 2.4 实现解密全部供应商后自动触发 AI 分析
□ 2.5 改造 ExpertService.getAssistData() 从 AiBidderResult 读取数据
□ 2.6 新增 GET /expert/projects/:projectId/assist/status 端点
□ 2.7 新增 GET /expert/projects/:projectId/assist/compare 端点
□ 2.8 新增 GET /expert/projects/:projectId/assist/fraud 端点
```

### Phase 3: 队列系统（1-2 天）

```
□ 3.1 在 ERP docker-compose.yml 确认 Redis 可用（已有）
□ 3.2 新增 ai-bid-analysis-worker.ts（独立 Worker 进程）
□ 3.3 新增 ai-bid-analysis-worker.module.ts
□ 3.4 添加 package.json scripts: dev:worker:ai, start:worker:ai
□ 3.5 测试队列流程完整性
```

### Phase 4: 前端增强（3-4 天）

```
□ 4.1 扩展 AssistData 类型定义（lib/types.ts）
□ 4.2 新增 assist/ 组件目录和所有子组件
□ 4.3 实现 useAssistData Hook（含轮询 + WebSocket）
□ 4.4 改造 evaluate/[id]/page.tsx Step 3
□ 4.5 实现供应商选择器（含分析状态徽章）
□ 4.6 实现关键信息对比表格
□ 4.7 实现评分雷达图（SVG）
□ 4.8 实现符合性检查列表
□ 4.9 实现风险分析面板
□ 4.10 实现串通检测面板
□ 4.11 实现横向对比排名
□ 4.12 实现分析中骨架屏/Loading 状态
```

### Phase 5: 测试与优化（2-3 天）

```
□ 5.1 编写 AiBidAnalysisService 单元测试
□ 5.2 编写 ExpertService.getAssistData() 集成测试
□ 5.3 E2E 测试: 公告发布 → 供应商投标 → 开标解密 → AI 分析 → 专家查看
□ 5.4 性能测试: 10 个供应商 × 50MB 投标文件的处理时间
□ 5.5 错误处理: OCR 失败、LLM 超时、文件损坏等场景
```

---

## 九、关键决策点

| 决策点 | 推荐 | 理由 |
|--------|------|------|
| 数据模型 | **独立表** | 隔离分析数据，不影响现有业务表 |
| 招标文件获取 | **BidDocument 自动解密** | ERP 已有完善的加密存储和 KMS |
| 投标文件获取 | **一键解密 + 自动触发** | 批量操作 + 减少管理员步骤 |
| 处理方式 | **BullMQ 异步队列** | 与 procurement 一致，不阻塞 HTTP |
| OCR 服务 | **复用 Python OCR** | RapidOCR 成熟，已有运维经验 |
| LLM 调用 | **复用 LlmService** | 直接复制，改动最小 |
| 前端方案 | **增强现有专家端** | 设计一致性，5 步工作流内展开 |
| 串通检测 | **完整移植** | 纯算法，零 API 成本 |

---

## 十、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **LLM 费用过高** | 每个投标单位约 4-5 次 API 调用（提取+3评分+竞争分析），累计费用 | 1) 确定性种子缓存 2) 温度=0减少重复 3) 可配置跳过 LLM 评分 |
| **OCR 处理大文件缓慢** | 200 页 PDF 可能需要数分钟 | 1) Worker 并发=2 2) 200 页上限 3) 优先使用 DOCX（mammoth直接提取） |
| **解密后的明文文件安全** | 临时 MinIO 存储可能泄露 | 1) 分析完成后立即删除临时文件 2) 使用带 TTL 的 presigned URL |
| **前端展示信息过载** | 新增维度多，专家难以消化 | 1) Tab 分组收纳 2) 高风险项红色高亮 3) 默认展示摘要，点击展开详情 |
| **与现有评分体系的冲突** | AI 评分 vs 专家评分的权重分配 | 1) AI 评分作为「建议」而非「最终结果」2) 专家评分保持主导地位 3) AI 水平对比仅作为参考 |
