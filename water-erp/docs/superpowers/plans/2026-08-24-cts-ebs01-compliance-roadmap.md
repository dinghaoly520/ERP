# CTS-EBS01-2016 规范合规路线图（总览）

> **For agentic workers:** 本文档是**总路线图**，不是可直接执行的计划。每个 Phase 内的工作项（W#）在启动时按 `superpowers:writing-plans` 展开为独立详细计划（首个已展开：`2026-08-24-tender-clarification.md`）。不要直接按本文档写代码。

**Goal:** 按《电子招标投标系统交易平台认证技术规范 CTS-EBS01-2016》（辅以 DA/T 103—2024 归档规范）补齐 water-erp，先闭合一星（线上全流程），再逐步具备二星（无纸化）条件。

**依据:** 附录 A 功能检测 A-01~A-226（14 模块）+ 附录 B 业务规则 B-001~B-047；星级 一星=线上全流程 / 二星=无纸化 / 三星=优化；**带 # 检测项可自声明豁免**（企业自建平台定位）。

**现状结论（2026-08-24 对照）:** 核心链路（公告→招标文件→双信封投标→在线开标→评标→定标→哈希链归档）已达一星主体；AI 辅助评审（A-141/149/150）等三星特征已实现。一星缺口 = 澄清流程（W1）+ 时间规则（W2）+ 邀请书（W3）+ 授时（W4）+ 公共服务平台证明（W17）+ 电子签名（W11）。

---

## 全局约束

- 工作目录：`water-erp/`（pnpm workspace，git 仓库）。API = `apps/api`（NestJS 11 + Prisma, :4001）；规则常量一律进 `packages/shared/src/constants.ts`（改后须 `pnpm --filter @water-erp/shared build`）。
- 端口/角色/cookie 按 `ERP/CLAUDE.md` Portal Map；:3005 面向 staff/leader，供应商端点在 `supplier-portal` 模块（`@Roles('supplier')` + `X-Portal: supplier`）。
- 错误统一 `{ error, code }`（HttpExceptionFilter）；阶段流转走 `bid-state.ts` 棘轮；所有新守卫挂业务前置而非新阶段。
- Prisma 迁移：非交互环境用 `migrate dev --create-only` → `db execute --file` → `migrate resolve --applied`（PG 的 `ALTER TYPE ... ADD VALUE` 不能在事务内）。
- 单测 co-located `*.spec.ts`（`pnpm --filter api test -- <pattern>`）；E2E 在 `apps/api/test/*.e2e-spec.ts`（`pnpm --filter api test:e2e -- <pattern>`）。
- UI 规范见 `.impeccable.md`（neu-* 拟态体系）；:3005 侧栏不改，新功能进既有面板/页面。
- **每个 W# 项动手前先展开为详细计划**（writing-plans），完成后回本图勾选。

---

## Phase 1 — 一星补齐（纯内功，无外部依赖，最先做）

### W1 招标文件澄清与修改流程 ✅ 已展开

- **检测项:** A-80~A-86（★，一星必检）+ B-011/B-012/B-013/B-014/B-015
- **现状锚点:** `BidClarification`（schema:739）是**评标**澄清（评委→投标人），不可复用；供应商端无提问入口；`Announcement.type` 枚举 {BID_NOTICE, WIN_NOTICE, POLICY, PLATFORM}；`NotificationService.create(CreateNotificationDto{userId,type,title,content})` 可用；`AnnouncementService.create(dto, authorId, companyStamp)` 支持直接 `status:'PUBLISHED'`。
- **措施:** 新模块 `apps/api/src/tender-clarification/`：三模型（问答 `TenderClarification` / 版本化澄清文件 `TenderClarificationDoc` / 下载回执 `TenderClarificationReceipt`）+ 10 日/15 日窗口守卫（仿 `opening-deadline.util.ts` 模式，常量入 shared）+ `AnnouncementType.CLARIFY_NOTICE` 醒目公告 + 通知已下载供应商 + 供应商门户(:3004)「澄清与修改」tab + :3005 项目详情面板。
- **详细计划:** `2026-08-24-tender-clarification.md`
- **验收:** 供应商提问（截止前 <10 日被 422 `CLARIFY_ASK_LATE`）→ 采购答复 → 澄清文件 v1/v2 版本递增（发布须截止前 ≥15 日）→ 已下载供应商收通知 → 下载即回执、:3005 可查回执表 → CLARIFY_NOTICE 公告发布。

### W2 招投标时间规则引擎

