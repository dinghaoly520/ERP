# 招投标完整业务流程 & 测试操作指南

**日期**: 2026-06-16
**状态**: 最新
**种子项目**: `BID-1781599475329` — 2026年度智慧水利调度系统建设项目 (ARCHIVED，数据完整可测)

---

## 流程全景图

整个流程分为 **7 个阶段**，对应状态机 `DOWNLOAD → SUBMIT → OPENING → EVALUATING → ARCHIVED`，涉及 **4 个前端门户 + 1 个 API 后端**。

```
web :3005 (采购管理)             bid-portal :3007 (开评标管理端)      expert-portal :3006 (专家端)     supplier-portal :3004 (供应商端)
┌─────────────────────┐         ┌──────────────────────┐         ┌──────────────────────┐       ┌──────────────────────┐
│ ① 创建招标公告       │         │                      │         │                      │       │                      │
│   BID_NOTICE + 标书  │──发布──→│  自动创建 BidProject  │         │                      │       │                      │
│   status: PUBLISHED │         │  stage: DOWNLOAD     │         │                      │       │  ② 浏览项目+下载标书  │
└─────────────────────┘         │                      │         │                      │       │  ③ 提交投标文件       │
                                │ ④ 开启投递阶段        │         │                      │       │                      │
                         ┌──────│  DOWNLOAD → SUBMIT   │         │                      │       │                      │
                         │      │ ⑤ 抽取专家            │         │                      │       │                      │
                         │      │ ⑥ 设置评分标准        │         │                      │       │                      │
                         │      │ ⑦ 启动开标            │         │                      │       │                      │
                         │      │  SUBMIT → OPENING    │         │                      │       │  ⑧ 确认唱标/提出异议  │
                         │      │ ⑨ 解密投标文件        │         │                      │       │                      │
                         │      │ ⑩ 录入唱标信息        │         │                      │       │                      │
                         │      │ ⑪ 启动评标            │         │                      │       │                      │
                         │      │  OPENING→EVALUATING  │         │  ⑫ 签到 + 回避确认   │       │                      │
                         │      │                      │         │  ⑬ 逐供应商打分      │       │                      │
                         │      │                      │         │  ⑭ 确认评分报告      │       │                      │
                         │      │ ⑮ 生成评标结果排名    │         │                      │       │                      │
                         │      │ ⑯ 归档               │         │                      │       │                      │
                         │      │  EVALUATING→ARCHIVED │         │                      │       │                      │
                         └──────┴──────────────────────┘         └──────────────────────┘       └──────────────────────┘
```

---

## 状态机（不可跳级）

```
DOWNLOAD ──→ SUBMIT ──→ OPENING ──→ EVALUATING ──→ ARCHIVED （终态）
  下载期        投递期       开标中         评标中          已归档
```

- 同阶段重复调用是**幂等**的（不报错）
- 跨阶段跳转会返回 **409 ConflictException**
- 状态机定义文件：`water-erp/apps/api/src/bid/bid-state.ts`

### 各阶段含义

| 阶段 | 中文名称 | 说明 |
|------|----------|------|
| `DOWNLOAD` | 下载期 | 项目已创建，供应商可浏览/下载标书 |
| `SUBMIT` | 投递期 | 开启投标，供应商可提交加密投标文件 |
| `OPENING` | 开标中 | 主持人在线解密、唱标，供应商确认 |
| `EVALUATING` | 评标中 | 专家签到回避、评分、确认报告 |
| `ARCHIVED` | 已归档 | 终态，只读，SHA-256 哈希链防篡改 |

---

## 测试账号速查

> 所有账号密码格式：`<username>@2026`

| 账号 | 角色 | 门户 | 端口 | 用途 |
|------|------|------|------|------|
| `caigou` | procurement_staff | bid-portal | :3007 | 创建公告、管理项目全流程 |
| `lizhuren` | bid_host | bid-portal | :3007 | 主持开标、解密、唱标、归档 |
| `supplier1` | supplier | supplier-portal | :3004 | 下载标书、投标、确认唱标 |
| `supplier2` | supplier | supplier-portal | :3004 | 同上（第二个供应商） |
| `wangjg` | bid_expert | expert-portal | :3006 | 签到、打分、确认报告 |
| `liuxm` | bid_expert | expert-portal | :3006 | 同上 |
| `chenzq` | bid_expert | expert-portal | :3006 | 同上 |

