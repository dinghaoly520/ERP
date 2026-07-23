# 在线开标大厅（迭代一：实时文字地基）设计文档

- **日期**：2026-07-23
- **状态**：待实现（设计已确认）
- **涉及端**：apps/api（:4001）、apps/supplier-portal（:3004，Vue 3）、apps/bid-portal（:3007，React）、packages/shared
- **后续迭代**：迭代二（SRS 单向直播 + 录制存证）为愿景节，本文档仅预留接口不实施

---

## 1. 背景与目标

### 1.1 痛点

投标方在等待开标时只能通过网页查看唱标信息（`OpeningConfirm.vue`，一次性 REST 拉取 + 手动刷新），无法与开标管理员实时交流；供应商提交确认/异议后主持端无实时感知；澄清提问无人实时响应。

### 1.2 行业调研结论

国内"不见面开标大厅"已是公共资源交易平台的**标准配置**（吉林、昆山、连云港、安康、中国石化等平台均有公开操作手册）：

- **典型流程**：在线签到 → CA 远程解密 → 唱标 → 投标人确认开标记录 → 异议/质疑 → 全程录音录像存档
- **交互模式的行业共识**：
  - 音视频以**主持人单向直播**为主（投标人观看），多方摄像头会议不是主流
  - **文字互动对话框**是标配（疑义在大厅文字互动对话框提出）
  - 少数平台支持**录制短语音**（新点平台：代理开启"允许群聊"后可发短语音）
  - 主持人有"交流控制"开关；投标人**限时不响应互动视为放弃权利**
- **法规硬约束**：
  - 《电子招标投标办法》第 30 条：在线解密、向所有投标人公布唱标信息、开标过程记录经电子签名确认
  - 多地 2024–2026 新规（黑龙江、辽宁、山西等）明确要求开标/评审**全程录音录像、清晰可辨、存档备查**
  - 2026 年《公共资源交易中心招标投标管理办法》强化全过程记录、异常行为报告、伪造记录追责

### 1.3 代码现状（摸底结论）

| 现状 | 说明 |
|------|------|
| ✅ 主持端实时通道成熟 | `BidGateway`（`/bid` namespace，13 个事件、`project:{id}`/`host:{id}` 房间、`packages/shared/bid-events.ts` 三方共享契约、重连/心跳工程完整） |
| ✅ 现成 IM 内核 | `ChatGateway` + `ChatMessage`：硬鉴权（已认 `token_supplier`）、presence、已读回执、多端同步——但为全局 1v1，无项目维度 |
| ✅ 可复用模式 | 监督日志双写（DB + socket + 前端合并）、归档哈希链、MinIO、`gateway @Optional()` 降级模式 |
| ❌ 供应商端零实时 | 无 socket.io-client 依赖、纯 REST + 手动刷新；`BidGateway` 鉴权不认 `token_supplier` |
| ❌ 供应商动作无推送 | 确认/异议/提问已核实无 emit（supplier-portal.service :825-882） |
| ❌ 澄清为半实时扁平问答 | 仅主持侧创建/回复 emit；`CLARIFICATION_REPLIED` 站内信运行时无代码创建 |
| ❌ 音视频零基建 | 全仓无 WebRTC/信令/TURN |

### 1.4 目标（迭代一）

1. 供应商端接入实时通道，开标大厅实现**签到、实时业务状态推送、公聊 + 私聊文字互动**
2. 供应商确认/异议/异议处理结果实时双向触达
3. 全部交流记录落库存证，随归档包导出
4. 为迭代二直播预留架构接口（媒体面与业务面解耦原则先行确立）

### 1.5 明确不做（本期）

- 音视频直播与录制（迭代二）
- CA 数字证书签章（如需对接公共资源交易平台 CA，单独立项）
- 多实例部署的 socket.io-redis adapter（单 API 实例假设）
- 澄清模块实时化改造（业务规则已明确为单向发布，见 §2.2）

---

