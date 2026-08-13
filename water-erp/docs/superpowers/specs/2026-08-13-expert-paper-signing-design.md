# 评标签字包设计（纸质打印 + 手写签字 + 回流归档）

> **日期**: 2026-08-13
> **状态**: 设计已批准，待实施
> **关联文档**: `docs/开评标全流程代码审计报告-2026-08.md`（#43/#44/#55）、`docs/开评标全流程体检报告-2026-07-30.md`（C4 电子签名移出范围）
> **法规依据**: 《评标委员会和评标方法暂行规定》（七部委令第 12 号）第四十二条（评标报告十项内容）、第四十三条（全体成员签字/书面不同意见/拒绝签字且不陈述理由视为同意）；评审专家独立评审行为准则

---

## 1. 背景与目标

**新设计决定**：专家不使用 CA 证书/电子签名（SM2 `SignatureService` 为死代码，体检报告 C4 已决策移出范围）。评标结束后，将评标结果与有关异议等打印为纸质文件，专家**现场手写签字**，扫描回传存档。

**要解决的问题**（审计报告缺口）：
- #43：评标报告内容不符合《暂行规定》第四十二条十项法定要求；
- #44：`confirmReport` 的不同意见仅存监督日志一行——缺书面不同意见结构化存储、拒绝签字记录机制、「拒绝签字且不陈述理由视为同意」逻辑；
- #55：归档不重新校验专家确认与签字闭环。

**目标**：
1. 生成符合法定内容的《评标报告》打印件 + 全套证据附件（签字包）；
2. 线下手写签字 → 扫描回传 → 系统逐专家登记（已签/拒绝附不同意见/视为同意）；
3. 签字闭环成为**完整归档的前置要件**；
4. 签字页附「专家声明」与在线操作留痕，打通「线上账号操作 = 本人亲为」证据链；
5. 签字闭环后 :3007 生成**评标回流包**，线上把开评标数据流转回 :3005。

## 2. 门户分工 v3（2026-08-13 定稿）

**原则**：:3005 与 :3007 是不同的人在不同地方的工作——:3005 是采购中心办公室（leader/staff），:3007 是开评标现场（主持人/admin）。评标过程中的事跟着现场走。

| | :3005 采购管理工作台（办公室） | :3007 开评标管理端（现场） |
|---|---|---|
| **保留** | 项目管理/公告/供应商邀请；供应商投标状态·催促未投递；专家抽取/RSVP/确认/催促/正选候补替换；评分标准编制与发布；监督时间线（只读）；开标进度（下载开标文件包·开标前流标）；底部决策栏（主持人指派·延时开标·**按时开标**）；归档·公示·中标通知书 | 开标任务板 + 开标大厅（已有）；评分标准只读 tab（已有） |
| **从 :3005 迁回** | — | 评标管理（启动评标·专家进度·评分矩阵·排名·3 步生成评标结果向导）；专家异议裁决（含「有效供应商不足→流标」）；澄清答疑（发起/回复/AI 起草/摘要） |
| **新增** | 接收**评标回流包**（「评标资料已接收·下载」）；归档闸门展示（签字进度 + 回流状态） | **评标签字包**模块；**评标回流包**生成 |

**阶段流转归属**：

```
按时开标（:3005，DOWNLOAD/SUBMIT→OPENING）
  → 启动评标（:3007，OPENING→EVALUATING）
  → 生成评标结果（:3007，非阶段流转，stage 保持 EVALUATING）
  → 评标签字包 + 回流包（:3007，非阶段流转）
  → 完整归档（:3005，EVALUATING→ARCHIVED）
流标：开标前 24h 内 → :3005；评标中（异议裁决有效供应商不足）→ :3007
状态机棘轮（bid/bid-state.ts）本身不变；删除公告的裸回滚例外不变。
```

`:3006 专家端` 不变：签到/打分/核对/报告确认/动议/异议提交。

## 3. 流程总览