> **注意**：`supplier1` 状态为 `APPROVED`（已入库可直接投标），`supplier2` 状态为 `PENDING`（需先审核通过）。三个专家均属于"XXX水利技术服务中心"，种子数据中供应商名不冲突，回避机制可正常测试。

---

## 各步骤详解 & 测试操作

---

### ① 创建招标公告 + 自动创建 BidProject

**操作人**：`caigou`（采购管理员）
**前端**：bid-portal `http://localhost:3007/bid` 或 web `http://localhost:3005/notice`
**API**：`POST /api/announcements`

**操作步骤**：

1. 登录 bid-portal → 进入公告管理（或通过 web notice 页面）
2. 新建公告，类型选 **「招标公示」**（`BID_NOTICE`）
3. 填写标题、正文、结构化 metadata：
   - 招标方式（`method`）
   - 开标时间（`openTime`）
   - 报名/投标截止时间（`deadline`）
   - 预算金额（`budget`）
   - 采购内容/范围（`scope`）
   - 投标人资格要求（`qualification`）
   - 联系方式（`contact`）
4. **先保存草稿**（status=`DRAFT`）—— 此时不会创建 BidProject
5. 上传加密招标文件（可选）：`POST /api/announcements/:id/bid-document`
6. 点击 **「发布」**（status → `PUBLISHED`）

**后端自动联动**（`announcement.service.ts` update 方法）：

| 条件 | 动作 |
|------|------|
| `type === 'BID_NOTICE'` 且状态变为 `PUBLISHED` | 触发联动 |
| `relatedProjectCode` 已关联有效项目 | 调用 `bidService.syncFromAnnouncement()` 同步更新字段 |
| `relatedProjectCode` 无关联或关联失效 | 调用 `bidService.createFromAnnouncement()` 创建新项目 |
| 存在 BidDocument | 自动挂载到新项目的 `bidProjectId` |
| 联动失败 | 不阻塞发布，记录错误日志 |

**字段映射**：

| BidProject 字段 | 来源 | 缺省值 |
|---|---|---|
| `name` | `Announcement.title` | —（必填） |
| `projectCode` | `BID-{Date.now()}` | —（自动生成） |
| `procurementMethod` | `metadata.method` | `'公开招标'` |
| `openTime` | `metadata.openTime` | `publishDate` |
| `deadline` | `metadata.deadline` | `openTime + 7天` |
| `budget` | `metadata.budget` | `null` |
| `scope` | `metadata.scope` | `null` |
| `qualification` | `metadata.qualification` | `null` |
| `contact` | `metadata.contact` | `null` |
| `riskNote` | 固定值 | `'（来自公告自动创建）'` |
| `stage` | 固定值 | `DOWNLOAD` |

**验证**：bid-portal 项目列表出现新项目，stage=`DOWNLOAD`，来源列显示 **「来自公告」**

---

### ② 供应商浏览项目 + 下载标书

**操作人**：`supplier1` / `supplier2`
**前端**：supplier-portal `http://localhost:3004`
**API**：`GET /api/supplier-portal/bid-projects`

**操作步骤**：

1. 登录 supplier-portal → 进入 **招标项目列表**
2. 点击项目 → 查看项目详情（含答疑澄清）
3. 查看招标文件访问状态：`GET /supplier-portal/bid-projects/:id/bid-document`
4. 支付标书费用：`POST /supplier-portal/bid-documents/:announcementId/pay`
5. 下载标书：`GET /supplier-portal/bid-documents/:announcementId/download`
   - 标书用 AES-256-GCM 加密存储，下载时服务端解密后返回