## 2. 关键决策记录

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 音视频核心形态 | **A：主持人单向直播 + 实时文字**（迭代二实施） | 行业主流；开标本质是"宣读+确认"非"讨论"；私有化成本最低 |
| 2 | 迭代划分 | **两迭代**：迭代一实时文字地基，迭代二直播+录制 | 实时链路是全部后续能力的底座，且本身解决 80% 痛点 |
| 3 | 聊天可见性 | **公聊 + 私聊都要**：大厅公聊（主持发布公告/集体答疑）+ 主持↔供应商 1v1 私聊（异议/敏感提问） | 兼顾公开透明与供应商放心发言 |
| 4 | 签到机制 | **签到 + 软提示**：记录签到时间/IP/设备，主持端展示状态；不做业务处罚 | 先采集数据，处罚规则留运营侧决定 |
| 5 | 实现路线 | **路线 1**：扩展 `/bid` gateway 认 `token_supplier`（严格门控）+ 新建 `OpeningHallMessage` 模型 | 单一连接承载全部实时能力，复用事件契约与房间架构 |
| 6 | 澄清模块 | **零改动**。业务规则：澄清只允许专家/主持人**单向发布**给供应商；供应商需要信息时**拨打电话或书面交流**，不走系统反向提问 | 防串标；评标期供应商对系统静默 |
| 7 | 存量供应商提问入口 | **改造为"书面交流"渠道**：供应商提交书面函件（正文+附件），主持端查看，无实时推送 | 与实际业务规则对齐，复用现有端点与模型 |

---

## 3. 架构总览

```
迭代一：实时文字地基（实施范围）
├── apps/api
│   ├── BidGateway 扩展：软鉴权认 token_supplier；角色 + 成员双层门控；
│   │   敏感事件按角色过滤，绝不进供应商房间
│   ├── OpeningHall 新模块：OpeningHallMessage 模型 + REST（历史/未读/读游标/
│   │   签到/交流控制）+ service（发送/审计/控制状态），复用注入 BidGateway 推送
│   ├── 事件补全：supplier-portal.service（确认/异议）、bid.service（异议处理）补 emit
│   └── Notification 衔接：主持人私聊回复 → 供应商站内信离线兜底
├── packages/shared：bid-events.ts 新增 hall:* / opening:* 事件常量 + 载荷接口
│   （supplier-portal 本次新增 @water-erp/shared 依赖）
├── supplier-portal（Vue3）：useBidWebSocket composable（移植主持端工程）+
│   新页面「在线开标大厅」+ 书面交流改造
└── bid-portal（React）：开标大厅页增「会场交流」抽屉（公聊/私聊/交流控制/
    签到花名册）+ 监督端只读聊天记录页签 + 归档随包

迭代二：直播 + 录制存证（愿景，仅预留）
├── docker-compose 增 SRS 容器；API 加推/拉流凭证校验端点
├── BidOpeningSession 预留字段 streamStatus / recordingAssetId（本期不建）
└── 录制文件入 MinIO → 挂归档包哈希链；可选短语音留言、AI 纪要
```

### 三条核心原则

1. **媒体面与业务面解耦**（迭代二约束，本期先立规矩）：SRS 只管音视频流，Socket.IO 只管业务事件与聊天。直播中断不影响开标业务流——延续现有 `gateway @Optional()` 注入、WS 挂掉 REST 照常的哲学。
2. **安全边界收在一处**：供应商能收到什么事件，由 `BidGateway` 的服务端角色过滤单点决定，不依赖前端不监听。评分、监督日志、异常检测、他方解密明细、他方私聊对供应商房间零泄露。
3. **一切交流皆存证**：聊天消息、签到记录全部落库 + 关键动作并行写监督日志，ARCHIVED 时随归档包导出（复用哈希链）。聊天记录是开标记录的组成部分。

---

## 4. 实时连接：`/bid` gateway 供应商接入与门控

全设计风险最高的一处：供应商接入后，评分过程、监督日志、异常检测、他方解密细节绝不能泄露。五层防线：

### 4.1 鉴权扩展（`bid.gateway.ts:32-75`）

- 握手 cookie 解析序加入 `token_supplier`：`token_web → token_expert → token_supplier → token`（各门户 cookie 独立，无冲突）
- 保持软鉴权语义（JWT 失败不断连），但 **supplier 角色无有效 token 时拒绝一切 join**

### 4.2 两层房间门控

- **角色门**（既有）：`host:{id}` 仅限 admin/bid_host/leader/staff；`project:{id}` 开放给所有已认证角色含 supplier
- **成员门**（新增）：supplier `join:project` 时校验 `BidSupplier(projectId × supplierId)` 记录存在——只有本项目参投供应商能进本项目大厅，防横向枚举（供应商 A 不能潜入供应商 B 的项目房）；结果缓存在 `socket.data`，连接期内只查一次