- **检测项:** B-004（售标开始→开标 ≥20 日，节假日顺延）+ B-009（发售期 ≥5 日）★；B-011/012 随 W1 落
- **现状锚点:** 24h 截标-开标规则已有完整先例——常量 `BID_DEADLINE_BEFORE_OPENING_MS`（`packages/shared/src/constants.ts:251`）+ `apps/api/src/bid/opening-deadline.util.ts`（align/frozen + 偏离留痕）+ 存量对齐脚本 `scripts/align-opening-deadline-24h.ts`；`BidProject` 已有 `openTime/deadline/downloadDeadline`；PMI `documentAcquireTime`（schema:2470，采购文件获取时间）设计意图即"公告下载时间限制来源"——**公告侧联动本来就是待办**（memory `water-erp-document-acquire-time`）。
- **措施:**
  1. `BidProject` 增 `legalMandatory Boolean @default(false)`（依法必招标志，规则只对该标志启用——延续 24h 规则的偏离留痕思路）。
  2. `packages/shared/src/constants.ts` 增 `SALE_TO_OPENING_MIN_DAYS=20`、`DOC_SALE_MIN_DAYS=5`。
  3. 新 `apps/api/src/bid/bid-timing-rules.ts`：`assertSaleToOpening(openTime, saleStart, legalMandatory)`、`assertSalePeriod(saleStart, saleEnd, legalMandatory)`，节假日顺延用 `luxon`（已是依赖？查 package.json，不是则手写法定节假日表常量）。
  4. 挂载点：`announcement.service.ts` 发布 BID_NOTICE 时（约 :62 与 :250 两处 create 路径）校验 `metadata` 内的开标/发售时间；`bid.service.ts` 项目创建/更新 openTime 时校验。
  5. 偏离放行通道：`legalMandatory=false` 时跳过并写 `BidSupervisionLog`（role='系统', action='非依法必招项目时间规则偏离放行'）。
- **验收:** legalMandatory 项目构造 <20 日/<5 日公告发布被 422；非依法必招项目放行且留痕；节假日顺延用例通过。

### W3 投标邀请书 + 邀请 ≥3 家控制

- **检测项:** A-55~A-58（★）+ B-006（邀请 ≥3 家 ★）
- **现状锚点:** 供应商选取已有 AI 筛选（:3005 `/supplier/selection`）；临时供应商邀请码体系（凭码注册+有效期，`Supplier` 模型有邀请码字段群）；**supplier-portal 已有 `views/rsvp/`**——先核实其语义，若已是"受邀反馈"则只补状态机与 ≥3 家闸门；`openSubmission` 闸门在 `bid.service.ts`（G3 招标公示已发布校验处）。
- **措施:**
  1. 新模型 `BidInvitation {id, projectId, supplierId, code, status(待发送/已发送/已接受/已拒绝/已过期), sentAt, repliedAt, rejectReason}`。
  2. :3005 选取页加「发出投标邀请」批量操作（复用选取结果）。
  3. 邀请书正文页面化（供应商门户展示，不引 PDF 生成——零新依赖）。
  4. B-006 闸门：`openSubmission` 时 ` BidInvitation.count({status:{in:['已接受']}}) < 3` → 409 `INSUFFICIENT_INVITEES`（仅邀请招标类项目）。
  5. rsvp 视图接 `BidInvitation` 状态流转（接受/拒绝+理由）。
- **验收:** 筛选→发送→供应商接受/拒绝→已接受 <3 家时开放投递被 409；:3005 可见反馈列表。

### W4 国家授时中心标准时间

- **检测项:** A-97（截止时间用标准时间）+ A-98（动态显示）★
- **现状锚点:** 开标大厅倒计时（:3007 `socket.io` countdown events）；各门户截标倒计时用客户端本地时间。
- **措施:**
  1. API 加 `@Public()` 端点 `GET /api/time` → `{ iso, serverDriftMs }`（SchedulerModule 校时源 NTP_POOL 常量 + 节点内置 `fetch` NTP over HTTP——用国家授时中心 `www.ntp.ac.cn` 文档化为运维 NTP/chrony 同步，应用层以服务器时间为准）。
  2. `packages/shared` 加 `serverClock()` 客户端工具：拉取 `/api/time` 算 offset，之后所有倒计时/截止判断统一走 `serverNow()`。
  3. 替换点：:3004 投标倒计时、:3007 开标大厅 countdown、:3002 公告截止显示（grep `Date.now()` 在倒计时组件内的用法逐个替换）。
  4. 运维文档 `docs/ops-ntp.md`：服务器 chronyd 配置指向国家授时中心源。
