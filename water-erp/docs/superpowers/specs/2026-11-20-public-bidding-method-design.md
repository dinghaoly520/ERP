# 项目管理新增采购方式「公开招标」设计（2026-11-20）

## 背景与目标

:3005 项目管理（PMI）现有五种采购方式（谈判/竞价/直接/邀请/询比）。新增第六种**公开招标**：
与邀请招标同构（采购文件/公告模板由邀请招标模板克隆改造），但**不采用供应商邀请，采用公告公示**——
供应商经 :3004「项目机会」公告公开参与。

BidProject 侧「公开招标」早已存在（公告直建默认方式、`LEGAL_TENDER_METHODS`、评标默认 manual、
编号前缀 GK、归档范围矩阵、阳光平台映射均已预置），本设计把它落进 PMI 全流程。

## 用户裁定（2026-11-20）

1. **供应商可见范围**：沿用公司隔离口径——公告归属发布人公司，仅本公司库
   （SupplierCompanyLink APPROVED）供应商可见，与询比/竞价/谈判一致（2026-10-20 裁定同口径）。
2. **统计口径**：分列两行——「招标项目（公开招标）」「招标项目（邀请招标）」各自单列；
   「采购项目」= PMI 非招标两方式（原「非邀请招标」口径收窄）。
3. **04 阶段名**：`招标公告公示`（不用 canon「采购公告公示」——法定招标口吻）。
4. **公告口吻**：公告/文件模板中「采购人」→「招标人」，全文口吻招标化
   （进行采购→进行招标、公示如下→公告如下、被邀请的投标人→投标人等）；
   **占位符 token 全部保持不变**（`{{采购人名称}}` 等——内部 token 不上界面，替换计划引擎零改动复用）。

## 方案（A：独立 PUBLIC_BIDDING 类型，镜像邀请招标新增）

### 阶段集（前后端镜像同步）

前端 `PROCUREMENT_METHOD_STAGES`（apps/web/src/lib/types/project-management.ts）+
后端 `METHOD_STAGE_TEMPLATES`（apps/api/src/project-management/project-management.service.ts）：

| # | key | 标签 |
|---|-----|------|
| 01 | PROCUREMENT_DEMAND | 采购需求 |
| 02 | INITIATION | 采购立项 |
| 03 | TENDER_DOCUMENT | 招标文件（法定名，同邀请招标） |
| 04 | PUBLIC_ANNOUNCEMENT | **招标公告公示** |
| 05 | EXPERT_SELECTION | 专家抽取（同邀请招标；谈判/询比/直接用「选取」） |
| 06 | BID_EVALUATION | 开标评标 |
| 07 | AWARD_DECISION | 定标 |
| 08 | CONTRACT | 合同 |

编号前缀 GK（`procurementMethodPrefix` 拼音映射已含「公/开」，零改动）。

### 模板（docx 克隆法，python 脚本一次性生成入库）

- `模板文件/公开招标文件模板.docx` ← 克隆「邀请招标文件模板.docx」：
  封面「邀请招标文件」→「招标文件」；第一章「招标邀请」→「招标公告」；
  「采用邀请招标方式进行招标，兹邀请…参加投标」→「采用公开招标方式进行招标，欢迎…参加投标」；
  「被邀请的投标人」→「投标人」；「采 购 人/采购人：」→「招 标 人/招标人：」；
  「公示期间下载采购文件」→「公告公示期间下载招标文件」；
  19.1.1「邀请招标方式适用情形」→「公开招标方式适用情形」；
  第 22 条内部制度免责声明同步（本公开招标…并非《招标投标法》层面的公开招标）。
- `模板文件/公开招标公告模板.docx` ← 克隆「邀请招标公告模板.docx」：
  「邀请招标公告」→「招标公告」；「采用邀请招标方式…进行采购，现公示如下」→
  「采用公开招标方式…进行招标，现公告如下」；「采 购 人/采购人」→「招 标 人/招标人」；
  「采购的货物或者服务的要求/采购内容包括」→「招标内容及要求/招标内容包括」。
- 替换计划引擎直接复用：文件=buildInternalBiddingReplacementPlan（邀请招标本就复用竞价），
  公告=buildInvitedBiddingAnnouncementPlan（谈判/询比复用先例）。
- 文本替换需跨 run 合并处理（Word 拆 run 实录见 tenant-tokens.ts 注释）。

### 公告类型与导出

- `TenderDocumentType` 新增 `PUBLIC_BIDDING`（web/api 联合类型、dto 枚举、模板常量、
  `ANNOUNCEMENT_AVAILABILITY` 五类全开含 procurement_document）。
- 导出 typeLabel：文件=「招标文件」、公告=「招标公告」。
- `exportAnnouncement` 原 INVITED_BIDDING else 死分支（硬闸之下不可达）改为公开招标显式分支。
- 方式闸（`INVITED_NO_PROCUREMENT_NOTICE`、BID_NOTICE metadata.method 闸）不含公开招标——天然放行。
- 「引用采购文件」→ attachFromObject 建 BidDocument 链路方式无关，直接生效。

### 供应商参与（公告公开型）

- `INVITATION_SCOPED_METHODS={直接采购,邀请招标}` 不动——公开招标默认公告公开型：
  :3004 项目机会经公告桥接可见、下载招标文件、投递（assertCanSubmitBid 走 BID_NOTICE_REQUIRED 分支）。
- `INVITED_METHODS`（≥3 家已接受邀请闸）不加公开招标（无邀请环节；不足 3 家流标走既有开标规则）。
- :3005 详情面板参与标签：公开招标走「供应商参与/参与的供应商」分支（非「供应商邀请」）。

### 随工清理（公开招标必经路径上的遗留）

1. `createItemFromAnnouncement` 的 `needsPublicAnnouncement=['竞价','直接','邀请']` 与
   2026-11-12 流程互换后语义相反——改为公告型方式清单（谈判/询比/竞价/公开招标保留公告阶段）。
2. `exportAnnouncement` 死分支转公开招标显式分支（见上）。

### 统计口径（分列两行）

- 水叮当 `global-overview.tool` / `assistant.service`「采购项目」计数 / `pmi.tool` / `labels.ts`：
  采购项目 = `procurementMethod NOT IN ('邀请招标','公开招标')`；
  「招标项目（邀请招标）」行旁新增「招标项目（公开招标）」行。
- 各处按方式分布图（method 分组计数）自动包含，无需改。

### 知识库

- `system-knowledge.ts` 方式差异铁律行更新（公开招标=PMI 全流程+公告公示组织；公告直建口径保留）。
- knowledge-seeds「公告型」操作文档按需补公开招标差异句（轻改）。

### 不改动面（已核实预置/方式无关）

`KNOWN_METHODS`（api）、`evaluation-method.config`（公开招标=manual/1轮已存在）、
`project-code.util`（GK）、`archive-scope METHOD_SCOPE`（公开招标列已齐）、
`sunshine-platform-dialog`（issueType 已有）、`non-tender-deal`、`progress STAGE_LABELS`、
`stage-compliance-rules`（公告阶段规则已含公开招标省级媒介条款）、
公告发布时间规则 B-004/B-009（依法必招勾选已于 2026-09-11 移除，偏离留痕口径不变）。

## 测试

- 后端：METHOD_STAGE_TEMPLATES 公开招标条目、exportAnnouncement 公开招标分支、
  needsPublicAnnouncement 修正、方式闸放行公开招标。
- 前端：procurement-method-map、公告类别矩阵、阶段集（既有 spec 扩展）。
- 存量 spec 按改动面同步（project-management.service.spec、tender-write spec、
  global-overview.tool.spec 等）。