**注意**：`supplier2` 状态为 `PENDING`（待审核），需要先在 web 管理端审核通过才能投标。

---

### ③ 供应商提交投标文件

**操作人**：`supplier1` / `supplier2`
**前端**：supplier-portal 投标提交页 `BidSubmit.vue`
**API**：`POST /api/supplier-portal/bid-submissions/:projectId/submit`

**前置条件**：
- supplier 状态必须为 `APPROVED`
- 项目 stage 必须为 `SUBMIT`（主持人已开启投递阶段，见步骤④）
- 投标截止时间未过

**操作步骤**：

1. 准备投标文件（技术文件、商务文件、报价函）→ 上传到文件服务
2. 先保存草稿：`POST /supplier-portal/bid-submissions/:projectId/draft`

   请求体：
   ```json
   {
     "bidPrice": 1500000,
     "deliveryPeriod": "90天",
     "technicalFileAssetId": "clx...",
     "businessFileAssetId": "cly...",
     "coverLetterAssetId": "clz..."
   }
   ```

3. 提交投标：`POST /supplier-portal/bid-submissions/:projectId/submit`

**提交时后端校验**：

| 校验项 | 不通过时 |
|--------|----------|
| supplier 状态 = `APPROVED` | 返回错误 |
| 项目 stage = `SUBMIT` | 返回错误 |
| 截止时间未过 | 返回错误 |
| 未重复提交 | 返回错误 |

**提交成功后自动创建/更新**：

| 记录 | 字段 |
|------|------|
| `SupplierBidSubmission` | `bidPrice`, `deliveryPeriod`, 文件关联, `status='submitted'`, `submittedAt` |
| `BidSupplier` | `submitStatus='submitted'`, `encryptStatus='ciphertext verified'`, `receiptNo='TB-YYYYMMDD-NNN'`（自动生成回执号） |

---

### ④ 开启投递阶段

**操作人**：`lizhuren`（开标主持人）
**前端**：bid-portal 项目列表页
**API**：`POST /api/bid/projects/:id/open-submission`

**操作**：项目创建后默认在 `DOWNLOAD` 阶段，供应商只能浏览不能提交。主持人需要手动推进：

1. 在项目列表找到项目
2. 点击「开启投递」或直接调用 API
3. 状态推进：`DOWNLOAD → SUBMIT`

> **时机**：应在步骤①之后、步骤③之前执行。确保供应商能提交投标。

---

### ⑤ 抽取专家

**操作人**：`lizhuren` 或 `caigou`
**前端**：web :3005 专家管理 → 专家抽取 `/expert/extract`，或直接调用 API
**API**：`POST /api/expert-admin/extract` → `POST /api/expert-admin/extract/confirm`

**操作步骤**：

1. **预览抽取**：`POST /api/expert-admin/extract`

   请求体：
   ```json
   {
     "projectId": "cmqbysdhu000bkoh1u8ikgv08",
     "totalNeeded": 5,
     "alternatives": 2
   }
   ```

2. 系统自动完成：
   - 筛选 `isActive: true` 且 `availability: usable` 的专家
   - 排除已分配给该项目的专家
   - **冲突回避**：专家 `employer`（去掉"有限公司"/"Ltd"等后缀后）与项目供应商 `supplierName` 匹配时自动排除
   - 按专业（specialty）分组
   - 用 **DeepSeek AI**（可用时）或**规则引擎**（fallback）评分排名
   - 规则引擎权重：职称等级 > 历史参评项目数 > 历史平均分

3. 审查预览结果：
   - 按专业分组的入选专家（正选）
   - 备选专家列表
   - 各专业短缺提示

4. **确认抽取**：`POST /api/expert-admin/extract/confirm` → 正式创建 `BidExpert` 记录（upsert on `[projectId, userId]`）

**种子数据**：当前有 65+ 生成专家 + 3 个 demo 专家（wangjg/liuxm/chenzq），13 个专业方向。

---

### ⑥ 设置评分标准

**操作人**：`lizhuren`
**前端**：bid-portal → 评分标准页 `/bid/standard`
**API**：`POST /api/bid/projects/:id/score-items/template`

