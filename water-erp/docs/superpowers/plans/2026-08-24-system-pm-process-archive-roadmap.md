# 规范完善路线图（收窄版）：系统管理 / 项目管理 / 流程 / 归档

> **For agentic workers:** 本文档是**总路线图**。每个工作项（编号 A#/B#/C#/D#）启动时按 `superpowers:writing-plans` 展开为独立详细计划再动代码。全量合规版（含线上招投标执行链）见 `2026-08-24-cts-ebs01-compliance-roadmap.md`——本版**排除**其 W1（澄清）/W3（邀请书）/W4（授时）/W5（评委校验）/W7（踏勘）/W11（CA 签名）/W17~W22（公共服务平台等外部依赖项），W1 的详细计划文档保留备用。

**Scope（2026-08-24 用户裁定）:** 只做 系统管理、项目管理、流程、归档 等内部支撑域；线上招投标执行链（公告/招标文件/投标/开评标/定标）不在本期。

**规范依据:** ① **DA/T 103—2024《招标投标电子文件归档规范》**（用户提供的文件本体，全部条款可落地）；② CTS-EBS01-2016 中属本范围的检测项：A-36~A-49（项目/任务计划）、A-197~A-201（招标异常/存档归档）、A-202~A-226（信息资源库）、A-25~A-35 精神（注册审核——已实现，仅查漏）。

**现有底盘（已核实）:** 归档=逐项 SHA-256 哈希链+verify 端点+标准清单+签字包+本地/NAS 双写（`bid-archive.digest.ts`、`bid.service.ts:4720/4843/5673`、`project-management.service.ts:3337`）；PMI=立项单+阶段（`ProjectManagementStage @@unique([itemId,stageKey,round])`）+阶段合规规则（`stage-compliance-rules.ts` 409 行硬编码）；流程=注册审核/密码审批/资料变更审批三合一（`/admin/accounts`）+供应商变更+商城价格审批（散落）；库=供应商考评/专家库 186 名/目录参考价/Company 主数据。

---

## 全局约束

- 同全量版（water-erp 根执行、shared 常量、`{error,code}` 错误体、迁移三步法、co-located spec、`.impeccable.md` UI、conventional commits）。
- **本范围铁律：不碰招投标执行链代码**（`bid.service` 的开评标端点、公告发布流程、投标加密链路）。归档改造只动归档侧（`exportArchivePackage`/`generateArchiveFiles`/`ensureArchiveItems`）。
- `sidebar-is-fixed`：:3005 新功能一律进既有页面/面板。

---

## A. 归档域（DA/T 103 落地——本期主战场，依据最硬）

### A1 归档元数据映射（§7.2 + 附录 C）｜小

- **锚点:** `exportArchivePackage`（`bid.service.ts:5673`，JSON/CSV 双格式已含全量过程数据）；`generateArchiveFiles` 的说明文件。
- **措施:** 导出包顶层增 `metadata` 块，按 DA/T46 对照表逐字段映射：M22 题名（项目名/编号）、M28 人名（招标人=归属公司快照、投标人=suppliers 列表、中标人=evaluationResults[0]）、M32 责任者（archiveItems.ownerRole）、M33 日期（立项 initiationDate/开标 openTime/签约 signDate/归档 archivedAt）、M57 电子签名（暂 null，留 CA 接入位）；每个 `BidArchiveItem` 补 `capturedAt`（=archivedAt）与 `sourceSystem:'water-erp'`。
- **验收:** 导出 JSON 含 metadata 五类字段且与项目真实数据一致；CSV 增「元数据」段。

### A2 标准归档信息包 ASIP（附录 D）｜中