- **验收:** 客户端改本地时间后倒计时不漂移；`/api/time` 与 NTP 偏差 <1s。

---

## Phase 2 — 一星收尾 + 二星无纸化（W5~W10 纯内功；W11 半外部）

### W5 评标委员会组成校验补全

- **检测项:** B-022（水利工程 7 人以上单数 ★★★）+ 复用校验参数化（B-020/021 已实现于 `bid.service.ts:1742`）
- **措施:** 把 :1742 的三段校验抽成 `apps/api/src/bid/committee-composition.util.ts`（参数 `minSize`、`expertRatio`）；`BidProject` 增 `projectCategory`（若已有则复用采购类别）识别水利类→`minSize=7`；启动评标处替换调用。
- **验收:** 水利类 5 人启动评标被 409 `INSUFFICIENT_COMMITTEE_SIZE`；非水利维持 5 人门槛。

### W6 合同管理

- **检测项:** A-180~A-183（★★）+ A-185/A-186 履约录入（★★★）
- **现状锚点:** PMI 有 `contractNumber/contractAmount` 字段 + 合同阶段闸门（`project-management.service.ts:3047` 归档须合同阶段完成）；无合同实体/验证确认/履约记录。
- **措施:**
  1. 新模型 `Contract {id, projectId, pmItemId?, name, fileAssetId, signDate, status(待验证/已验证), verifiedBy, verifiedAt}` + `ContractPerformance {id, contractId, recordedBy('招标人'|'中标人'), content, recordedAt}`。
  2. :3005 项目详情合同区块（PMI 详情内）扩展：登记（上传合同扫描件）→ 验证确认（记录验证人/时间，A-182）→ 履约录入双入口（A-185/186）。
  3. `ensureArchiveItems`（`bid.service.ts:4720`）标准清单追加 `「合同」` 项，`exportArchivePackage` 并入合同+履约数据。
- **验收:** 登记→验证（有验证人/时间留痕）→履约录入→归档包含合同项。

### W7 踏勘现场通知

- **检测项:** A-77~A-79（★★，带 #）
- **措施:** 新模型 `SiteVisitNotice {projectId, visitTime, place, content}` + `SiteVisitRecord {noticeId, supplierId, attendees, note}`；通知对象=已下载供应商（复用 W1 通知管道）；:3005 项目详情面板；发送提示自动（A-78：招标文件规定时间范围内对已下载者发送）。
- **验收:** 发出通知→已下载供应商收到站内通知→踏勘记录登记可查。

### W8 开标记录/评标模板管理

- **检测项:** A-115（开标记录模板 ★★★）+ A-147（评标模板 ★★★）
- **现状锚点:** 开标记录导出已格式化（`exportArchivePackage` CSV 段）；评分标准编制 `bid-score-standard.service.ts`。
- **措施:** 新模型 `WorkTemplate {id, kind('opening_record'|'evaluation'), name, content Json, isActive}`；:3005 增模板管理页（进既有「系统管理」区）；导出/编制时可选模板。
- **验收:** 新建模板→开标记录导出按模板渲染→停用模板回退默认。

### W9 黑名单管理完善

- **检测项:** A-215（★★）
- **现状锚点:** `SupplierStatus.BLACKLIST` 枚举已存在 + `disableReason/eliminatedAt` 字段已有；差管理界面与投递闸门。
- **措施:** ① :3005 供应商管理中心加黑名单 tab（列表/筛选/加入-移出，加入须填原因→写 `disableReason`）；② 投递闸门：`submitBid` 前置校验 `Supplier.status !== 'BLACKLIST'`（403 `SUPPLIER_BLACKLISTED`）；③ 下载招标文件同闸门。
- **验收:** 拉黑供应商登录正常但投递/下载被拒；解除后恢复。

### W10 变更非招标方式处理

- **检测项:** A-199（★★★）
- **现状锚点:** `BidProject.roundMode`（null|'negotiation'|'sealed_auction'）+ round 轮次 + 流标三时点已有。
- **措施:** 流标收尾流程增「转非招标方式」分支：选方式（竞争性谈判/询价/单一来源）→ 登记《成交结果记录》 {projectId, method, winnerSupplierId, dealAmount, fileAssetId} → `ensureArchiveItems` 追加「非招标成交记录」项。
- **验收:** 流标→转谈判→登记成交→归档包含成交记录。

### W11 CA 电子签名体系（分三步，仅①零外部依赖）