```
generateEvaluationResults（闸门不变：全体正选确认 + 组长末签 + 无 open 异议 + 轮次关闭）
        │
        ▼
┌─ 签字归档期（stage=EVALUATING，:3007 现场办理）─────────────┐
│ 1. 主持人点击「生成签字包」→ 服务端快照评标数据 → DOCX→PDF   │
│    → MinIO + SHA-256 指纹 → FileAsset                      │
│ 2. 主持人下载 PDF → 打印全套证据包                          │
│ 3. 专家现场逐页手写签字（声明页共签 + 个人评分表各签）        │
│ 4. 工作人员扫描/拍照 → 主持人在 :3007 回传                  │
│ 5. 主持人逐专家登记：已签字 / 拒绝(附不同意见) / 视为同意     │
│ 6. 全体正选专家闭环 → 签字包 closedAt 置位                  │
│ 7. 生成评标回流包（含签字包/扫描件/签字状态）→ 流转回 :3005  │
└───────────────────────────────────────────────────────────┘
        │ 归档闸门（新增）：签字包已生成 + 全员闭环 + 回流已生成
        ▼
archiveAll（:3005 完整归档，7+1 项归档材料 + 哈希链）
```

线上 `reportConfirmed`/`leaderCoSigned` **保留原语义**（实时流程闸门 + 审计留痕），纸质签字是法定要式——线上管流程，线下管法律效力，两者互补。

## 4. 数据模型（schema 变更）

### 4.1 BidExpert 加字段（`apps/api/prisma/schema.prisma:492-537`）

```prisma
enum SignStatus {
  PENDING          // 待签
  SIGNED           // 已签字
  REFUSED_DISSENT  // 拒绝签字·附书面不同意见
  DEEMED_AGREED    // 视为同意（拒绝且未陈述理由）
}

model BidExpert {
  // ……现有字段……
  signStatus         SignStatus  @default(PENDING)
  signStatusAt       DateTime?
  signScanFileId     String?     // 该专家签字页/不同意见书扫描件 → FileAsset
  signRegisteredBy   String?     // 登记人 userId
  // 已有字段本次接线（当前 src 全量 0 处引用）：
  // dissentingOpinion String?    // 不同意见
  // dissentingReason  String?    // 不同意见理由
}
```

### 4.2 新模型 BidSignPacket

```prisma
model BidSignPacket {
  id                  String   @id @default(cuid())
  projectId           String   @unique
  fileAssetId         String   // 签字包 PDF（category=bid_sign_packet）
  sha256              String   // PDF 指纹
  generatedAt         DateTime
  generatedById       String
  signPageScanFileId  String?  // 主报告签字页扫描件（全员共签一页）
  closedAt            DateTime?
  closedById          String?
  project             BidProject @relation(fields: [projectId], references: [id])
}
```

### 4.3 FileAsset.category 新增取值

category 是自由 String（`schema.prisma:1389`），无需迁移：
- `bid_sign_packet` —— 签字包 PDF
- `expert_sign_scan` —— 专家签字页/个人评分表扫描件
- `sign_packet_signature_page` —— 主报告签字页扫描件
- `bid_evaluation_sign_handover` —— 评标回流包 JSON（签字闭环时新生成的独立包；结果生成时的 `bid_evaluation_handover` 快照保持不变）

### 4.4 归档扩展

`ensureArchiveItems`（`bid.service.ts:3718-3747`）从 7 项扩为 **8 项**，新增「评标签字包」（unique `[projectId, name]` 已支持）：签字包 PDF + 签字页扫描 + 各专家扫描件 + 签字状态表；digest 并入哈希链（hashDigest = sha256(签字包 sha256 + 各扫描件 sha256 + 签字状态 JSON)）。

## 5. 签字包文档构成（全套证据包 = 1 + N + M 份）

单份 PDF，按序排版（docx 库程序化生成，参照 `ai-bid-analysis/services/docx-generator.service.ts` 模式 C；`common/office-to-pdf.util.ts:35-75` libreoffice 转 PDF）：