**操作步骤**：

1. 进入评分标准页面
2. 应用标准模板：`POST /api/bid/projects/:id/score-items/template`

   自动创建 5 个类别的评分项：

   | 类别 | 中文 | 默认满分 |
   |------|------|----------|
   | `QUALIFICATION` | 资质 | 0 |
   | `RESPONSIVE` | 符合性 | 0 |
   | `BUSINESS` | 商务 | 20 |
   | `TECHNICAL` | 技术 | 50 |
   | `PRICE` | 价格 | 30 |

3. 可手动调整各评分项的名称和满分值（`PATCH /api/bid/projects/:id/score-items/:itemId`）

> ⚠️ **锁定规则**：评分标准在 `SUBMIT`、`OPENING` 阶段可编辑，进入 `EVALUATING` 或 `ARCHIVED` 后**锁定不可编辑**（返回 409）。

---

### ⑦ 启动开标

**操作人**：`lizhuren`
**前端**：bid-portal 开标页面 `/bid/open`
**API**：`POST /api/bid/projects/:id/open`

**操作步骤**：

1. 在项目列表或开标页面点击「启动开标」
2. 填写开标参数：

   ```json
   {
     "host": "李主任",
     "supervisor": "监督员A",
     "decryptWindowStart": "2026-06-16T09:00:00Z",
     "decryptWindowEnd": "2026-06-16T09:30:00Z"
   }
   ```

3. 提交后：
   - 状态推进：`SUBMIT → OPENING`
   - 创建 `BidOpeningSession`（含解密窗口倒计时）
   - 前端显示实时倒计时环

---

### ⑧⑨⑩ 开标核心流程：解密 → 唱标 → 供应商确认

**操作人**：`lizhuren`（主持）+ `supplier1`/`supplier2`（确认）
**前端**：bid-portal 开标页面 `/bid/open` + supplier-portal 唱标确认页
**涉及 API**：

| 步骤 | API | 说明 |
|------|-----|------|
| 启动开标 | `POST /api/bid/projects/:id/open` | SUBMIT → OPENING，创建 BidOpeningSession |
| 解密投标 | `POST /api/bid/projects/:id/decrypt/:supplierId` | AES-GCM + SHA-256 完整性校验 |
| 录入唱标 | `POST /api/bid/projects/:id/opening-records` | 金额/工期/质量/保证金 |
| 供应商确认 | `POST /api/supplier-portal/bid-submissions/:projectId/opening-confirm` | 确认唱标内容 |
| 供应商异议 | `POST /api/supplier-portal/bid-submissions/:projectId/opening-dispute` | 提出异议 |
| 主持人处理异议 | `POST /api/bid/projects/:id/opening-records/:recordId/resolve-dispute` | 裁决 |

**完整操作流程**：

#### 8-1. 解密投标文件

调用 `POST /api/bid/projects/:id/decrypt/:supplierId` 对每个供应商逐一解密：

1. 设置 `decryptStatus: 'RUNNING'`
2. 找到 `SupplierBidSubmission` 的技术文件、商务文件、报价函
3. 对每个文件：
   - 从 MinIO 读取加密文件
   - 使用 AES-256-GCM 解密
   - 验证 SHA-256 哈希值与 `FileAsset.sha256` 是否一致
4. 结果：
   - 全部通过 → `decryptStatus: 'SUCCESS'`
   - 任一失败 → `decryptStatus: 'DANGER'`

> 解密页面支持：批量解密、单独解密、实时进度条、音效提示、大屏模式、键盘快捷键（D=解密，B=批量，M=大屏，S=音效）

#### 8-2. 录入唱标信息

对解密成功的供应商，录入唱标信息：
```json
{
  "bidSupplierId": "...",
  "amount": 1500000,
  "period": "90天",
  "qualityTarget": "合格",
  "bondStatus": "已缴纳"
}
```

#### 8-3. 供应商确认唱标

