# 引大济岷钻孔项目真实评审数据 + AI 评分要点提取 — 设计 spec

- 日期：2026-07-21
- 状态：draft（待用户复核）
- 关联：[[score-standard-template-flow]]、[[ai-bid-migration-status]]、[[expert-scoring-phases-status]]

## 1. 背景与目标

用一份真实招标文件（引大济岷工程千隧 ZK10/ZK12 钻孔施工技术服务）+ 三份真实投标文件，在 `water-erp` 系统中创建一个真实可评审的招标项目，推进到专家评审（EVALUATING）阶段。

核心诉求：**真实跑通 AI 评分要点提取**（`ScorePointExtractorService`），让「资格性审查」与「符合性（响应性）审查」产出详细的、源自招标文件文本的审查检查项。

## 2. 现状（系统已有能力，已核实）

- **AI 提取链路现成**：`POST /api/bid/projects/:id/score-items/:itemId/points/extract` → `ScorePointExtractorService.extractScorePoints(projectId, itemId)`。流程：读项目招标文件（`BidProject → Announcement(type=BID_NOTICE,status=PUBLISHED,relatedProjectCode) → BidDocument → FileAsset`，AES-256-GCM 解密）→ 正则/embedding 定位「评标办法」章节 → DeepSeek 提取得分点 → 去重 + fullScore 归一化。**PRICE 类自动跳过**。
- **评分模型 5 类**（`enum ScoreCategory`）：QUALIFICATION(资格) / RESPONSIVE(响应) / BUSINESS(商务) / TECHNICAL(技术) / PRICE(价格)。其中 QUALIFICATION/RESPONSIVE 为 pass/fail（`score-standard-validator.ts` 的 `PASS_FAIL_CATEGORIES` 强制 `maxScore=0`），BUSINESS/TECHNICAL/PRICE 为打分类。
- **推 EVALUATING 的硬前置**（`bid.service.ts#startEvaluation`，第 553 行）：从 OPENING 转来 + ≥1 个 BidExpert + ≥1 个 `decryptStatus=SUCCESS` 的 BidSupplier + `assertScoreStandardComplete`（打分类 Σ maxScore=100，每个打分类 score item ≥1 得分点）。
- **cmqhero 英雄项目**（`BID-2026-HERO1`，EVALUATING）有完整招标文件入库链路（`seed.ts#ensureTenderFiles`）可照搬代码模式。
- **seed 主流程破坏性**（`TRUNCATE ... CASCADE` 全部 73 张业务表），不能用于增量加项目。
- 阴红宇（`userId=c826709c602085d0d94cc2a`，role=bid_expert）当前不在任何 `BidExpert` 记录中。
- 三家投标单位真实名称：成都华建地质工程科技有限公司、四川省第十二地质大队、四川省第四地质大队。

## 3. 输入文件

| 文件 | 角色 | 大小 | 说明 |
|---|---|---|---|
| `2026.1.27…采购文件.docx` | 招标文件 | 89KB | 含：第三章一、资格审查要求表（6 大项）+ 符合性审查要求表（9 项）+ 六、综合评分法评标标准（**本项目实际 ☑最低评标价法**）+ 第四章采购需求（★商务/技术要求） |
| `…（成都华建地质工程科技有限公司).pdf` | 投标 1 | 51MB | 超 50MB upload cap，脚本直插 MinIO 绕过 |
| `…（四川省第十二地质大队）.pdf` | 投标 2 | 28MB | |
| `…-四川省第四地质大队.pdf` | 投标 3 | 45MB | |

## 4. 方案概要

一个幂等的 Prisma 脚本 `apps/api/prisma/scripts/seed-yindajimin.ts`（TS，`tsx` 或编译后 `node` 跑），**非破坏性**（不动现有 3 个项目），**幂等**（已存在则 upsert/跳过，按 projectCode/BID-2026-YDJM1 判定）。脚本分两阶段：

- **阶段 A（纯数据 + 文件入库）**：Prisma + MinIO + 加密，建全部结构化数据，4 份文件入库。
- **阶段 B（真实跑 AI 提取）**：bootstrap Nest `ApplicationContext`（复用 `AppModule`），拿到 `ScorePointExtractorService`，对每个非 PRICE score item 真实调 `extractScorePoints`，把返回的 `ScorePointSuggestion[]` 落库为 `BidScorePoint`。

脚本末尾置 `stage=EVALUATING` + 写 `BidSupervisionLog`。脚本**不并入 seed 主流程**，单独运行。

## 5. 新建数据清单（按外键依赖序）

### 5.1 基础主体

- `User`(role=`supplier`, passwordHash=bcrypt(`<name>@2026`)) ×3 + `Supplier`(status=`APPROVED`, normalizedName 唯一) ×3：
  - 成都华建地质工程科技有限公司
  - 四川省第十二地质大队
  - 四川省第四地质大队