### 4.3 事件分级

| 分级 | 事件 | 处置 |
|------|------|------|
| 供应商可见（开标公开信息） | `stage:change`、`opening:started`、`submission:opened`、`evaluation:started`、`decrypt:status`（各家解密进度，行业大厅标配公开）、`clarification:created/replied`（issuer 已脱敏，语义即"发布给供应商"）、`bid:validity:change`、新增 `hall:*`、`opening:dispute:resolved`（仅当事供应商） | 维持/新增 project 房广播 |
| 仅主持内部 | `supervision:log`、`anomaly:detected`、`expert:presence` | 已在 host 房，无需动 |
| **需改目标** | `expert:presence:aggregate`（现发 project 房） | **改为 host 房**——供应商不应看到专家评标进度。bid-portal 同连两房不受影响；实现时核实 expert-portal 消费点并同步调整 |

### 4.4 供应商端 socket 工程

- 新增 `supplier-portal/src/composables/useBidWebSocket.ts`：移植 bid-portal `use-bid-websocket.ts` 成熟模式——`portalURL('api','/bid')` + `withCredentials`（携带 `token_supplier`）、显式 `join:project`、20s ping/10s pong 心跳、重连退避 [1s,2s,5s,10s]、页面不可见时断开省电、连接状态灯
- CORS 已有 localhost 回退；socket 直连 :4001，`vite.config.ts` 的 `/api` 代理不动

### 4.5 在场感知

- gateway 在 `socket.data` 记录 supplierId；连接/断开时向 project 房推送 `hall:presence:update`（节流）
- 在场名单以 gateway 内存 Map 为主，`BidSupplier.lastSeenAt` 节流落库供重连补偿与存证
- **单 API 实例假设**：暂不需要 socket.io-redis adapter，未来多实例扩容时再加

---

## 5. 数据模型

### 5.1 `OpeningHallMessage`——大厅消息（新建，核心表）

```prisma
model OpeningHallMessage {
  id          String   @id @default(cuid())
  projectId   String   // 仅索引不做外键（与 BidOpeningRecord 松耦合风格一致）
  roomType    OpeningHallRoomType          // PUBLIC 公聊 | PRIVATE 私聊
  supplierId  String?  // 仅私聊有值（标识哪家供应商的会话）；公聊为 null
  senderId    String   // User.id
  senderRole  OpeningHallSenderRole        // HOST | SUPPLIER | SYSTEM
  senderName  String   // 发送时姓名快照（存证不依赖日后改名）
  type        OpeningHallMessageType @default(TEXT)  // TEXT；迭代二加 VOICE / SYSTEM_EVENT
  content     String
  fileAssetId String?  // 预留：迭代二短语音留言走现有 FileAsset
  createdAt   DateTime @default(now())
  @@index([projectId, roomType, supplierId, createdAt])
  @@index([projectId, createdAt])
}
```

**不扩展 ChatMessage 的理由**：大厅消息是开标记录组成部分（归档、审计、项目关联），ChatMessage 是全局 1v1 IM 无项目维度，混合会纠缠审计查询。两模型并存、职责分清。

**不可变规则**：无删除/编辑端点；主持人"撤回"以 `SYSTEM` 消息记录操作痕迹，原文物理保留。

### 5.2 `OpeningHallReadCursor`——读游标（新建小表）

```prisma
model OpeningHallReadCursor {
  id         String   @id @default(cuid())
  projectId  String
  userId     String
  roomKey    String   // "public"（公聊）| "supplier:<supplierId>"（私聊）
                      // 用字符串避开 PG 唯一索引 NULL 不相等的坑
  lastReadAt DateTime @default(now()) @updatedAt
  @@unique([projectId, userId, roomKey])
}
```

未读数 = 对应房间 `createdAt > lastReadAt` 的条数。两端同一机制：供应商算公聊/私聊未读；主持人算"哪些供应商有未读会话"。公聊不做逐条已读回执（N×N 过复杂）。

### 5.3 `BidSupplier`——加 3 个字段

```prisma
checkInAt   DateTime?  // 签到时间
checkInMeta String?    // JSON 快照：IP / User-Agent（存证）
lastSeenAt  DateTime?  // 心跳节流 60s 写入
```