- **锚点:** `generateArchiveFiles` 已产 `uploads/archive/2026年XX月/项目名/N.阶段名/` + `项目归档说明.txt` + NAS 双写——结构距附录 D 只差三步。
- **措施:**
  1. 说明文件对齐附录 D「说明文件.TXT」：补移交单位、内容描述、档案数量（附件数）、读取环境（PDF/DOCX 阅读器）字段；
  2. 增「其他」文件夹：电子档案移交清单（CSV：序号/阶段/文件名/sha256）、固化验证信息（导出 `computeArchiveChain` 全链 JSON——离线可复算）、命名规则说明、交接登记表模板；
  3. 新端点 `GET /api/project-management/items/:id/archive-package/zip`：按上述结构流式打包 zip（`archiver` 或手写 zip 流，查现依赖再定）。
- **验收:** zip 解包= 附录D 图 D.1 三段结构；用固化验证 JSON 里的创世哈希+逐项内容可独立复算整条链。

### A3 四性检测（§8.3/§10.3 + 附录 A.1f）｜中

- **锚点:** 真实性=`verifyArchiveIntegrity`（`bid.service.ts:4655`）；完整性=`FileAsset.sha256`。
- **措施:** 新 `apps/api/src/bid/archive-inspection.service.ts`——检测项注册表：真实性（哈希链复算）/完整性（逐文件 sha256 重算比对）/可用性（MIME 与 size>0 校验，预留 `VIRUS_SCAN_URL` 安全检测适配位）；`BidArchiveItem` 增 `inspectionStatus(PASS|FAIL|PENDING)/inspectedAt/inspectionNote`；检测 FAIL→项目退回可重收状态并反馈原因（附录 A.1f「退回至收集阶段+重新推送」）；:3005 归档区块显示检测结论徽标；检测结果入 `BidSupervisionLog`（role='系统'）。
- **验收:** 篡改任一附件 sha256 后检测 FAIL 且归档项退回；哈希链断链 FAIL；正常项目 PASS 全绿。

### A4 保管期限与平台保留（§9.3/§8.5）｜小

- **措施:** `BidProject.retentionPeriod String?`（'永久'|'30年'|'10年'）——归档时按采购类别给默认建议、人工确认改；`ProjectManagementItem` 同步展示；scheduler 增年度扫描（到期前 30 天通知 leader/admin，**不自动删**）；删除保护：`UploadService.delete` 对已入归档清单的 FileAsset 拒绝（409 `ASSET_ARCHIVED`，先例=bid_inner_ciphertext 三类目硬保护），≥3 年底线写入 `docs/ops-archive-retention.md`。
- **验收:** 归档项目显示保管期限；对已归档附件调删除接口被 409。

### A5 档案系统在线归档接口（附录 A.2）｜中（半外部）

- **措施:** 我方侧通用出口先行：`POST /api/bid/projects/:id/archive/export-to-erms`——封装 A2 的 ASIP 结构 → 传输（适配器接口 `ErmsAdapter { transmit(pkg): Promise<{ok, code?, message?}> }`，默认 `MockErmsAdapter` 直接成功）→ 记录反馈（成功/失败+故障代码）→ `BidArchiveItem.exportedAt` 已归档标记防重复（重复导出 409 `ALREADY_EXPORTED`）+ 人工取消标记重推；组合查询索引（按类型/归档时间/归档状态过滤的台账端点）。集团档案系统接口规范到位后换 adapter 实现。
- **验收:** mock 全闭环=导出→成功反馈→标记→重复导出 409→取消标记→重推成功；台账按状态筛选正确。

### A6 归档范围配置化（附录 A.1a）｜小

- **锚点:** 标准清单硬编码于 `ensureArchiveItems`（`bid.service.ts:4720`）；PMI 归档目录阶段顺序硬编码。
- **措施:** 新模型 `ArchiveScopeConfig { companyId?, stage(策划/招标/投标/开标/评标/中标/其他), itemName, required Boolean, ownerRole }`——按 DA/T103 附录 B 七阶段预置默认种子；`ensureArchiveItems` 改读配置（无配置回退现硬编码清单，兼容存量）；:3005 系统管理加归档范围配置页（admin）。
- **验收:** 关掉某必选项后新归档项目不再生成该项；配置页改动即时生效。