- `BidProject`：
  - name=`引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务`
  - procurementMethod=`内部竞标（竞价）`
  - projectCode=`BID-2026-YDJM1`
  - openTime/deadline：取近期（如 openTime=2026-07-25 10:00、deadline=2026-07-24 09:00）
  - qualification=招标文件「本项目特定资格要求」文本（独立法人 + 工程钻探劳务资质/地勘红名单 + 近 5 年 ≥2 项 500m+ 钻孔业绩）
  - scope=项目概况（千池山隧洞 ZK10/ZK12 两个斜钻孔）
  - contact、budget：从招标文件提取；不确定则 budget 留 null
  - stage 初值=`DOWNLOAD`（5.8 改 EVALUATING）

### 5.2 公告 + 招标文件

- `Announcement`：type=`BID_NOTICE`（枚举默认）、status=`PUBLISHED`、relatedProjectCode=`BID-2026-YDJM1`、publishDate=now、title=项目名、content=采购邀请正文摘要、authorId=任一 procurement_staff 用户。
- 招标文件入库（照搬 `ensureTenderFiles` 模式，5 步）：
  1. `libreoffice --headless --convert-to pdf --outdir /tmp <docx>` 转 PDF。
  2. `FileAsset`：key=`yindajimin/tender.pdf`（唯一）、originalName、mimeType=`application/pdf`、size、sha256、category=`tender`、sealedPath=`yindajimin/tender.pdf`。
  3. `const { ciphertext, decryptKey } = encryptBuffer(plaintext)`（`announcement/bid-document.crypto`）。
  4. `minioClient.putObject(MINIO_BUCKET, key, ciphertext)` 上传密文。
  5. `BidDocument`：announcementId、fileAssetId、title=`招标文件`、accessScope=`OPEN`、decryptKey=`wrapKey(decryptKey, KMS_SECRET)`（`common/crypto/envelope-crypto`）；回填 `FileAsset.sha256`（明文 sha）、size。

### 5.3 投标供应商 + 投标文件

每家（共 3 家）：

- `BidSupplier`：projectId、supplierId（关联 5.1 Supplier）、supplierName、downloadStatus=`已下载`、submitStatus=`已提交`、encryptStatus=`校验通过`、decryptStatus=`SUCCESS`、confirmStatus=`CONFIRMED`。
- 投标 PDF 入库（hero `ensureBidFiles` 同款明文兼容模式）：
  - `FileAsset`：key=`yindajimin/bid-<n>.pdf`、sealedPath 同 key、sha256、size、category=`bid`、mimeType=`application/pdf`。
  - `minioClient.putObject(MINIO_BUCKET, sealedPath, 明文)` —— **明文存储**。
  - `SupplierBidSubmission`：supplierId、projectId、technicalFileAssetId=该 FileAsset、businessFileAssetId=**同一 FileAsset**（一份投标书含商务+技术）、technicalSealedKey/businessSealedKey=**null**（明文兼容，`fetchBidderPlaintext` 直读）、status=`submitted`、submittedAt=now、bidPrice=null（评审价由专家打分时定，不在入库阶段提取）。

### 5.4 开标 session

- `BidOpeningSession`：projectId（unique）、host=`李主任`、supervisor=`周老师`、status=`已开标`、decryptWindowStart/End（近期窗口）。

### 5.5 评分项

`BidScoreItem` ×5（projectId 关联）：

| category | name | maxScore | 说明 |
|---|---|---|---|
| QUALIFICATION | 资格性审查 | 0 | pass/fail |
| RESPONSIVE | 符合性审查 | 0 | pass/fail |
| BUSINESS | 商务评分 | 20 | 打分 |
| TECHNICAL | 技术评分 | 30 | 打分 |
| PRICE | 价格评分 | 50 | 打分，权重最高呼应最低价法 |

打分类 Σ = 20+30+50 = 100 ✅。

### 5.6 AI 提取得分点（阶段 B，真实跑 DeepSeek）

bootstrap Nest `ApplicationContext` → `app.get(ScorePointExtractorService)`：

- 对 **QUALIFICATION** 调 `extractScorePoints` → 预期 ~6 项资格审查检查项（营业执照等证明文件、供应商资格声明书、独立法人资格、工程钻探劳务资质/地勘红名单、近 5 年 ≥2 项 500m+ 钻孔业绩、联合体协议）→ 落库 `BidScorePoint`（fullScore=0、objective=true）。
- 对 **RESPONSIVE** 调 → 预期 ~9 项符合性检查项（授权委托书、响应保证金、响应完整性、报价不超最高限价、报价唯一性、响应有效期、实质性格式、★号条款响应、报价合理性）→ 落库。
- 对 **BUSINESS** 调 → 从第四章商务要求提取 → 落库（Σ fullScore ≤ 20）。
- 对 **TECHNICAL** 调 → 从第四章技术要求提取 → 落库（Σ fullScore ≤ 30）。
- **PRICE** 不调（extractor 自动返回 `[]`）；手动建 1 个 `BidScorePoint`（name=`评审价`、fullScore=50、evidenceHint=`最低价法：评审价得分`）。
- 落库：`extractScorePoints` 返回 `ScorePointSuggestion[]` → 逐条 `prisma.bidScorePoint.create({ data: { scoreItemId, name, fullScore, evidenceHint, objective, seq } })`。
- 提取成功后将对应 `BidScoreItem.criteriaSource` 置 `ai_inferred`（QUALIFICATION/RESPONSIVE/BUSINESS/TECHNICAL 四类）。

