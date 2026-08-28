# P0 整改设计：A-143 澄清在线答复（电子签名） + A-153 评标报告监督推送适配层

- **日期**：2026-08-28
- **依据**：《电子招标投标系统交易平台认证技术规范》附录 A 功能检测 A-143 / A-153（均 ★，一星门槛项）；对照报告 `water-erp/docs/附录A功能检测对照报告-投标开标评标-2026-08-28.md` §P0
- **规范原文**：
  - A-143 ★：「澄清对象收到澄清问题后，可编辑澄清答复内容，上传有关附件，并经电子签名后反馈。」
  - A-153 ★：「可向公共服务平台监督通道推送评标报告数据。」
- **决策记录**：主持端对 `type='clarification'` 的原「代录答复」保留为**离线答复登记**降级通道（用户确认，2026-08-28）

---

## 1. 背景与目标

对照审计认定两项 ★ 级不符合：

1. **A-143**：评标澄清（`BidClarification`，评委/招标人 → 投标人）目前答复由主持端「代录」纯文本（`PATCH /bid/projects/:id/clarifications/:cid/reply`），供应商侧零写路径、无附件、无电子签名。
2. **A-153**：全代码库无任何公共服务平台对接；评标报告只有平台内流转（签字包 PDF、评标回流包、`regulatory-export` 手动 JSON 下载）。

目标：

- A-143：供应商门户新增**评标澄清在线答复**（编辑 + 附件上传 + SM2 电子签名），复用双信封体系的 `SupplierCert` 与 `receiptSignature` 验签蓝图；主持端由「代录」改为「查看 / 核验」，代录降级为显式的离线登记动作。
- A-153：新建**监督推送适配层**（supervision-push 模块）：结构化推送信封（JSON + 文件引用清单 + 平台 SM2 签名）+ 可配置推送端点 + 离线导出凭证。本期只实现 `EVALUATION_REPORT` 载荷；适配层接口为同类项（A-114 开标记录交换、A-130 外部专家库、A-135 考评递交）一次定型，接入省级公共服务平台后按同模式填充。

## 2. 非目标（明确不做）

- A-152 评委侧 CA 电子签名（P1，另行整改）
- 推送包 zip 打包（凭证自包含，引用文件走现有 `/api/upload/files/:id` 分开下载）
- BullMQ 异步推送队列（单次同步推送 + UI 手动重试；队列留作扩展点）
- `OPENING_RECORD` / `EXPERT_CREDIT` / `EXPERT_PERFORMANCE` 三类载荷的 body 实现（仅留枚举位与 builder 接口）
- 推送成功作为归档闸门（外部平台未接入不得卡归档；接入后再议）
- SupplierCert X.509/PEM 解析（沿用浏览器枚举上报公钥的现有绑定机制）

## 3. A-143 设计

### 3.1 现状事实（代码依据）

- `BidClarification`（schema.prisma:758–776）：`id, projectId, type('clarification'|'question'), question, issuer, supplierName, supplierId?, status('待回复'|'已回复'|'已关闭'), reply?, fileAssetId?(松散), aiSummary?`。答复内联同一行，无独立回复模型。
- 两套澄清体系不可混淆：`BidClarification`（评标期）≠ `TenderClarification`（投标前招标文件澄清，供应商可提问，不在本设计范围）。
- 验签蓝图 = `receiptSignature`（supplier-portal.service.ts:154–207）：服务端拼 canonical → 前端 `ukey.sign(certSn, canonical)` → 服务端 `SignatureService.verify` → `Json {payload, signature, algorithm, verifiedAt}` 归档；证书严格查 `supplierCert.findFirst({supplierId, certSn, bindingStatus:'ACTIVE'})`（与 `submitBid` 同，不回退 `supplier.sm2PublicKey`）。
- 前端签字素材齐全：`utils/ukey-factory.ts`（detectUkey/openUkey）、`bids/[id]/submit/page.tsx` 的 PIN 弹窗与回执签字序列、`SpDialog/SpButton/SpInput`。
- 上传：`POST /api/upload?category=X`（supplier 角色允许，50MB），关联模式 = 先上传后传 assetId；类目白名单在 `upload-categories.ts`。

### 3.2 Schema 变更（`BidClarification` 加 4 个可空列）