### 5.4 `BidOpeningSession`——交流控制

```prisma
exchangeControl String @default("OPEN")
// OPEN 允许群聊 | MUTED 仅主持人可发言 | CLOSED 关闭互动
// 迭代二预留（本期不建）：streamStatus、recordingAssetId
```

`exchangeControl` 与阶段联动：进入 EVALUATING 时置 CLOSED（大厅只读）。

### 5.5 `BidClarification`——仅加 1 个可空字段（书面渠道改造）

```prisma
fileAssetId String?  // 书面来函附件
```

其余零改动。

### 5.6 迁移与种子

- 迁移走项目约定（避免交互式 reset 丢数据）：`migrate dev --create-only` → `db execute` → `migrate resolve --applied`
- 新增种子快照 `OpeningHallMessage.json`、`OpeningHallReadCursor.json`（英雄项目演示消息）

---

## 6. 事件契约

新事件加入 `packages/shared/src/bid-events.ts`（常量 + 载荷接口，三端共享）。铁律延续：**载荷永不含分数；每事件带服务端时间戳 `ts`**。supplier-portal 本次新增 `@water-erp/shared` 依赖。

### 6.1 大厅聊天（投递范围是安全关键）

| 事件 | 方向 | 投递范围 | 载荷要点 |
|------|------|----------|----------|
| `hall:message:new` | S→C | **公聊广播 `project:{id}`；私聊仅投 `host:{id}` + 该供应商自己的连接**（靠在籍表 supplier→socketId 定向；私聊绝不泄露给其他供应商） | id, roomType, supplierId?, supplierName?, senderRole(HOST/SUPPLIER/SYSTEM), senderName, content, type, createdAt |
| `hall:exchange:control` | S→C | project 房 | control(OPEN/MUTED/CLOSED), 操作人, ts |

发消息走 **REST 优先**：`POST /opening-hall/:projectId/messages` → 校验、落库（审计）→ service 层向接收方推送。不用客户端 socket 上行发消息——与 bid 模块风格统一，便于限流与内容校验。接收方离线时消息已落库；主持人私聊回复额外落站内信兜底。

### 6.2 签到与在场

| 事件 | 方向 | 投递范围 | 载荷要点 |
|------|------|----------|----------|
| `hall:checkin` | S→C | project 房 | supplierId, supplierName, checkInAt, ts |
| `hall:presence:update` | S→C | project 房 | 在线供应商列表（supplierId, supplierName, 是否已签到）、在线家数；连接/断开触发并节流 |

### 6.3 补全既有业务事件（代码摸底已核实缺口）

| 新事件 | 方向 | 投递范围 | 触发点（现状缺口） |
|--------|------|----------|--------------------|
| `opening:confirmed` / `opening:disputed` | S→C | **host 房 + 当事供应商连接** | supplier-portal.service :825-882 确认/异议现无 emit，主持端实时弹窗 |
| `opening:dispute:resolved` | S→C | host 房 + 当事供应商连接 | 主持处理完异议 → 结果回推供应商（现供应商只能刷新） |

**异议不广播全 project 房的理由**：保守设计——现场异议虽为公开信息，系统默认只推主持与当事方；主持人欲公开可在公聊转述。留运营调整空间。

### 6.4 明确不做

`hall:stream:status`（直播状态）属迭代二，本期不占契约；`presence:heartbeat` 常量已预留，复用其语义。

---

## 7. REST API（新模块 `apps/api/src/opening-hall/`）

```
POST  /opening-hall/:projectId/check-in          供应商签到（幂等；记录 IP/UA 存证）
GET   /opening-hall/:projectId/presence          在场名单（主持端全量；供应商端仅聚合家数）
POST  /opening-hall/:projectId/messages          发消息（roomType=PUBLIC/PRIVATE；
                                                 MUTED 时供应商发言 403；CLOSED 全员禁言；
                                                 @Throttle 30 次/分；content ≤ 2000 字符；
                                                 写时消毒复用 html-sanitize.util）
GET   /opening-hall/:projectId/messages          历史分页（roomType + supplierId? + 游标，
                                                 复用 ChatMessage limit 1-100 游标模式）
GET   /opening-hall/:projectId/unread            未读汇总（公聊 + 各私聊会话）
POST  /opening-hall/:projectId/read              更新读游标（roomKey）
PATCH /opening-hall/:projectId/exchange-control  主持人设交流控制（OPEN/MUTED/CLOSED）
```