### 5.7 评审专家

`BidExpert` ×6（@@unique([projectId, userId])，专家可跨项目）：

- 复用 cmqhero 班底 5 名：周祥志、黃凯、陈英、范鸿烨、覃克非（脚本里 `user.findFirst({ where: { username } })` 查 userId）。
- 加 **阴红宇**（userId=`c826709c602085d0d94cc2a`，`isLead=true` —— 呼应她评审此项目）。
- 其余字段：invitationStatus=`pending`、signedIn=true、major 从 ExpertProfile 取（无则 `通用`）。

### 5.8 阶段推进

脚本末尾，在全部前置满足后（6 专家、3 解密成功供应商、打分类 Σ=100 + 每项 ≥1 得分点）：

- `prisma.bidProject.update({ where: { projectCode: 'BID-2026-YDJM1' }, data: { stage: 'EVALUATING' } })`。
- 写 `BidSupervisionLog`（OPENING→EVALUATING，action=`启动评标`）。
- 建占位 `AiBidAnalysisTask`（upsert projectId，status=PENDING）—— 不入队 worker，仅满足读侧一致性。

**不逐级调 `start-evaluation` API**：前置严格、要走完整开标流程；直置 stage 数据自洽，且已满足 `startEvaluation` 全部校验条件。

## 6. 验证标准

1. `BidScorePoint` 分布：资格 ≥3、响应 ≥5、商务 ≥1、技术 ≥1、价格 =1；evidenceHint 非空；4 类 `BidScoreItem.criteriaSource=ai_inferred`。
2. `BidProject.stage = EVALUATING`。
3. 专家门户用 `阴红宇` / `expert@2026` 登录，能在项目列表看到该项目。
4. bid-portal 评分标准页（`/bid/project/[id]`）可见 5 类 + 各类得分点。
5. `fetchTenderPlaintext` 能解密读出招标文件文本（阶段 B 提取成功即间接证明）。

## 7. 风险与前置

- `.env` `DEEPSEEK_API_KEY` 有效：否则 `extractScorePoints` 降级返回 `[]`，资格/响应要点落空。**回退**：手动落库招标文件已知审查项（5.6 已列清单）。
- `KMS_SECRET` 已配：招标文件加密必需，缺失会运行时抛错。
- OCR 微服务 `:8100` 起着（`pnpm dev:ocr`）：`processFile` 解析投标 PDF 需要；招标 docx→pdf 含文本层，OCR 非必需但有助于表格识别。
- 51MB PDF：脚本直插 MinIO 绕过 50MB upload cap ✅；OCR 慢、工程图纸扫描页可能识别不全（已接受）。
- `libreoffice` headless 可用（已确认 `/usr/bin/libreoffice`）。
- DeepSeek 调用成本/延迟：4 次 extract 调用，可接受。

## 8. 不做（YAGNI）

- 不改 seed 主流程、不动现有 3 个项目数据。
- 不逐级走真实开标 WebSocket 流程（脚本直置 stage）。
- 不跑 AI 辅助投标分析 worker（`tender.processor`/`bidder.processor`）—— 本次聚焦评分要点提取；`AiBidAnalysisTask` 仅建占位。
- 不改 `score-standard-validator` 的 pass/fail 设计。
- 不实现供应商端真实投递/解密闭环（脚本直造 `decryptStatus=SUCCESS`）。
- 投标文件 `sealedKey` 留空（明文兼容模式），不做完整 SM2 签名。

## 9. 实现要点（供 plan 落地）

- 脚本入口：`apps/api/prisma/scripts/seed-yindajimin.ts`，用 `NestFactory.createApplicationContext(AppModule)` 拿 `ScorePointExtractorService` + `PrismaService`。
- import 复用 `seed.ts` 同款：`minioClient, MINIO_BUCKET`（`src/upload/minio.client`）、`encryptBuffer`（`src/announcement/bid-document.crypto`）、`wrapKey`（`src/common/crypto/envelope-crypto`）。
- 幂等：开头上 `const existing = bidProject.findUnique({ where: { projectCode } })`；存在则 `console.log` 跳过阶段 A（或按子步骤 upsert），阶段 B 仍可重跑覆盖得分点（先 delete 该项目 BidScorePoint 再重新提取）。
- libreoffice 转换：`execSync('libreoffice --headless --convert-to pdf --outdir /tmp <docx>')`，失败则中止并提示。