供应商登录 supplier-portal → 查看唱标记录：
- 确认：`POST /supplier-portal/bid-submissions/:projectId/opening-confirm` → `confirmStatus: 'CONFIRMED'`
- 异议：`POST /supplier-portal/bid-submissions/:projectId/opening-dispute` → `confirmStatus: 'DISPUTED'`

#### 8-4. 主持人处理异议（如有）

调用 `POST /api/bid/projects/:id/opening-records/:recordId/resolve-dispute`，裁决结果 confirm/reject。

---

### ⑪ 启动评标

**操作人**：`lizhuren`
**前端**：bid-portal 评标页面 `/bid/evaluate`
**API**：`POST /api/bid/projects/:id/start-evaluation`

**操作**：状态推进 `OPENING → EVALUATING`

**前置条件**：
- 所有供应商已完成解密且唱标确认（无待处理的异议）
- 评分标准已设置
- 专家已抽取分配

---

### ⑫ 专家签到

**操作人**：`wangjg` / `liuxm` / `chenzq`（每个专家各自操作）
**前端**：expert-portal `http://localhost:3006`
**API**：`POST /api/expert/projects/:projectId/sign-in`

1. 登录 expert-portal → 进入「我的项目」
2. 点击项目 → 点击「签到」
3. 设置 `signedIn: true`
4. WebSocket 广播在线状态（bid-portal 评标页面实时显示签到状态）

---

### ⑬ 专家回避确认

**操作人**：同上，每个专家各自操作
**API**：`POST /api/expert/projects/:projectId/avoidance`

**操作步骤**：

1. 点击「回避确认」
2. 系统**自动检测冲突**：
   - 将专家 `employer`（规范化：去"有限公司"/"Co"/"Ltd"等后缀）
   - 与项目下所有供应商的 `supplierName`（同样规范化）比对
   - 匹配的供应商自动标记为回避对象
3. 专家可额外**手动声明**回避供应商
4. 确认后 `avoidanceConfirmed: true`，`conflictedSupplierIds` 存储回避供应商列表

> **种子数据中的回避**：三个 demo 专家（wangjg/liuxm/chenzq）雇主为"XXX水利技术服务中心"，种子项目供应商为"四川水发建设有限公司"和"成都水利工程有限公司"，雇主名与供应商名不冲突（"水利技术服务中心" ≠ "水发建设"或"水利工程"），因此回避通常为空。如需测试回避，可手动声明回避某个供应商。

---

### ⑭ 专家打分

**操作人**：同上，每个专家各自操作
**前端**：expert-portal 评分页面
**API**：`POST /api/expert/projects/:projectId/scores`

**操作步骤**：

1. 进入项目评分页面
2. 选择供应商 → 逐项打分

   请求体：
   ```json
   {
     "scores": [
       {
         "supplierId": "...",
         "scoreItemId": "...",
         "score": 18,
         "reason": "商务资质齐全，业绩良好",
         "supplierName": "四川水发建设有限公司"
       }
     ]
   }
   ```

**打分校验**：

| 校验项 | 不通过时 |
|--------|----------|
| 专家必须属于该项目 | 返回错误 |
| `signedIn` 和 `avoidanceConfirmed` 均为 true | 返回错误 |
| 不能对 `conflictedSupplierIds` 中的供应商打分 | 返回错误 |
| 项目 stage === `EVALUATING` | 返回错误 |
| 分数不超过 `maxScore` | 返回错误 |
| 供应商 `decryptStatus === 'SUCCESS'` 且未撤标 | 返回错误 |

**进度计算**：每打一次分自动重算：
```
progress = 已打分项数 / (评分项数 × 有效供应商数) × 100
```

**AI 辅助分析**（可选）：`GET /api/expert/projects/:projectId/assist/:supplierId` 对标书进行 AI 智能分析。

---

### ⑮ 专家确认评分报告

**操作人**：同上，每个专家各自操作
**API**：`POST /api/expert/projects/:projectId/report/confirm`

**操作步骤**：