- **阶段门控**：大厅自 `opening:started` 起可用；进入 EVALUATING 后只读（消息类端点 403）
- **归属校验**沿用项目三层模型（RBAC + 自定义 Guard + service ownership）：供应商须有本项目 `BidSupplier` 记录；主持端按现有主持权限；绝不只靠 `@Roles` 粗粒度放行
- 书面渠道：现有 `POST /supplier-portal/bid-projects/:id/questions` 保留，语义转为书面来函提交（支持 `fileAssetId` 附件）；主持端现有回复端点保留，语义为书面答复；无实时推送

---

## 8. 前端页面

### 8.1 供应商端：在线开标大厅（supplier-portal，`/my-bids/:id/opening-hall`）

新页面为现有 `OpeningConfirm.vue` 的超集，确认/异议入口收编进来（旧页保留重定向兼容）：

```
┌────────────────────────────┬──────────────────────┐
│ 开标状态卡：阶段时间轴        │ 聊天面板              │
│ 本司解密状态 / 倒计时(复用)   │ [公聊] [私聊●2]      │
│ 唱标记录摘要                 │  消息流（SYSTEM 区分） │
│ ─────────────────────────  │  ──────────────────  │
│ [签到] 已签到 14:02          │  [输入框]      [发送] │
│ [确认开标记录] [提出异议]     │  连接状态灯 ●         │
│ （迭代二：此处上方为直播窗口） │                      │
└────────────────────────────┴──────────────────────┘
```

- 核心组件：`useBidWebSocket` composable、`ChatPanel.vue`（公聊/私聊 tab + 未读角标）、`PresenceBar`
- 技术栈：Vue 3 + Element Plus（保持门户现状；`.impeccable.md` 设计体系为 React 侧，不强套）
- 桌面优先，布局响应式，不为移动端单独立项

### 8.2 主持端：会场交流抽屉（bid-portal `/bid/open`，可收起右抽屉）

注意 cgzxui 化迁移正在进行，抽屉不得破坏现有布局。

- **签到/在场名单**：实时花名册（`hall:presence:update` + `hall:checkin`），区分已签到/在线/离线
- **聊天面板**：公聊 tab + 私聊会话列表（按供应商分列、未读角标）+ 交流控制开关（OPEN/MUTED/CLOSED 分段切换）
- **确认/异议实时弹窗**：`opening:confirmed/disputed` → toast + 对应供应商行高亮（复用 `anomaly:detected` 提示风格）

### 8.3 监督端：只读聊天记录页签（`/bid/supervise`）

监督端只读不干预，与其既有定位一致；聊天记录同时随归档包导出。

### 8.4 书面渠道改造（独立小任务）

- 供应商端 `BidDetail.vue` 标前答疑 UI 更名"书面交流"：正文 + 附件上传（复用 Upload 模块）
- 主持端 `/bid/clarifications` 页增"书面来函"分区；无实时推送（异步语义）

---

## 9. 三个沟通渠道定位

| 渠道 | 方向 | 阶段 | 实时性 | 用途 |
|------|------|------|--------|------|
| 大厅即时聊天 | 双向（公聊+私聊） | 仅开标阶段（OPENING） | ✅ | 开标现场互动 |
| 书面交流 | 供应商 → 主持人 | 全阶段 | ❌ | 供应商书面函件提交 |
| 单向澄清 | 专家/主持人 → 供应商 | 以评标期为主 | 有推送 | 正式询澄（防串标：供应商不反向提问，需要信息走电话或书面） |

---

## 10. 合规与存证

对标"全程录音录像、可查可溯、伪造追责"的法规要求（迭代一无音视频，以文字记录全覆盖达成同等存证强度）：

- **消息不可变**：`OpeningHallMessage` 只写不改；撤回以 SYSTEM 消息留痕，原文物理保留
- **关键动作双写监督日志**：签到、交流控制切换、异议提出与处理，并行写 `BidSupervisionLog`
- **归档随包**：ARCHIVED 时大厅聊天记录（含私聊）导出 JSON 附档纳入归档包，接现有哈希链
- **身份与时间**：复用 JWT + 门户 cookie；签到记录 IP/UA；消息/事件全部服务端时间
- **内容消毒**：消息写时走 `html-sanitize.util`（sanitize-html；CJS 包用 `import x = require()` 约定）
- **CA 签章不在本期**