```prisma
model BidClarification {
  // ……既有字段不动……
  replyChannel       String?   // 'online' | 'offline'；null = 历史数据
  replySignature     Json?     // {v:1, payload, signature, algorithm:'SM2/SM3', certSn, verifiedAt}
  replyAttachmentIds Json?     // [{fileAssetId, name, sha256}]
  replyByName        String?   // 答复操作人（供应商登录名 / 主持人姓名）留痕
}
```

- 全部可空 → 存量行零影响，`listClarifications` 旧消费方不受破坏。
- `status` 沿用中文自由文本，不引入新状态；在线/离线均为 `已回复`，由 `replyChannel` 区分。

新上传类目（`upload-categories.ts`）：

- `clarification_reply` —— 答复附件；加入**永久不可删保护**清单（证据件，与 `bid_document` 同级）；加入 `streamFile` 可下载类目白名单。

### 3.3 Canonical payload 定义（前后端共用）

```jsonc
{
  "v": 1,
  "clarificationId": "<id>",
  "projectId": "<id>",
  "supplierId": "<id>",
  "reply": "<答复文本>",
  "attachments": [                    // 按 fileAssetId 字典序升序
    { "fileAssetId": "<id>", "sha256": "<hex>" }
  ],
  "certSn": "<证书序列号>"
}
```

- 序列化用 `@water-erp/ukey` 的 `canonicalJson`（递归排序键），与信封哈希同一实现。
- **服务端是唯一权威**：前端不自行拼接——先调 3.4 的 `reply-payload` 端点取 canonical 串，直接对其签名；提交时服务端用同一规则重算并验签。确定性函数，重复调用结果一致。

### 3.4 API — 供应商侧（`supplier-portal.controller.ts`，`@Roles('supplier')`）

| 端点 | 说明 |
|---|---|
| `GET /supplier-portal/projects/:id/bid-clarifications` | 只返回寻址到本司的 `type='clarification'` 记录（`supplierId` 精确匹配）。前置：本司为该项目投标成员（复用 `getBidProject` 成员判定）。EVALUATING 可答；ARCHIVED 只读返回。响应含 status/question/issuer/createdAt/updatedAt |
| `POST /supplier-portal/projects/:id/bid-clarifications/:cid/reply-payload` | DTO `{reply, attachmentIds[]}`；校验后返回 `{payload: <canonical 字符串>}`（**不落库**，无状态） |
| `POST /supplier-portal/projects/:id/bid-clarifications/:cid/reply` | DTO `{reply(5~5000), attachmentIds[](≤5), certSn, signature}`。流程见下 |

`reply` 提交流程（全在事务/校验链内）：

1. 澄清存在 + `projectId` 匹配 + `supplierId === 本司` + `type='clarification'` + `status='待回复'` + 项目阶段 `EVALUATING`（重复提交 → 409）。
2. 附件校验：每个 `fileAssetId` 存在、`category='clarification_reply'`、`uploaderId === 当前用户`。
3. 证书严格查 `supplierCert{supplierId, certSn, bindingStatus:'ACTIVE'}`；未绑定 → 400 引导绑盾。
4. 服务端重算 canonical（3.3），`SignatureService.verify(canonical, signature, cert.publicKey)`；失败 → 400 `CLARIFICATION_REPLY_SIGNATURE_INVALID`。
5. 写入：`reply, status='已回复', replyChannel='online', replySignature={v:1,payload,signature,algorithm:'SM2/SM3',certSn,verifiedAt:now}, replyAttachmentIds=[{fileAssetId,name,sha256}], replyByName=<登录用户>`。
6. WS `notifyClarificationReplied`（`bid.gateway.ts` 既有事件，`replier:'supplier'`）。

### 3.5 API — 主持端改造（`bid.controller.ts`）

- `PATCH /bid/projects/:id/clarifications/:cid/reply` 按 `type` 分流：
  - `type='question'`（供应商提问 → 评委答复）：**维持现状**（答疑方向本就该评委答）。
  - `type='clarification'`：变为**离线答复登记** —— DTO `{reply, channel:'offline'(必传), offlineReason(必填)}`，不接收签名；写 `replyChannel='offline'`、`replySignature=null`、`replyByName=<主持人>`。语义：供应商经书面/电话等线下途径答复后的留痕降级通道。