1. 确认所有供应商所有评分项已打分完毕（`progress >= 100`）
2. 点击「确认评分报告」
3. 设置 `reportConfirmed: true`，`reportConfirmedAt: now`

> ⚠️ **阻塞条件**：如果 `progress < 100`（有未打分的供应商或评分项），确认操作被拒绝。

---

### ⑯ 生成评标结果排名

**操作人**：`lizhuren`
**前端**：bid-portal 评标页面 `/bid/evaluate`
**API**：`POST /api/bid/projects/:id/evaluation-results/generate`

**前置条件（全部必须满足，否则 409）**：

| 条件 | 检查方式 |
|------|----------|
| 项目 stage = `EVALUATING` | 状态机检查 |
| 所有专家 `reportConfirmed = true` | 遍历 `BidExpert` |
| 不存在已解密但未确认的供应商 | 检查 `BidSupplier.confirmStatus` |

**操作步骤**：

1. 在评标页面确认所有专家已完成评分（状态卡片全部绿色）
2. 点击「生成评标结果」
3. 进入 3 步向导：
   - **Step 1**：确认所有专家已确认报告
   - **Step 2**：异常分数审查（偏离平均值 >20% 的评分项高亮标记）
   - **Step 3**：确认生成
4. 系统计算：
   - 每个供应商的总分 = 所有专家对该供应商的分数之和
   - 每个供应商的平均分 = 总分 / 专家数
   - 按平均分降序排名
   - **第一名标记为 `recommended: true`**（中标候选人）
5. 写入 `BidEvaluationResult` 表

---

### ⑰ 归档

**操作人**：`lizhuren`
**前端**：bid-portal 归档页 `/bid/archive`
**API**：`POST /api/bid/projects/:id/archive-all`

**操作步骤**：

1. 进入归档页面
2. 点击「归档全部」
3. 系统自动生成 7 项归档内容：

   | 归档项 | 内容 |
   |--------|------|
   | 项目信息 | 项目基本信息快照 |
   | 供应商列表 | 所有参与供应商 |
   | 开标记录 | BidOpeningRecord 全部记录 |
   | 确认记录 | 供应商唱标确认/异议记录 |
   | 评分明细 | 所有专家所有评分记录 |
   | 评标汇总 | 排名结果 + 中标候选人 |
   | 监督日志 | BidSupervisionLog 全程审计轨迹 |

4. 计算 **SHA-256 哈希链**（防篡改）
5. 事务性更新：所有归档项标记为 `ARCHIVED`，项目 stage → `ARCHIVED`

**阻塞条件**：如果存在解密成功的供应商但未生成评标结果，归档被阻塞（409）。

> ⚠️ `ARCHIVED` 是**终态**，不可逆。

---

## 完整测试流程速查