---

## 11. 错误处理与降级

| 故障 | 处置 |
|------|------|
| WebSocket 断线 | 自动重连退避 [1,2,5,10s]；重连后以本地最新消息时间为游标 REST 补齐缺口 |
| 服务端推送失败 | `@Optional()` 注入 + 可选链——emit 失败不影响 REST 业务写入 |
| API 重启丢在场表 | 内存 Map 清空后客户端心跳重连自动重建；`lastSeenAt` 兜底 |
| 阶段跳变边界 | 前端收 `stage:change` 立即关闭聊天输入；后端端点 403 双保险 |
| 消息发送失败 | REST 报错 → 前端显示"发送失败"可重试，绝不静默丢消息 |

**架构假设**：单 API 实例部署（无 socket.io-redis adapter）。

---

## 12. 测试策略

- **单测**：门控函数 role × event 表驱动（§4 核心防线）；未读/游标计算；交流控制状态机
- **E2E**（新增 `test/opening-hall` 套件，沿用种子账号 + cookie 登录模式）：
  - 安全断言四件套：供应商进他人项目房被拒、join host 房被拒、收不到 `supervision:log` / `anomaly:detected` / `expert:presence:aggregate`、收不到他人私聊
  - 全流程：签到 → 公聊 → 私聊双向 → 未读数 → 读游标 → MUTED 后发言 403
  - 业务闭环：确认/异议/异议处理的实时事件 + 落库断言；OPENING→EVALUATING 后发消息 403
- **前端**：双门户手工测试清单（supplier-portal 维持无单测现状）
- 新增 ESM-only 依赖若致 jest 报 `Cannot use import statement`，按 CLAUDE.md 约定加入两份 transformIgnorePatterns allowlist

---

## 13. 任务拆分与里程碑

| 里程碑 | 任务 | 验收 |
|--------|------|------|
| **M1 实时链路** | shared 事件契约 + 包构建；迁移（新表 + 字段，create-only → db execute → resolve）；gateway 供应商接入与门控；presence；opening-hall REST 模块 | socket 工具连入，门控 E2E 全绿，公聊/私聊收发打通 |
| **M2 供应商端** | socket composable + 在线开标大厅页 + 聊天面板；确认/异议/异议处理事件补全 | 供应商种子账号端到端：签到、聊天、确认、提异议，主持端实时可见 |
| **M3 主持端 + 存证** | 会场交流抽屉 + 签到花名册 + 交流控制；监督端只读页签；归档随包；书面渠道改造；种子数据 + E2E 收尾 | 双门户联调验收；归档包含聊天记录 |

---

## 14. 迭代二愿景（不实施，仅记录）

- docker-compose 增 SRS 容器（国产开源，WebRTC 播放 80–500ms 延迟，HLS 弱网降级）
- 主持端浏览器推流（getUserMedia/getDisplayMedia → WHIP）/ 供应商拉流（WHEP）
- SRS 录制 → MinIO → 归档哈希链（满足"全程录音录像存档"法规要求）
- `BidOpeningSession.streamStatus/recordingAssetId` + `hall:stream:status` 事件启用
- 可选：短语音留言（`fileAssetId` 已预留）、AI 纪要（复用 LLM 基建）
- **已知风险**：内网 WebRTC 连通性（candidate IP 配置）；WebRTC 强制安全上下文（HTTPS 证书或 localhost）；建议先做连通性验证 demo 再全面开工
- 技术选型备注：LiveKit（自建 SFU，Apache-2.0，Egress 服务端录制，server-sdk-js 可供 NestJS 签发 room token）为"将来加举手连麦"的备选栈；商用 PaaS（声网/腾讯 TRTC/即构）公有云为主，国企开标数据出域通常难过合规审，不默认考虑

---

## 15. 关键文件索引