1. **《评标报告》主报告** —— 按《暂行规定》第四十二条十项内容映射：
   - 基本情况和数据表（项目信息/采购方式/时间节点）
   - 评标委员会成员名单（标注组长/采购人代表，`BidExpert.isLead`/`isPurchaserRepresentative`）
   - 开标记录（`BidOpeningRecord` 唱标表 + 供应商确认/异议）
   - 投标一览表（报价/工期承诺）
   - 废标情况说明（`BidInvalidBid` + `bidValidity`）
   - 评标标准、评标方法一览表（评分标准摘要）
   - 经评审的价格或评分比较一览表（`BidEvaluationResult` 汇总排名）
   - 排序结果 + 推荐中标候选人名单（1-3 名，`recommended`）
   - 澄清、说明、补正事项纪要（`BidClarification` 问答）
2. **签字页（全员共签一页）** —— 顶部「评标专家声明」全文（见 5.1），下方全体专家签字栏（姓名/职称/工作单位/签字/日期），每位专家栏含该专家的**在线操作留痕小表**（见 5.2）
3. **个人评分确认表 × N**（每正选专家一张）—— 该专家逐供应商逐项分数 + 得分点裁定（`BidScoreRecord`/pointDecisions）+ 总分 + 在线操作留痕 + 本人确认条款 + 签字栏
4. **异议工单 × M** —— `ExpertDispute` 全文（类型/正文/裁决结果/回复）
5. **澄清纪要** —— 全部 `BidClarification` 记录
6. **动议决议** —— 全部 `BidMotion` + `BidVote` + 决议结果

### 5.1 签字页「评标专家声明」条款（固定文本，签字即确认）

> 本人作为本项目评标委员会成员声明：
> 1. 本人在系统中的身份核验、签到、回避申报、保密承诺、评标纪律承诺均为本人操作，无他人代行；
> 2. 本人对投标人的独立评分、得分点裁定、核对与报告确认均系本人亲为，未受任何单位或个人干预；
> 3. 本人已如实申报与投标人的利害关系，无应回避而未回避情形；
> 4. 本人已履行评标保密义务，未向无关人员泄露评标信息；
> 5. 本人对本人评分及评审意见承担相应责任；
> 6. 对评标结论的不同意见以本人签字栏备注或另附书面材料为准。

### 5.2 在线操作留痕小表（系统自动生成，签字覆盖具体事实）

每专家一行，数据来源（全部现成）：
- 身份核验/签到：`signInIp`/`signInMeta`（BidExpert:530-531）
- 保密/纪律承诺：`confidentialityAgreedAt`/`disciplineAgreedAt`（BidExpert:506-509）
- 评分提交：`BidScoreRecordHistory` 快照时间
- 评分核对：`BidScoreReview.verifiedAt`
- 报告确认：`reportConfirmedAt`
- 组长末签（组长行）：`leaderCoSignedAt`

## 6. 签字登记状态机（:3007 主持人操作）

```
PENDING ──登记──▶ SIGNED（附扫描件）
       ├──────▶ REFUSED_DISSENT（强制填 dissentingOpinion/dissentingReason，可附扫描件）
       └──────▶ DEEMED_AGREED（拒绝且未陈述理由）
```

**《暂行规定》第四十三条语义（服务端强制）**：
- 选「拒绝」必须填不同意见/理由，否则服务端 400 并提示「拒绝签字且不陈述理由的，视为同意评标结论」；
- 「已签字」可同时附书面不同意见（签字与不同意见正交，法条允许）；
- 三种终态均视为**闭环**；由登记端点自动判定——最后一名正选进入终态时服务端自动置位 `BidSignPacket.closedAt` 并写监督日志；
- 登记写监督日志 + `createIntegrityStamp`（`common/crypto/integrity-stamp.ts:8-14`）审计戳；
- 闭环前主持人可撤销重登（unregister，`updateMany where signStatus != PENDING` 原子回退）；闭环后锁定，重开走管理员通道（对齐 `unconfirmReport` 模式，`expert-admin.service.ts:1081-1155`）。