- **检测项:** A-101（回执签名 ★）/ A-66（招标文件签名 ★）/ A-152（评标报告签名 ★）/ A-12/13（CA 绑定登录 ★）/ A-183（合同签名 ★★）
- **现状锚点:** `@water-erp/ukey` 已有 SM2/SM3/SM4 + `MockUKeyAdapter` + `canonicalEnvelopeHash`（供应商侧投标签名验签已用：`Supplier.sm2PublicKey`）；管理方密钥体系 `ADMIN_KEYSTORE_DIR` + `admin-keystore.service.ts`；评标签字=手签扫描（`bid-sign-packet.service.ts`）。
- **措施分步:**
  1. **投标回执签名（A-101，纯内功）:** 投递成功回执 = `{submissionId, receivedAt, fileDigest}` 经供应商 SM2 私钥签名（客户端 ukey 已能签），服务端用 `sm2PublicKey` 验签存 `SupplierBidSubmission.receiptSignature Json`；归档导出并入。
  2. **平台侧签章（A-66/152）:** 管理方 keystore 升级挂 CA 机构签发的平台证书（**需采购一张平台证书**）；招标文件打包与评标签字包 PDF 加 SM2 签章域；验签端点。
  3. **CA 绑定登录（A-12/13）:** `UserCertBinding {userId, certSerial, subject, expiresAt}` 表 + 登录方式扩展（U盾即插即登）+ 到期提醒（A-13，复用 NotificationService）。
- **验收:** ①回执可离线验签；②PDF 带可验签章；③证书登录可用、到期前 30 天提醒。

---

## Phase 3 — DA/T 103 归档规范落地（深化 A-200/201）

### W12 归档元数据（DA/T103 §7.2 + 附录 C）

- **措施:** `exportArchivePackage`（`bid.service.ts:5673`）增 `metadata` 块按 DA/T46 映射：M22 题名=项目/标段名、M28 人名=招标人/投标人/中标人、M32 责任者=ownerRole、M33 日期=批复/开标/签约/归档时间、M57 电子签名=W11 签章指纹；每个 `BidArchiveItem` 补 `capturedAt/sourceSystem`。
- **验收:** 导出 JSON 含 metadata 数组且附录 C 五类字段齐。

### W13 标准归档信息包 ASIP（附录 D）

- **现状锚点:** `generateArchiveFiles`（`project-management.service.ts:3337`）已产「项目归档说明.txt + 阶段目录 + 本地/NAS 双写」，结构已近 ASIP。
- **措施:** 目录对齐附录 D：`说明文件.TXT`（补载体参数/移交单位/起止档号/软硬件环境字段）+ 标段(包)文件夹按卷 + `其他/`（移交清单 XML、固化验证信息=哈希链 JSON、命名规则、交接登记表）；新端点 `GET /bid/projects/:id/archive-package/zip` 打包下载。
- **验收:** zip 解包结构与附录 D 图 D.1 一致；哈希链可离线复算通过。

### W14 四性检测（§8.3/10.3）

- **现状锚点:** 真实性=哈希链 `verifyArchiveIntegrity`（`bid.service.ts:4655`）；完整性=`FileAsset.sha256`。
- **措施:** 新 `apps/api/src/bid/archive-inspection.service.ts`：检测项注册表（真实性/完整性已有 + 可用性=MIME 与实际解析一致 + 安全性=病毒扫描接口预留 `VIRUS_SCAN_URL` 可选）；`BidArchiveItem` 增 `inspectionStatus/inspectedAt/inspectionNote`；不合格→退回 `PENDING_CONFIRM` 并反馈原因（附录 A.1f 退回重收）；:3005 归档面板显示检测结论。
- **验收:** 注入篡改文件后检测 FAIL 且归档被退回可重收。

### W15 保管期限与保留策略（§9.3/8.5）

- **措施:** `BidProject.retentionPeriod String?`（'永久'|'30年'|'10年'，归档时按项目类别默认建议、人工确认）；scheduler 加年度扫描提醒（不自动删）；平台保留声明：`uploads/` 归档目录删除保护——`DELETE /api/upload/:key` 对已入归档项的资产拒绝（已有三类目硬保护先例：`bid_inner_ciphertext` 等，扩展 `bid_archive` 联动校验）；≥3 年硬底线。
- **验收:** 归档项目带保管期限；未满 3 年资产的删除请求被 409。

### W16 档案系统在线接口（附录 A.2，半外部）