| 文件 | 角色 |
|------|------|
| `apps/api/src/bid/bid.gateway.ts` | /bid gateway：软鉴权 :32-75、房间 :83-93（门控改造点） |
| `apps/api/src/bid/bid.service.ts` | 开标业务 + emit 触发点（异议处理补 emit） |
| `apps/api/src/chat/chat.gateway.ts` | 既有 IM 内核（参考模式，不修改） |
| `packages/shared/src/bid-events.ts` | 事件契约单一来源（新增 hall:*/opening:*） |
| `apps/api/src/supplier-portal/supplier-portal.service.ts` | :825-882 确认/异议（补 emit）；:434 提问（书面渠道） |
| `apps/api/prisma/schema.prisma` | BidSupplier:300 / BidOpeningSession:350 / BidClarification:560（改）；新表 |
| `apps/bid-portal/src/hooks/use-bid-websocket.ts` | socket 工程模板（移植源） |
| `apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx` | 开标大厅（加交流抽屉） |
| `apps/bid-portal/src/app/(dashboard)/bid/supervise/page.tsx` | 监督端（加只读聊天页签） |
| `apps/supplier-portal/src/views/bid/OpeningConfirm.vue` | 现开标窗口（大厅页超集后重定向兼容） |
| `apps/supplier-portal/src/views/bid/BidDetail.vue` | 标前答疑 UI（改造为书面交流） |
| `apps/supplier-portal/src/layouts/MainLayout.vue` | :53 既有 30s 角标轮询（未读汇总可挂此） |

---

## 调研来源

- [株洲市公共资源交易中心视频直播"不见面开标"](https://www.ndrc.gov.cn/xwdt/ztzl/ztbhggzyjy/dfdt/202206/t20220625_1328653.html)（国家发改委）
- [安康市：推广使用"不见面开标系统"通知](https://ggzyjy.ankang.gov.cn/Content-2469135.html)（限时未互动视为放弃）
- [吉林省不见面开标大厅操作手册（2025-05）](https://www.jl.gov.cn/ggzy/mhksggzy/mhkstzgg/202505/P020250513539163206835.pdf)
- [昆山不见面开标大厅使用手册-投标人](https://www.szzyjy.com.cn/kssfzx/034003/034003001/20210111/5577e4f1-0646-48f0-ab9b-73df9c4cf96d.html)
- [不见面开标大厅-投标人操作手册（安徽宿州，国泰新点）](https://www.ahsz.gov.cn/group1/M00/0B/C2/Cpc8VmCIyWSARKF8AC7UT-Rabco304.pdf)（互动交流/允许群聊）
- [新点电子交易平台宁夏专区招标代理操作手册 V4.1](https://ningxia.etrading.cn/uploadfile/f029c808-e9e1-4e8c-bead-5f7bd9de22e9/)（交流控制/短语音）
- [中国石化建设工程电子招投标平台远程开标操作手册](https://ebidding.sinopec.com/TPFrame4AAA/AttachStorage/2020/2/EpointFrame/)
- [电子招标投标办法（2013，八部委）](https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzbmgz/201305/t20130530_374184.html)
- [黑龙江：开标现场全程录音录像（2026）](https://sswt.hlj.gov.cn/sswt/c103658/202604/c00_31934308.shtml)
- [辽宁省财政厅：开标及评审活动全程录音录像](https://czt.ln.gov.cn/czt/articleFileDir/2024-07/10/dbdf79774e8d423690fc6e5f1893301a/2024071016535324081.pdf)
- [《公共资源交易中心招标投标管理办法》解读（2026，湖南）](https://ggzy.hunan.gov.cn/ggzy/xxgk/xxgkml/zcfg/zcjd/20260716_34027486.html)
- [网易云信：音视频技术如何实现远程招投标（6问6答）](https://netease.im/dev-blog/454)
- [声网实时音视频私有化平台](https://www.shengwang.cn/solution/pri-rtn/) / [声网实时录制](https://www.shengwang.cn/recording/)
- [音视频厂商选型对比（私有化/等保/录制维度）](https://www.cnblogs.com/hst123/articles/20805534)
- [LiveKit 自托管文档](https://docs.livekit.io/transport/self-hosting/) / [LiveKit Egress](https://github.com/livekit/egress) / [Egress 概览](https://docs.livekit.io/transport/media/ingress-egress/egress/)
- [SRS WebRTC 文档](https://ossrs.net/lts/zh-cn/docs/v7/doc/webrtc)（80–500ms 低延迟）
- [Jitsi Meet 自托管资源需求（Jibri 录制 8–12GB RAM/会）](https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-requirements/)