## 7. 后端 API（新增，挂在 bid 模块，:3007 侧调用）

| 端点 | 角色 | 说明 |
|---|---|---|
| `POST /api/bid/projects/:id/sign-packet/generate` | bid_host, admin | 快照当前评标数据 → 生成 PDF → MinIO + 指纹；幂等重生成：覆盖旧包、**重置全员 signStatus=PENDING** 并写监督日志（数据可能已变） |
| `GET /api/bid/projects/:id/sign-packet` | bid_host, admin, leader, staff | 包元信息 + 下载 URL + 指纹 + 每专家签字状态/不同意见/扫描件 |
| `POST /api/bid/projects/:id/sign-packet/experts/:expertId/scan` | bid_host, admin | multipart 上传该专家签字页扫描（jpg/png/pdf ≤10MB，复用 `expert-memo.service.ts:27-111` 墨迹上传链路） |
| `POST /api/bid/projects/:id/sign-packet/signature-page/scan` | bid_host, admin | 主报告签字页扫描（全员共签页） |
| `POST /api/bid/projects/:id/sign-packet/experts/:expertId/register` | bid_host, admin | 登记 `{status, dissent?, reason?}`，服务端强制 §43 语义 |
| `POST /api/bid/projects/:id/sign-packet/experts/:expertId/unregister` | bid_host, admin | 闭环前撤销重登 |

**归档闸门改造**（`archiveAll`，`bid.service.ts:3833-3992`，scope=full）：现有检查之后追加——签字包已生成 + 全体正选 signStatus ∈ 终态 + 回流包已生成；不满足则 409 附明细（谁还没签/缺什么）。流标/废标归档（scope=opening）不受影响。

**并发防护**：generate/register 复用 `lockAndReassertStage` + 事务内 FOR UPDATE 模式（对齐 `completeOpening`/`generateEvaluationResults`）；签字状态更新用 `updateMany({ where: { signStatus: 'PENDING' } })` 原子抢占。

## 8. 评标回流包

签字闭环后，:3007 生成**独立的**评标回流包流转回 :3005（复用开标文件包模式 `completeOpening`，`bid.service.ts:649-766`；category=`bid_evaluation_sign_handover`，与结果生成时的 `bid_evaluation_handover` 快照并存）：
- 在现有 `buildEvaluationPackage`（`bid.service.ts:840-883`，`bid_evaluation_handover`）快照基础上扩展：补齐 ExpertDispute 全文、BidMotion/BidVote、BidClarification、BidSignPacket 元信息 + 扫描件清单 + 逐专家签字状态 + 不同意见文本；
- JSON 包 + SHA-256 指纹存 MinIO，FileAsset 挂项目，幂等（不改 stage、不触发归档）；
- :3005「开标进度」区块展示「评标资料已接收·下载」（对齐开标文件包展示，`opening-progress-block.tsx:140-153`）。

## 9. 前端改动

### 9.1 :3007 工作区（apps/bid-portal）

- **评标管理 tab 只读 → 全操作**：移植 :3005 的 `evaluation-block.tsx`（启动评标/进度/矩阵/排名/3 步生成向导）、`dispute-block.tsx`（异议裁决 + 流标）、`clarifications-block.tsx`（澄清答疑），沿用 cgzxui 风格；原只读 `evaluation-view.tsx` 由全操作版替换（操作版涵盖只读内容）；
- **新增「评标签字」tab**：入口条件 = stage=EVALUATING 且已生成评标结果；「生成签字包」→ PDF 下载 + 指纹复制；专家签字清单（姓名/角色/状态徽标/登记按钮/扫描件预览）；登记弹窗（三态 + 不同意见 textarea + 扫描件上传，拒绝强制填理由）；全员闭环横幅「签字已闭环，:3005 可执行完整归档」；「生成回流包」按钮。

### 9.2 :3005 开标确认面板（apps/web）