- 新增 `POST /bid/projects/:id/clarifications/:cid/verify-reply`：从库内 `reply + replyAttachmentIds + replySignature.certSn` 重算 canonical 复验签名（公钥取 `certSn` 对应证书记录的 `publicKey`，不受后续吊销影响验签结果，但返回 `bindingStatus` 供展示）；验真则刷新 `replySignature.verifiedAt`。响应 `{valid, certSn, bindingStatus, verifiedAt}`。
- `GET .../clarifications` 响应补字段：`replyChannel`、`replySignature` 摘要（certSn/verifiedAt/algorithm，不回传 payload 全文）、`replyAttachmentIds`、`replyByName`。
- **创建澄清归一化**（`bid.controller` 与 `expert.controller` 两处创建端点）：`supplierId` 缺省时按 `supplierName` 在项目投标人集合内匹配回填；匹配不到保持 `null`，主持端 UI 提示「未关联投标人，供应商无法在线答复」。

### 3.6 前端 — 供应商门户（:3004，sp-* 样式体系）

> cgzxui 技能适用范围为 :3002/:3005（:3007/:3006 已移植）；供应商门户为自有 `sp-*` 体系，本页面遵循供应商门户既有规范，**不引入 cgzxui 类**。

- **入口**：`bids/[id]/page.tsx` 原只读「澄清答疑」区块升级——展示寻址到本司的评标澄清，「待回复」徽标 + 【答复】按钮（有待回复项时醒目提示）跳新页面。
- **新页面** `src/app/(main)/bids/[id]/clarifications/page.tsx`：
  1. 问题卡片（发起人 / 内容 / 时间 / 状态）；
  2. 答复编辑器：`textarea` + 附件上传（复用 `lib/api/upload.ts` 的 `uploadFile(file,'clarification_reply')`，附件列表含文件名/大小/删除）；
  3. 【签名并提交】→ PIN 弹窗（克隆 `submit/page.tsx` 的 `ukeyDialogVisible` 模式：`detectUkey/openUkey` → 校验绑定证书匹配 → `adapter.sign(certSn, payload)` → 提交）；无可用证书 → 引导 `/profile/ukey` 绑盾；
  4. 已提交态：答复内容 + 附件列表 + 签名信息（algorithm/certSn 尾段/验签时间）+ 验签徽标。
- 样式新增 `src/styles/pages/clarifications.css`（`sp-` 前缀命名，按现有分组导入约定挂载）。

### 3.7 前端 — 主持端（:3007，cgzxui 已移植）

`clarifications-block.tsx` 改造：

- `type='clarification'` 行：删除内联代录 textarea → 状态徽标三态：`待供应商答复` / `已答复 · 在线签名 ✓` / `已答复 · 离线登记`；已回复行可展开：正文、附件下载链接、签名信息（certSn / verifiedAt）、【核验签名】按钮（调 `verify-reply`，展示复验结果与证书状态）。
- 【离线答复登记】为次级操作：cgzxui 模态（`bg-[var(--background)]` 外壳 + `workbench-input` + 38px 齐平按钮组），`offlineReason` 必填。
- `type='question'`（书面来函/答疑）行：保留原内联答复交互不变。
- `evaluation.ts` API helper 增加 `verifyClarificationReply` / 离线登记（复用 `replyClarification` 加 `channel`/`offlineReason` 字段）。

## 4. A-153 设计

### 4.1 现状事实（代码依据）

- 全库无对外推送先例；唯一外发 HTTP 先例 = `verification/sms-provider.ts`（native `fetch` + `AbortSignal.timeout`）。
- 文件包模式成熟：`packageType/packageVersion` + `fingerprint = sha256(body)` + FileAsset 按 key upsert（开标文件包 / 评标回流包 / 评标完整性包）。
- 最丰富的评标报告结构化 JSON = `BidSignPacketService.buildSnapshot()`（十项法定内容全）。
- `SystemConfig` 已有 `gb_code_config`（公共服务平台平台代码占位）。
- 归档闸门读 `BidSignPacket.closedAt + handoverFileAssetId`（`bid-state.ts` `assertSignGateClosed`）。

### 4.2 模块结构

新建 `apps/api/src/supervision-push/`：