### A7 归档时限调度（§8.2/§10.1）｜小

- **措施:** scheduler 增两档提醒：①项目 ARCHIVED 后 90 天未生成 ASIP 包→提醒 owner；②每年 2 月扫描上年度已终结未归档/已归档未移交台账→通知 leader/admin（3 月 31 日/6 月底线口径）；台账页（:3005 归档汇总 `archive-summary` 已有）加「归档时限」列（绿/黄/红）。
- **验收:** 测试用例注入时钟后提醒触发；台账列状态正确。

### A8 归档操作审计视图（附录 A.1g 补强）｜小

- **锚点:** `OperationLog`（分区表+180 天保留）+`BidSupervisionLog` 均已有，缺归档域专用视图。
- **措施:** `GET /api/bid/projects/:id/audit-trail`——聚合两源中归档相关事件（生成/验证/导出/退回/重收），:3005 归档区块嵌「操作留痕」时间线组件（复用监督时间线样式）。
- **验收:** 走完一次归档→导出→退回→重收后，时间线四事件齐全（人/时间/结果）。

---

## B. 项目管理域

### B1 标段（包）模型（A-38~A-40）｜大（结构决策项）

- **锚点:** 现为 PMI（立项单）↔ BidProject 两级弱关联（`projectManagementItemId` 反向）；`ProjectManagementStage` 已有 `round`（采购轮次）但**无标段维度**——系统"项目=单标段"隐含假设。
- **措施（决策后展开）:** 新模型 `PmiSection { pmItemId, sectionNo, name, content, budgetAmount }`；PMI 详情增标段区块（增删改查+与 BidProject 按 `round/section` 关联扩展）；台账/进度页按标段聚合。**前置决策**：是否真有多标段业务（水电站采购多为单标段）——若无，降级为「标段字段（单标段登记 sectionName/No）」小改。
- **验收:** 一项目两标段各自关联 BidProject；台账按标段拆行。

### B2 任务计划编制与审核（A-47~A-49）｜中

- **锚点:** `WorkArrangement`（+Note/Template/Dependency/DailyPlanCache，schema:2522~2600）——执行态已很强，缺「报审→生效」环（A-49）。
- **措施:** `WorkArrangementPlan { pmItemId?, title, content Json(里程碑/分工), status(草稿/待审/已生效/驳回), submittedBy/At, reviewedBy/At, reviewNote }`；:3005 工作安排页增「计划」tab：编制（可从模板生成）→ leader 审核 → 生效后自动播种 WorkArrangement（复用现有模板机制）；驳回可改再报。
- **验收:** 计划报审→leader 驳回→修改→通过→生效并生成对应工作安排。

### B3 项目时间信息轴（A-204）｜小

- **锚点:** 时间散落：PMI `initiationDate/bidOpeningTime/documentAcquireTime`（String!）、`BidProject.openTime/deadline`、合同时间在阶段。
- **措施:** `GET /api/project-management/items/:id/timeline` 聚合各域时间节点→统一时间轴（键/中文名/时间/来源模块/跳转链接）；:3005 项目详情顶部加横向时间轴组件；顺带把 `bidOpeningTime/documentAcquireTime` 两个 String 字段规范化为 ISO（读侧兼容）。
- **验收:** 时间轴含立项/获取文件/开标/评标/合同/归档六类节点且与各源一致。

### B4 合同管理实体化（A-180~A-183/185/186 裁剪到项目侧）｜中

- **锚点:** PMI 仅有 `contractNumber/contractAmount` 字符串字段；归档闸门要求"合同阶段完成"（`project-management.service.ts:3047`）。
- **措施:** 新模型 `Contract { pmItemId, bidProjectId?, name, fileAssetId, signDate, amount, status(待验证/已验证), verifiedBy/At }` + `ContractPerformance { contractId, recordedByRole(采购人/供应商), content, recordedAt }`；:3005 项目详情「合同」区块：登记（上传扫描件）→验证确认（留痕）→履约录入；`generateArchiveFiles` 阶段目录把合同文件并入「中标(定标)阶段」文件夹；A1 元数据 M28/M33 引用合同签约方/时间。
- **验收:** 登记→验证→履约→归档包含合同文件与元数据。