- **措施:** 我方侧先做通用出口：`POST /api/archive/export-to-erms`（封装 W13 ASIP + 传输 + 接收反馈消息 + `BidArchiveItem.exportedAt` 已归档标记防重复 + 可取消重推）+ 组合查询索引（类型/时间/状态）；适配器接口留 `ErmsAdapter` 实现，待集团档案系统接口规范到位替换。
- **验收:** 对 mock 档案系统完成 传输→成功反馈→已归档标记→重复导出被拒→取消标记重推 闭环。

---

## Phase 4 — 外部依赖/立项决策项（不排期，先给决策材料）

| # | 工作项 | 检测项 | 关键障碍 | 建议 |
|---|---|---|---|---|
| W17 | 公共服务平台对接 | 4.5/4.6 数据项与接口（**由公共服务平台出具证明**）+ A-10/45/70/128/153/175/184/224 + B-001/017/029 | 需与四川省公共服务平台签对接协议、按其接口规范联调——**行政事项先于技术** | 技术侧可先建 `public-service-platform/` 模块骨架（数据项注册表+BullMQ 推送队列+失败重试），接口规范到位后填充 |
| W18 | 保证金/费用管理 | A-102~105/187~194 + B-047 | 资金收付须银企直连/第三方支付（金融合规）；现状仅有人工核对（`packages/shared/src/bid-bond-status.ts` + 主持人录入），A-102/103/104 部分达成 | 先做 A-105 退还台账（纯记录）；在线收付等集团财务通道决策 |
| W19 | 资资格预审全流程 | #A-71~76/116~128/158~162/165~167/176~179（约 40 项，全带 #） | 一整条业务线 | **建议自声明豁免**（业务上不用资格预审），除非集团业务需要 |
| W20 | OFD 版式文件 | A-89（★★） | Node 无成熟 OFD 库（主流 ofdrw 是 Java） | 仿 OCR(:8100) 先例建 Java 微服务 :8101；或先 PDF/A（LibreOffice headless）过渡 |
| W21 | 投标文件制作软件 | A-87/88 | 规范定义的是专用客户端 | 现有"在线编辑+离线打包上传"已可用，客户端投入大，暂缓 |
| W22 | 远程异地评标 | A-154~157（★★★） | 音视频监控/MAC 绑定/CA 锁=专用硬件+场地 | 三星项，暂缓 |

---

## 豁免自声明清单（W-EX，送检材料）

平台定位：四川水发集团企业自建非营利采购平台（非面向社会公众运营的第三方交易平台）。以下检测项申请自声明豁免：

1. **资格预审族**（#A-71~76/116~128/158~162/165~167/176~179、#B-007/035~046）——业务不使用资格预审。
2. **招标代理机构族**（#A-14~24、A-41~44）——自办采购，无代理机构角色。
3. **政府采购特殊规则**（#B-007/024/032/034/040）——非政府采购执行主体。
4. **招标人自助注册**（A-01~13）——内部单位走账号管理（`/admin/accounts`）实现同等控制（唯一性/验证状态/权限管理均已有）。

每项附现有系统等价实现说明 + 真实性承诺（规范允许，见附录 A/B 末尾说明）。

---

## 执行顺序与依赖

```
Phase 1: W1 → W2（共用时间规则模式）→ W3 → W4（相互独立，W1 通知管道被 W7 复用）
Phase 2: W5~W10 任意顺序（W6 依赖无）；W11-① 可与 Phase 2 并行（零外部依赖）
Phase 3: W12/W13 先（W16 依赖两者）；W14/W15 独立
Phase 4: 仅 W17 有排期价值（一票门槛），取决于行政进度
```

| 完成标志 | 需要的工作项 |
|---|---|
| 一星功能自查通过 | W1~W5 + W9 + W11-① |
| 一星送检就绪 | 上行 + W17（公共服务平台证明）+ W11-② |
| 二星条件 | 上行 + W6/W7/W8/W10 + W11 全部 + W20 |
| DA/T103 归档合规 | W12~W16 |

- [ ] W1 招标文件澄清与修改（详细计划已建）
- [ ] W2 时间规则引擎
- [ ] W3 投标邀请书
- [ ] W4 国家授时
- [ ] W5 委员会校验补全
- [ ] W6 合同管理
- [ ] W7 踏勘现场
- [ ] W8 模板管理
- [ ] W9 黑名单
- [ ] W10 非招标方式
- [ ] W11 电子签名（①②③）
- [ ] W12~W16 归档规范五项
- [ ] W-EX 豁免自声明文档