```
supervision-push.module.ts       // imports: BidModule（Prisma/Storage 为全局模块，无需 import）
supervision-push.controller.ts
supervision-push.service.ts
supervision-push-payload.ts      // buildPushEnvelope + PayloadBuilder 接口（4 类载荷的扩展位）
platform-signing.service.ts      // 平台 SM2 签名密钥管理
dto/*.ts
```

- `BidModule` 需导出 `BidSignPacketService`（若尚未导出）供 `buildSnapshot` 复用。
- 路由全部显式标注 `@Roles(...)`（RolesGuard 默认拒绝制）。触发角色 `admin/leader/staff`（对齐归档触发权，评标后收尾归 :3005；`bid_host` 不参与）。**不做端口排他限制**。

### 4.3 配置

`SystemConfig` key `supervision_push_config`（运行时可改，admin 编辑）：

```jsonc
{ "enabled": false, "endpoint": "", "authToken": "", "timeoutMs": 8000, "platformCode": "" }
```

- env 兜底：`SUPERVISION_PUSH_URL`（`process.env` 优先补 `endpoint` 缺省值，遵循库内 `?? / ||` 惯例）。
- `platformCode` 缺省联动 `gb_code_config`。
- 响应中 `authToken` 一律掩码。

### 4.4 平台签名密钥

- 首次推送/导出凭证时经 `SignatureService.generateKeyPair()` 生成平台 SM2 密钥对；私钥落盘 **`apps/api/.data/supervision/platform-signing.json`**（`ADMIN_KEYSTORE_DIR` 默认 `apps/api/.data/admin-keystore` 的平行惯例），公钥 + DN 存同文件并返回给调用方。
- `GET /supervision-push/platform-cert` 暴露公钥 + DN，供公共服务平台侧注册验签。
- **运维要求**：`.data/supervision/` 纳入备份清单（丢失 = 历史推送签名不可复现），与 `ADMIN_KEYSTORE_DIR` 同等对待。

### 4.5 推送信封（适配层核心结构，一次定型）

```jsonc
{
  "packageType": "SUPERVISION_PUSH",
  "packageVersion": 1,
  "payloadType": "EVALUATION_REPORT",   // | OPENING_RECORD | EXPERT_CREDIT | EXPERT_PERFORMANCE
  "platformCode": "<code>",
  "generatedAt": "<ISO>",
  "project": { "id": "", "projectCode": "", "name": "", "procurementMethod": "" },
  "body": { /* 载荷实现 */ },
  "attachments": [ { "name": "", "category": "", "fileAssetId": "", "sha256": "" } ]
}
```

- `fingerprint = sha256Hex(canonicalJson(envelope))`；平台密钥对 `fingerprint` 签名。
- 推送报文 = `{ envelope, signature: { algorithm:'SM2/SM3', value, certDn, publicKey } }`。
- **本期 `EVALUATION_REPORT` body**：`BidSignPacketService.buildSnapshot(projectId)` 全量（评标报告十项 + 专家评分表 + 异议/澄清/动议）+ 签署信息（`signPacket {fileAssetId, sha256, closedAt}`、`handover {fileAssetId, sha256}`、`expertSignStatuses[]`）。`attachments` 列签字包 PDF 与评标回流包两个文件引用。
- 信封文件存 FileAsset：新类目 `supervision_push_packet`，MinIO key `supervision-push/${projectId}/${payloadType}-${ts}.json`，**每次尝试一条，不 upsert**（推送是多尝试行为，留全部物证）。
- 其余 3 类载荷：`payloadType` 枚举位 + `PayloadBuilder` 接口就位；调用即 400 `PAYLOAD_TYPE_NOT_READY`「该载荷类型待接入省级平台后启用」。

### 4.6 Schema 变更（新模型）

```prisma
model SupervisionPushLog {
  id             String   @id @default(cuid())
  projectId      String
  payloadType    String   // EVALUATION_REPORT | OPENING_RECORD | EXPERT_CREDIT | EXPERT_PERFORMANCE
  status         String   // SUCCESS | FAILED | VOUCHER_EXPORTED
  endpoint       String?
  requestSha256  String?  // envelope fingerprint
  packetAssetId  String?  // 信封 FileAsset
  responseCode   Int?
  responseSnippet String? // ≤2KB
  errorMessage   String?
  attemptNo      Int      @default(1)   // 同 project+payloadType 递增
  signedBy       String?  // 平台证书 DN
  voucherAssetId String?
  createdById    String?
  createdAt      DateTime @default(now())
  project        BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@index([projectId, payloadType])
}
```