```
步骤  阶段                操作人         门户:端口          关键API
────────────────────────────────────────────────────────────────────────
   启动环境               —              —                 pnpm infra:up && pnpm db:seed
   启动服务               —              —                 pnpm dev:api / dev:bid / dev:supplier / dev:expert
────────────────────────────────────────────────────────────────────────
 ①   创建公告+项目         caigou         web :3005          POST /api/announcements
     上传标书                            bid :3007          POST /announcements/:id/bid-document
────────────────────────────────────────────────────────────────────────
 ④   DOWNLOAD → SUBMIT    lizhuren       bid :3007          POST /api/bid/projects/:id/open-submission
────────────────────────────────────────────────────────────────────────
 ②   供应商浏览下载         supplier1/2    supplier :3004     GET /api/supplier-portal/bid-projects
 ③   供应商提交投标         supplier1/2    supplier :3004     POST /supplier-portal/bid-submissions/:projectId/submit
────────────────────────────────────────────────────────────────────────
 ⑤   抽取专家              lizhuren       web :3005          POST /api/expert-admin/extract
                                                                → /extract/confirm
────────────────────────────────────────────────────────────────────────
 ⑥   设置评分标准           lizhuren       bid :3007          POST /api/bid/projects/:id/score-items/template
────────────────────────────────────────────────────────────────────────
 ⑦   SUBMIT → OPENING     lizhuren       bid :3007          POST /api/bid/projects/:id/open
 ⑨   解密投标              lizhuren       bid :3007          POST /bid/projects/:id/decrypt/:supplierId
 ⑩   录入唱标              lizhuren       bid :3007          POST /bid/projects/:id/opening-records
────────────────────────────────────────────────────────────────────────
 ⑧   供应商确认唱标         supplier1/2    supplier :3004     POST /supplier-portal/bid-submissions/:projectId/opening-confirm
────────────────────────────────────────────────────────────────────────
 ⑪   OPENING → EVALUATING lizhuren       bid :3007          POST /api/bid/projects/:id/start-evaluation
────────────────────────────────────────────────────────────────────────
 ⑫   专家签到              wangjg         expert :3006       POST /api/expert/projects/:projectId/sign-in
 ⑬   回避确认              wangjg         expert :3006       POST /api/expert/projects/:projectId/avoidance
 ⑭   逐供应商打分           wangjg         expert :3006       POST /api/expert/projects/:projectId/scores
 ⑮   确认评分报告           wangjg         expert :3006       POST /api/expert/projects/:projectId/report/confirm
     (liuxm、chenzq 同样操作 ⑫⑬⑭⑮)
────────────────────────────────────────────────────────────────────────
 ⑯   生成排名              lizhuren       bid :3007          POST /api/bid/projects/:id/evaluation-results/generate
────────────────────────────────────────────────────────────────────────
 ⑰   EVALUATING→ARCHIVED lizhuren       bid :3007          POST /api/bid/projects/:id/archive-all
```

---

## 快速测试：从种子项目 BID-1781599475329 开始

种子数据中已有完整项目 `BID-1781599475329`（`ARCHIVED`），包含全部真实数据：

| 表 | 行数 | 说明 |
|---|------|------|
| BidProject | 1 | 智慧水利调度系统建设项目，含 budget/scope/qualification/contact |
| BidSupplier | 2 | 四川川水 + 成都华西，均有 supplierId 关联 |
| SupplierBidSubmission | 2 | 真实投标提交，含加密文件和回执号 |
| BidExpert | 3 | 王某国/刘某梅/陈某强，progress=100, reportConfirmed=true |
| BidScoreItem | 5 | 5 类评分标准 |
| BidScoreRecord | 30 | 3 专家 × 2 供应商 × 5 评分项 |
| BidOpeningSession | 1 | 完整开标会话 |
| BidOpeningRecord | 2 | 两个供应商的唱标记录（均已确认） |
| BidSupervisionLog | 27 | 完整审计轨迹 |
| BidEvaluationResult | 2 | 排名结果：成都华西第一（推荐中标） |
| BidArchiveItem | 7 | SHA-256 哈希链归档 |

由于项目已是 `ARCHIVED`（终态），如需测试中间步骤，需要创建新项目走完整流程（见上文 ①-⑰ 步骤）。

**验证连接性**：
1. `lizhuren` 登录 bid-portal → 项目列表可见：`BID-1781599475329`
2. `supplier1` 登录 supplier-portal → 查看投标提交：报价 4,200,000 元
3. `wangjg` 登录 expert-portal → 查看已确认的评分报告

---

## 启动测试环境

```bash
# 1. 启动基础设施
cd water-erp
pnpm infra:up          # PostgreSQL :5432 / Redis :6380 / MinIO :9000

# 2. 重置数据库
pnpm db:seed           # 清空 + 导入种子数据

# 3. 分终端启动服务
pnpm dev:api           # API :4001
pnpm dev:bid           # 开评标管理端 :3007
pnpm dev:supplier      # 供应商门户 :3004
pnpm dev:expert        # 专家门户 :3006
pnpm dev:web           # 采购管理端 :3005（如需创建公告）
```

---

## 关键约束和边界条件