- **移除**评标管理/异议裁决/澄清答疑三区块（`bid-confirm-panel.tsx:811-813`），避免双端操作；
- 归档块（`archive-block.tsx`）新增：签字进度与回流状态展示；未闭环时「完整归档」按钮禁用并提示原因（409 明细回显）。

## 10. 边界与例外

- **结果重生成**：`resolveExpertDispute` 裁决废标会删除已生成结果（`bid.service.ts:4217-4224`）→ 已生成的签字包标记失效、强制重新生成，全员 signStatus 重置 PENDING 并通知；
- **候补专家**：不参与签字（闸门只查正选），与报告确认口径一致；
- **ABORTED/流标**：无签字环节；开标归档（scope=opening）不受签字闸门约束；
- **专家改分**：reportConfirmed 锁定已防（`expert.service.ts:1038`）；签字包数据快照天然防篡改；
- **打印降级**：libreoffice 转换失败时提供 DOCX 下载兜底；
- **评标 72h 时限**：评标时限以评标结果生成为止（现有超时仅通知不强制，审计 #39）；签字归档期独立于该时限、无自动超时，由归档闸门天然约束（未闭环则无法归档）；

## 11. 测试与验证

- **单元测试**：签字登记状态机（§43 强制语义、原子抢占、闭环判定）；归档闸门（未闭环 409 明细）；签字包生成（十项内容齐全、留痕表数据正确）；回流包指纹稳定性；
- **E2E**：结果生成 → 生成签字包 → 上传扫描 → 逐专家登记（含拒绝→视为同意路径）→ 闭环 → 回流 → :3005 归档成功；
- **手工验证**：:3007 打印 PDF 版式（中文字体/表格/签字栏）；:3005 归档块联动；种子数据需准备一个 EVALUATING 阶段项目便于演示。

## 12. 实施顺序建议

| 阶段 | 内容 |
|---|---|
| Wave 1 | 后端：schema 迁移（SignStatus/BidSignPacket/归档项）+ 签字包生成服务（docx→PDF）+ 登记/扫描 API + §43 语义 + 归档闸门 + 回流包 |
| Wave 2 | 前端 :3007：评标签字 tab（生成/下载/回传/登记/闭环）；:3005 归档块闸门展示 |
| Wave 3 | 前端迁移：评标管理/异议裁决/澄清答疑 :3005→:3007 全操作化；:3005 面板移除三区块 |
| Wave 4 | 回流包 :3005 展示、E2E、种子数据、文档收尾 |

> **实施注意**：DB 迁移用 `prisma migrate dev --create-only` → `db execute` → `migrate resolve`（勿交互式 migrate dev，见记忆 main-db-migration-drift）。

## 附录：现状事实清单（代码引用）

- 签字链路纯线上：`BidExpert.reportConfirmed`（expert.service.ts:1771-1842 confirmReport）+ `BidProject.leaderCoSigned`（expert.service.ts:2046-2088 leaderCoSign）；无打印/无手写/无拒绝机制；
- `dissentingOpinion`/`dissentingReason` 字段已存在（migration 20260810000100），src 0 处引用——本次接线；
- `generateEvaluationResults` 闸门（bid.service.ts:2938-3330）：阶段/全体确认/末签/无 open 异议(2954-2958，审计#7 已修)/轮次关闭；
- 归档 7 项材料 + 哈希链（bid.service.ts:3718-3992）；审计 #55 归档不校验确认；
- 可复用设施：ExpertMemo 墨迹链路（expert-memo.service.ts:27-111）、开标文件包模式（bid.service.ts:649-837）、`convertOfficeToPdf`、RSVP 签名 token（rsvp-token.util.ts）、`createIntegrityStamp`、OperationLog 全局拦截器；
- 前端：:3005 面板三区块 bid-confirm-panel.tsx:811-813；:3007 evaluation-view.tsx 只读；全仓无打印组件（supplier-portal 有 @media print CSS 可参考）。