### B5 项目台账增强（A-202/A-203）｜小

- **措施:** :3005「数据库」台账页（`/dashboard` 数据库域）补：标段-中标关联列（B1 落地后）、项目全时间字段筛选（B3）、导出含 A1 元数据头。
- **验收:** 台账可按归档状态+保管期限+时间区间组合筛选并导出。

---

## C. 流程域

### C1 统一流程中心（审批收件箱）｜中（价值最高）

- **锚点:** 审批散落 5 处：注册审核/密码审批/资料变更（三合一 `/admin/accounts`）、供应商资料变更（supplier ChangeRequest）、商城价格审批（:3005 `/mall-management`）；通知已有 `Notification`+`NotificationDeliveryLog`。
- **措施:** 新只读聚合端点 `GET /api/workflow/pending?role=`——统一出参 `{source, sourceId, title, applicant, submittedAt, deepLink, category}`，各源 service 加 `listPending()`（各审批**实现不动**，纯聚合，延续三合一先例）；:3005 新「流程中心」页面（进既有导航区，admin/leader/staff 按角色过滤）四段：待我审批/我发起的/已完成/抄送关注；角标=待办数。
- **验收:** 五源待办同屏；点 deepLink 直达原审批页处理；处理后聚合列表刷新。

### C2 流转时间线组件复用｜小

- **措施:** 抽通用 `ApprovalTimeline` 组件（:3005），输入 `events:[{actor,action,time,note}]`——数据源用各审批已有留痕字段（submitted/reviewed/At）；先嵌资料变更+密码审批两处，其余逐页接入。
- **验收:** 两处页面显示完整流转链。

### C3 招标异常→转非招标方式（A-197~A-199 裁剪）｜中

- **锚点:** 流标三时点已有；`BidProject.roundMode`（negotiation/sealed_auction）已有。
- **措施:** 新模型 `NonTenderDealRecord { bidProjectId, pmItemId, method(竞争性谈判/询价/单一来源), winnerSupplierId, dealAmount, fileAssetId, recordedBy/At }`；流标收尾页增「转非招标方式」分支（登记成交→PMI 终结）；`ensureArchiveItems` 追加「非招标成交记录」项；A1 元数据并入。
- **验收:** 流标→转谈判→登记→归档包含成交记录项。

### C4 阶段合规规则配置化（`stage-compliance-rules.ts`）｜中

- **锚点:** 409 行硬编码规则表 `STAGE_COMPLIANCE_RULES[stageKey]`。
- **措施:** 迁 DB 模型 `StageComplianceRule { stageKey, checkpoint, required, hint }`（seed 从现硬编码导出生成）；PMI 服务改读 DB（缺省回退代码表）；:3005 系统管理加规则维护页（leader/admin）。注意与 A6 归档范围配置的界面合并为同一「合规配置」区。
- **验收:** 界面改某检查点必填后，对应阶段完成校验即时变化。

---

## D. 系统管理/信息资源库域

### D1 供应商考评增强（A-213/A-214）｜小

- **锚点:** `Supplier` 评价体系已有；缺奖惩/履约独立记录。
- **措施:** `SupplierCreditRecord { supplierId, kind(奖励/处罚/履约良好/违约), title, detail, occurredAt, sourceProjectId? }`；供应商详情加「信用档案」tab；注册审核与（未来）投递闸门可引用处罚在册记录。
- **验收:** 登记一条处罚→供应商详情信用 tab 可见。

### D2 专家库状态管理补全（A-222）｜小

- **锚点:** expert-admin 已有 CRUD/抽取/画像/退休。
- **措施:** 核对四态（审核中/在库/暂停/退出）流转+原因留痕字段；缺则补 `ExpertProfile.status` 状态机端点与列表筛选；A-218「入库/变更/审核时间及责任人」核对留痕。
- **验收:** 暂停→恢复→退出全链路状态正确且留痕。