新上传类目：`supervision_push_packet`、`supervision_push_voucher`（均永久不可删 + 可下载白名单）。

### 4.7 端点清单（`@Controller('supervision-push')`）

| 端点 | Roles | 说明 |
|---|---|---|
| `GET /supervision-push/config` | admin/leader/staff | 当前配置（token 掩码） |
| `POST /supervision-push/config` | admin | 保存配置（DTO 校验 endpoint URL 形态、timeoutMs 1~60s） |
| `GET /supervision-push/platform-cert` | admin/leader/staff | 平台公钥 + DN（供对端注册） |
| `POST /supervision-push/projects/:id/push` | admin/leader/staff | DTO `{payloadType?='EVALUATION_REPORT'}`；执行推送 |
| `GET /supervision-push/projects/:id/status` | admin/leader/staff | 闸门状态 + 各 payloadType 最新一条日志摘要 |
| `GET /supervision-push/projects/:id/logs` | admin/leader/staff | 尝试历史（倒序） |
| `POST /supervision-push/projects/:id/voucher` | admin/leader/staff | 生成离线导出凭证 |

推送执行序列（`push`）：

1. 配置校验：`enabled && endpoint` 否则 400 `SUPERVISION_PUSH_DISABLED`。
2. 载荷闸门（`EVALUATION_REPORT`）：签字包已生成 + `closedAt` + 回流包 `handoverFileAssetId`（复用 `assertSignGateClosed` 口径）→ 不满足 409。
3. 构建信封 + 签名（4.4/4.5）→ 存 FileAsset。
4. `fetch(endpoint, {method:'POST', body, signal: AbortSignal.timeout(timeoutMs), headers:{'Content-Type':'application/json', ...(authToken && {Authorization:`Bearer ${authToken}`}), 'X-Platform-Code': code}})`。
5. 2xx → `SUCCESS`；其他/超时/网络错误 → `FAILED`（记 responseCode/snippet 或 errorMessage）。
6. 写 `SupervisionPushLog`（attemptNo = 既有计数 +1）+ `AuditLog` action `SUPERVISION_PUSH`（`createIntegrityStamp`，对齐 `completeOpening` 模式）。
7. 返回日志行，HTTP 恒 201。**不抛 500 给前端**：推送失败是业务结果而非接口故障。

离线导出凭证（`voucher`）：

1. 构建同一信封 + 签名（保证凭证与在线推送同源同指纹）；
2. 凭证 = `{packageType:'SUPERVISION_PUSH_VOUCHER', packageVersion:1, envelope, signature, pushLogs:<本项目+载荷全部尝试摘要>, exportedAt, exportedBy}`；
3. 存 FileAsset 类目 `supervision_push_voucher`，key `supervision-push/${projectId}/voucher-${ts}.json`；
4. 写 `VOUCHER_EXPORTED` 日志（含 `voucherAssetId`）；响应 `{voucherAssetId, downloadUrl:'/api/upload/files/<id>'}`。

### 4.8 前端 — :3005 开标确认面板（cgzxui）

- 新组件 `apps/web/src/components/projects/bid-confirm/supervision-push-block.tsx`，挂载于评标后收尾区域（`evaluation-handover-block` 一侧），样式与相邻区块一致（`wb-panel` / cgzxui 组件语言）：
  - 状态行：配置摘要（已启用/未配置端点）+ 评标报告推送状态徽标（未推送 / 成功 / 失败）+ 最近尝试时间；
  - 操作：【推送监督平台】（未配置/未启用置灰）、【离线导出凭证】、【推送日志】；
  - 配置编辑（仅 admin 可见）：cgzxui 模态（`workbench-input`），字段 enabled/endpoint/authToken/timeoutMs/platformCode；
  - 日志抽屉/模态：`neu-table`（时间 / 第 N 次 / 端点 / 结果 / 错误摘要 / 凭证下载）。
- `apps/web/src/lib/api/` 新增 supervision helper（getPushStatus / pushNow / exportVoucher / getPushLogs / getPushConfig / savePushConfig）。
- **:3007 不加推送入口**（分工 v3：评标后收尾归 :3005）。

## 5. 公共约束与验证