| 约束 | 说明 |
|------|------|
| **状态机不可跳级** | 严格按 DOWNLOAD→SUBMIT→OPENING→EVALUATING→ARCHIVED 顺序，跳级返回 409 |
| **同阶段幂等** | 重复调用同阶段转换不报错 |
| **供应商必须已入库** | `supplier.status === 'APPROVED'` 才能投标 |
| **供应商必须在 SUBMIT 阶段投标** | DOWNLOAD 阶段只能浏览下载，SUBMIT 阶段才能提交 |
| **回避机制** | 专家雇主名与供应商名匹配时自动回避，回避的供应商不可被该专家打分 |
| **所有专家确认后才能生成排名** | 任一专家未 `reportConfirmed`，排名生成被阻塞（409） |
| **归档前必须生成评标结果** | 已解密确认的供应商无评标结果时，归档被阻塞（409） |
| **评分标准锁定** | EVALUATING 阶段后评分标准不可修改（409） |
| **公告删除不解绑项目** | 删除公告仅在 BidProject 的 `riskNote` 追加标记 + 解除标书挂载，项目本身保留 |
| **加密标书** | 招标文件存 MinIO 时用 AES-256-GCM 加密，密钥存 BidDocument.decryptKey |
| **加密投标文件** | 供应商上传的投标文件也是加密存储，开标时解密并做 SHA-256 完整性校验 |
| **projectCode 自动生成** | 格式 `BID-{Date.now()}`，公告 metadata 中填写的 projectCode 不被使用 |

---

## 关键文件索引

| 领域 | 文件 | 说明 |
|------|------|------|
| **数据模型** | `apps/api/prisma/schema.prisma` | 全部表结构 |
| **状态机** | `apps/api/src/bid/bid-state.ts` | 阶段转换规则 |
| **Bid 服务** | `apps/api/src/bid/bid.service.ts` | 核心业务逻辑 |
| **Bid 控制器** | `apps/api/src/bid/bid.controller.ts` | API 路由 |
| **公告联动** | `apps/api/src/announcement/announcement.service.ts` | 发布→创建项目联动 |
| **公告控制器** | `apps/api/src/announcement/announcement.controller.ts` | 公告 API |
| **标书服务** | `apps/api/src/announcement/bid-document.service.ts` | 加密标书上传/下载 |
| **供应商门户服务** | `apps/api/src/supplier-portal/supplier-portal.service.ts` | 投标/唱标确认 |
| **供应商门户控制器** | `apps/api/src/supplier-portal/supplier-portal.controller.ts` | 供应商 API |
| **专家服务** | `apps/api/src/expert/expert.service.ts` | 签到/打分/报告 |
| **专家控制器** | `apps/api/src/expert/expert.controller.ts` | 专家端 API |
| **专家管理** | `apps/api/src/expert/expert-admin.controller.ts` | 专家抽取/管理 API |
| **专家管理服务** | `apps/api/src/expert/expert-admin.service.ts` | 抽取逻辑 |
| **冲突检测** | `apps/api/src/expert/expert-conflict.service.ts` | 专家-供应商回避 |
| **种子数据** | `apps/api/prisma/seed.ts` | 数据初始化 |
| **共享常量** | `packages/shared/src/constants.ts` | 阶段标签/颜色 |
| **共享类型** | `packages/shared/src/types.ts` | BidProject 等类型定义 |
| **开评标端主页** | `apps/bid-portal/src/app/(dashboard)/bid/page.tsx` | 项目列表 |
| **开评标端开标页** | `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx` | 解密/唱标 |
| **开评标端评标页** | `apps/bid-portal/src/app/(dashboard)/bid/evaluate/page.tsx` | 评标管理 |
| **开评标端评分标准** | `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx` | 评分项管理 |
| **开评标端归档页** | `apps/bid-portal/src/app/(dashboard)/bid/archive/page.tsx` | 归档管理 |
| **供应商投标页** | `apps/supplier-portal/src/views/bid/BidSubmit.vue` | 投标提交 |
| **供应商唱标确认** | `apps/supplier-portal/src/views/bid/OpeningConfirm.vue` | 唱标确认/异议 |
| **专家评分页** | `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` | 专家评分界面 |