### D3 价格信息库统计（A-225/A-226）｜小

- **锚点:** 目录 `referencePrice` + 价格历史已有（版本生效无需审批）。
- **措施:** :3005 目录管理增「价格分析」视图：分类分项单价走势（历史版本折线）、同品类比价表；预警通知已有（admin+leader）保持。
- **验收:** 某目录项三次调价后折线三点的值正确。

### D4 内部单位信息库（A-205~A-207 裁剪）｜小

- **锚点:** `Company` 主数据表已有（normalizeCompany 建档）。
- **措施:** :3005 系统管理加「单位管理」页：列表/检索/编辑（现 Company 只在注册时自动建档，无维护界面）；每单位业绩视图=其名下已归档项目数/金额（复用归属快照统计）。
- **验收:** 改单位联系方式后新项目归属快照正确；业绩统计与台账一致。

### D5 黑名单管理完善（A-215）｜小

- **锚点:** `SupplierStatus.BLACKLIST`+`disableReason/eliminatedAt` 已有，缺界面与闸门。
- **措施:** :3005 供应商管理中心黑名单 tab（列表/加入/移出，加入必填原因）；闸门两处：登录后供应商门户投标机会页过滤黑名单主体、（未来投递端点校验——**执行链本期不动**，仅在供应商门户展示层过滤+账号管理提示）。
- **验收:** 拉黑后供应商门户不再展示可投项目入口；解除恢复。

### D6 运行监控与自声明支撑页（CTS 4.7~4.11）｜中

- **措施:** 新「系统健康」页（:3005 系统管理，admin）：接口 P95（OperationLog 时长聚合）、错误率趋势、DB/Redis/MinIO/:8100 OCR 探活、worker 队列深度（BullMQ）；一键导出「性能/可靠性/运行环境自声明」数据包（CTS 认证要求平台自评佐证）。
- **验收:** 页面四类指标实时；导出包含 30 天聚合数据。

---

## 优先级与批次（建议）

```
第一批（归档主战场，用户文件本体，纯内功）: A1 → A2 → A3 → A4 → A6
第二批（流程价值）:                        C1 → C2 → C3 → C4
第三批（项目域）:                          B4 → B3 → B2 → B5 → B1(先决策)
第四批（系统域）:                          D1~D6 任意穿插；A5/A7/A8 随批收尾
```

依赖关系：A2 依赖 A1（元数据入包）；A5 依赖 A2；B4 供 A1/B3 数据；C1 独立；B1 需业务决策（单标段 vs 多标段）先行。

## 已排除项备忘（归全量版路线图管辖）

线上招投标执行链全部（澄清/邀请书/授时/评委校验/踏勘/CA 签名/公共服务平台对接/保证金在线收付/资格预审/OFD/投标客户端/远程评标）——见 `2026-08-24-cts-ebs01-compliance-roadmap.md` Phase 1/2/4 对应条目。

- [x] A1 归档元数据映射
- [x] A2 标准归档信息包 ASIP
- [x] A3 四性检测
- [x] A4 保管期限与保留策略
- [x] A5 档案系统在线接口
- [x] A6 归档范围配置化
- [x] A7 归档时限调度
- [x] A8 归档操作审计视图
- [x] B1 标段模型（先决策）
- [x] B2 任务计划编审
- [ ] B3 项目时间信息轴
- [x] B4 合同管理实体化
- [ ] B5 项目台账增强
- [x] C1 统一流程中心
- [ ] C2 流转时间线组件
- [x] C3 转非招标方式登记
- [ ] C4 阶段合规规则配置化
- [ ] D1 供应商信用档案
- [x] D2 专家库状态机
- [ ] D3 价格统计分析
- [ ] D4 单位管理页
- [ ] D5 黑名单管理
- [ ] D6 系统健康与自声明支撑