### 5.1 迁移与提交纪律（并行会话约定）

- **一个迁移** `20260828xxxxxx_compliance_p0_clarification_reply_supervision_push` 覆盖 §3.2 + §4.6 全部变更，与代码同提交；非交互环境走 `migrate dev --create-only` → `db execute` → `migrate resolve --applied`。
- 改 `schema.prisma` 后提交前必须 `cd apps/api && npx prisma validate`。
- 只 `git add` 明确改动的文件路径（禁 `git add -A/.`）；提交信息 `feat(compliance): ...`；不 push。
- 修改前 `git status` 确认其他会话无在途改动。

### 5.2 测试

- **单测**：
  - 澄清答复 canonical 构建 + 验签：正例 / 篡改文本 / 换密钥 / 证书 REVOKED（验签仍真但状态透出）/ 附件顺序无关性（排序保证）；
  - 推送信封：同输入指纹稳定（重算一致）、签验闭环、`EVALUATION_REPORT` body 含十项关键段；
  - 配置解析：env 兜底 / timeoutMs 边界 / token 掩码。
- **e2e**（`apps/api/test/`，沿用 seed + cookie 登录约定）：
  - 澄清链：staff 对种子评标中项目创建寻址供应商的澄清 → 供应商 `GET` 列表可见（他司 403/不可见抽查）→ `reply-payload` → sm-crypto 生成密钥对、`POST profile/cert` 绑证 → 签名提交 → `已回复` + `replySignature.verifiedAt` 落库 → 主持端 `verify-reply` 返回 `valid:true`；离线登记路径（必带 reason）；篡改签名 400。
  - 推送链：admin 存配置（端点 = e2e 内临时起本地 HTTP server）→ push → `SUCCESS` + 日志行 + 信封 FileAsset 类目正确 → 停掉 server 再 push → `FAILED` 日志 → voucher 导出 → `GET /api/upload/files/:id` 200 且含 `SUPERVISION_PUSH_VOUCHER`。
- **Boot smoke**（memory 教训：单测绿 ≠ 能启动）：`api tsc` + `node dist` 起 :4099 → `GET /api/docs` 200 → 杀。

### 5.3 验收映射

| 规范检测点 | 验收证据 |
|---|---|
| A-143「编辑答复内容」 | 供应商门户答复编辑器 + `POST .../reply` |
| A-143「上传有关附件」 | `clarification_reply` 类目上传 + `replyAttachmentIds` 持久化 + 主持端可下载 |
| A-143「经电子签名后反馈」 | SM2/SM3 签名（`SupplierCert` ACTIVE 证书）+ 服务端验签 + `replySignature` Json 归档 + 主持端核验按钮 |
| A-153「可向公共服务平台监督通道推送评标报告数据」 | 可配置推送端点 + 结构化签名信封（评标报告全量快照）+ 推送日志 + 离线导出凭证；接入省级平台 = 配置端点即用 |

### 5.4 风险与对策

| 风险 | 对策 |
|---|---|
| 创建澄清时 `supplierId` 缺省 → 供应商端不可见 | 创建端点按投标人集合归一化回填；主持端对未关联行提示 |
| 演示环境无 U盾中间件 | mock U盾中间件 :17999（`pnpm dev:ukey-mw`）与既有投标流程同依赖，文档已覆盖 |
| 平台签名私钥丢失 | `.data/supervision/` 纳入备份清单（§4.4），与 ADMIN_KEYSTORE 同级 |
| EVALUATING 后未答复即归档 | 归档后只读，符合「评标中答复」语义；离线登记在归档闸门关闭前仍可用（沿用既有 ARCHIVED 拦截） |
| 推送端点未接入期间误点 | 配置 `enabled` 默认 false；未配置端点按钮置灰 |

## 6. 实施顺序（供实施计划引用）

1. schema + 迁移 + `prisma validate`
2. API：A-143 供应商端点 + 主持端点改造 + 单测
3. 供应商门户答复页（sp-*）
4. 主持端 clarifications-block 改造（:3007）
5. supervision-push 模块（配置/密钥/信封/推送/凭证/日志）+ 单测
6. :3005 supervision-push-block（cgzxui）
7. e2e 两套 + boot smoke + lint
8. 分步提交（每步一提交，`feat(compliance):` 前缀）
